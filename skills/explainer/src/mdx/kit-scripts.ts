/**
 * Which kit scripts an .mdx page needs, from one table of the markup each script reads. A page needs a script when its
 * prerendered HTML holds that markup, or when its client code can write it later: the code is searched for the same markup as
 * it appears in compiled JSX and DOM calls (`"data-reply"`, `dataset.reply`, `Charts.make`). The kit components are markup
 * generators, so their code holds the markers too and needs no list of its own; a new attribute a kit script reads needs a row.
 * Markup a client component builds from computed names (`"data-" + kind`) is not found.
 */

/** A kit script's file name as pages reference it. */
export type KitScript =
	| "echarts.js"
	| "charts.js"
	| "plot.js"
	| "views.js"
	| "steps.js"
	| "link.js"
	| "keep.js"
	| "reply.js";

/** A string literal in compiled code, in any quotes. */
const literal = (text: string) => `["'\`]${text}["'\`]`;

/** Whether compiled code matches `pattern` anywhere. */
const matches = (pattern: RegExp) => (code: string) => pattern.test(code);

/** The bracket that closes each opening one. */
const CLOSING: Record<string, string> = { "{": "}", "[": "]", "(": ")" };

/** The index of the quote that closes the string literal opening at `code[start]`. */
function stringEnd(code: string, start: number): number {
	let i = start + 1;
	while (i < code.length && code[i] !== code[start]) {
		i += code[i] === "\\" ? 2 : 1;
	}
	return i;
}

/** A property name as compiled code writes it, minified or not: `id`, `"data-x"`, or `...` for a spread. */
const KEY = /\s*(\.\.\.|[\w$]+|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/y;

/**
 * The property names at the top level of the object literal that opens at `code[start]`, in compiled code, minified or not:
 * `id: x` and the shorthand `id` give "id", `"data-x": y` gives "data-x", and a spread gives "...". Strings, template literals and
 * brackets inside a value are skipped whole, so `style: { width: 3 }` or a handler's body before `id` do not end the object early.
 * A regular expression literal holding a quote or bracket would mislead it; compiled props rarely hold one.
 */
function objectKeys(code: string, start: number): Set<string> {
	const keys = new Set<string>();
	// The closers of the brackets open at i; "`" while i is in a template literal's text.
	const open: string[] = [];
	for (let i = start; i < code.length; i++) {
		const nextKey = i === start || (open.length === 1 && code[i] === ",");
		i = open.at(-1) === "`" ? templateStep(code, i, open) : codeStep(code, i, open);
		if (open.length === 0) {
			break;
		}
		const key = nextKey && keyAt(code, i + 1);
		if (key) {
			keys.add(key);
		}
	}
	return keys;
}

/** The property name that starts at `code[i]` (after spaces), its quotes removed, if one does. */
function keyAt(code: string, i: number): string | undefined {
	KEY.lastIndex = i;
	const key = KEY.exec(code)?.[1];
	return key && /^["']/.test(key) ? key.slice(1, -1) : key;
}

/** Reads `code[i]` in a template literal's text, tracking `open`; returns the last index read (an escape reads two). */
function templateStep(code: string, i: number, open: string[]): number {
	const c = code[i];
	if (c === "`") {
		open.pop();
	} else if (c === "$" && code[i + 1] === "{") {
		open.push("}");
		return i + 1;
	}
	return c === "\\" ? i + 1 : i;
}

/** Reads `code[i]` in code, tracking `open`; returns the last index read (a string literal is read whole). */
function codeStep(code: string, i: number, open: string[]): number {
	const c = code[i] ?? "";
	if (c === '"' || c === "'") {
		return stringEnd(code, i);
	}
	if (c === "`" || CLOSING[c]) {
		open.push(CLOSING[c] ?? "`");
	} else if (c === open.at(-1)) {
		open.pop();
	}
	return i;
}

/**
 * Whether compiled code makes a form control that has, or may have, an id: jsx("input", { type: "range", id }), or one whose
 * props spread an object in (`<input {...props} />`). Props passed as one variable, h("input", props), are not found: the same
 * shape is addEventListener("input", handler).
 */
function controlWithId(code: string): boolean {
	for (const made of code.matchAll(/["'`](?:input|select|textarea)["'`],\s*\{/g)) {
		const keys = objectKeys(code, made.index + made[0].length - 1);
		if (keys.has("id") || keys.has("...")) {
			return true;
		}
	}
	return false;
}

/** What each script reads: as a selector over the HTML, and as a test of compiled code. */
const MARKERS: { html: string; code: (code: string) => boolean; scripts: KitScript[] }[] = [
	{
		html: ".chart:not(.plot)",
		code: matches(/\bCharts\.make\b/),
		scripts: ["echarts.js", "charts.js"],
	},
	{ html: ".plot", code: matches(/\bPlot\.make\b/), scripts: ["plot.js"] },
	{
		html: "[data-view], details",
		code: matches(new RegExp(`${literal("data-view")}|${literal("details")}|\\bdataset\\.view\\b`)),
		scripts: ["views.js"],
	},
	{
		html: "[data-stepper]",
		code: matches(
			new RegExp(`${literal("data-stepper")}|\\bdataset\\.stepper\\b|\\bSteps\\.refresh\\b`),
		),
		scripts: ["steps.js"],
	},
	{
		html: "[data-ref]",
		code: matches(new RegExp(`${literal("data-ref")}|\\bdataset\\.ref\\b`)),
		scripts: ["link.js"],
	},
	{ html: "input[id], select[id], textarea[id]", code: controlWithId, scripts: ["keep.js"] },
	{
		html: "[data-reply]",
		code: matches(new RegExp(`${literal("data-reply")}|\\bdataset\\.reply\\b`)),
		scripts: ["keep.js", "reply.js"],
	},
];

/**
 * The order the kit scripts run in. Libraries the client components call (Charts.make, Plot.make) load before the islands
 * hydrate; scripts that read and wire the page's DOM (views, steps, link, keep, reply) load after, so they reach the markup Preact
 * owns. reply.js drives keep.js, so keep.js comes first.
 */
export const BEFORE_ISLANDS: KitScript[] = ["echarts.js", "charts.js", "plot.js"];
export const AFTER_ISLANDS: KitScript[] = [
	"views.js",
	"steps.js",
	"link.js",
	"keep.js",
	"reply.js",
];

/** The kit scripts compiled JavaScript (a client bundle, a transpiled component) can need for the markup it writes. */
export function scriptsInCode(code: string): Set<KitScript> {
	return new Set(MARKERS.filter((marker) => marker.code(code)).flatMap((m) => m.scripts));
}

/** The kit scripts an HTML page or fragment needs for the markup it holds. */
export async function scriptsInHtml(html: string): Promise<Set<KitScript>> {
	const needed = new Set<KitScript>();
	let rewriter = new HTMLRewriter();
	for (const { html: selector, scripts } of MARKERS) {
		rewriter = rewriter.on(selector, {
			element() {
				for (const script of scripts) {
					needed.add(script);
				}
			},
		});
	}
	await rewriter.transform(new Response(html)).text();
	return needed;
}
