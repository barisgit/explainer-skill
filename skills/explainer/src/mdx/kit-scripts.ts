/**
 * Which kit scripts an .mdx page needs, from one table of the markup each script reads. A page needs a script when its
 * prerendered HTML holds that markup, or when its client code can write it later: the code is searched for the same markup as
 * it appears in compiled JSX and DOM calls (`"data-reply"`, `dataset.reply`, `Charts.make`). The kit components are markup
 * generators, so their code holds the markers too and needs no list of its own; a new attribute a kit script reads needs a row.
 * Question is the exception: which markup it writes depends on its props (a self-check writes no data-reply), so the client
 * code is scanned with Question left as an import, and its calls decide. Markup a client component builds from computed names
 * (`"data-" + kind`) is not found.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KIT_DIR } from "../paths.ts";

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

/** A property name as compiled code writes it, minified or not (`id`, `"data-x"`, or `...` for a spread), and its colon. */
const KEY = /\s*(\.\.\.|[\w$]+|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')(\s*:)?\s*/y;

/**
 * The properties at the top level of the object literal that opens at `code[start]`, in compiled code, minified or not, each
 * with the index its value starts at: `id: x` and the shorthand `id` give "id" (a shorthand's value is its name), `"data-x": y`
 * gives "data-x", and a spread gives "...". Strings, template literals and brackets inside a value are skipped whole, so
 * `style: { width: 3 }` or a handler's body before `id` do not end the object early. A regular expression literal holding a
 * quote or bracket would mislead it; compiled props rarely hold one.
 */
function objectProps(code: string, start: number): Map<string, number> {
	const props = new Map<string, number>();
	// The closers of the brackets open at i; "`" while i is in a template literal's text.
	const open: string[] = [];
	for (let i = start; i < code.length; i++) {
		const nextKey = i === start || (open.length === 1 && code[i] === ",");
		i = open.at(-1) === "`" ? templateStep(code, i, open) : codeStep(code, i, open);
		if (open.length === 0) {
			break;
		}
		const prop = nextKey && propAt(code, i + 1);
		if (prop) {
			props.set(...prop);
		}
	}
	return props;
}

/** The property that starts at `code[i]` (after spaces), if one does: its name without quotes, and where its value starts. */
function propAt(code: string, i: number): [string, number] | undefined {
	KEY.lastIndex = i;
	const found = KEY.exec(code);
	const [text, written, colon] = found ?? [];
	if (!(found && text && written)) {
		return undefined;
	}
	const name = /^["']/.test(written) ? written.slice(1, -1) : written;
	const named = written !== "..." && !colon;
	return [name, named ? found.index + text.indexOf(written) : KEY.lastIndex];
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
		const props = objectProps(code, made.index + made[0].length - 1);
		if (props.has("id") || props.has("...")) {
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
		code: matches(
			new RegExp(
				`${literal("data-view")}|${literal("details")}|\\bdataset\\.view\\b|\\bViews\\.(?:local|setLocal)\\b`,
			),
		),
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

/** The kit module whose markup depends on its props, and the import bundle.ts's clientScan leaves in its place. */
export const QUESTION_MODULE = join(KIT_DIR, "components", "question.tsx");
export const QUESTION_IMPORT = "kit-question";

/** The kit scripts compiled JavaScript (a client scan, a transpiled component) can need for the markup it writes. */
export function scriptsInCode(code: string): Set<KitScript> {
	return new Set([
		...MARKERS.filter((marker) => marker.code(code)).flatMap((m) => m.scripts),
		...questionScripts(code),
	]);
}

/**
 * The kit scripts the Questions in a client scan need. A self-check, called with options and an answer written as a string and
 * no spread, needs keep.js alone; any other use of Question (other props, or the component passed on) needs what Question's own
 * code does.
 */
function questionScripts(code: string): KitScript[] {
	const imported = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*"${QUESTION_IMPORT}";?`).exec(
		code,
	);
	if (!imported) {
		return [];
	}
	// The bundler renames the import when the client code has a Question of its own.
	const name = /\bQuestion\s+as\s+([\w$]+)/.exec(imported[1] ?? "")?.[1] ?? "Question";
	const rest = code.slice(0, imported.index) + code.slice(imported.index + imported[0].length);
	const uses = [
		...rest.matchAll(new RegExp(`(?<![\\w$.])${name.replaceAll("$", "\\$")}(?![\\w$])`, "g")),
	];
	if (uses.length === 0) {
		return [];
	}
	return uses.every((use) => selfCheckCall(rest, use.index, use.index + name.length))
		? ["keep.js"]
		: [...questionCodeScripts()];
}

/** Where a call's first argument ends and an object literal second one opens: `jsx(Question, {`. */
const OBJECT_ARGUMENT = /\s*,\s*\{/y;

/** Whether the use of Question at `code[start, end)` is a call such as jsx(Question, { options, answer: "b" }), a self-check. */
function selfCheckCall(code: string, start: number, end: number): boolean {
	OBJECT_ARGUMENT.lastIndex = end;
	if (!(/\(\s*$/.test(code.slice(Math.max(0, start - 20), start)) && OBJECT_ARGUMENT.test(code))) {
		return false;
	}
	const props = objectProps(code, OBJECT_ARGUMENT.lastIndex - 1);
	const answer = props.get("answer");
	return (
		props.has("options") &&
		!props.has("...") &&
		answer !== undefined &&
		/["'`]/.test(code[answer] ?? "")
	);
}

let questionNeeds: Set<KitScript> | undefined;

/** The kit scripts Question's own code needs for the markup it can write: every form's. */
function questionCodeScripts(): Set<KitScript> {
	if (!questionNeeds) {
		const code = readFileSync(QUESTION_MODULE, "utf8");
		questionNeeds = scriptsInCode(new Bun.Transpiler({ loader: "tsx" }).transformSync(code));
	}
	return questionNeeds;
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
