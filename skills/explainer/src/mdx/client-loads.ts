/**
 * Files the page's client code would load in the browser, which pack cannot embed because they are named only when the code
 * runs: the HTML pass inlines what the prerendered page references, never what an island renders after a click or a filled
 * View draws for a record. An imported file is embedded (bundle.ts), so each finding is fixed by importing the file. Found:
 * - in the client code: a `src`, `poster` or `srcset` written as text (an attribute, a property or a setAttribute call), and any
 *   text that is a relative path (`./`, `../`) to an image, font, audio or video file, `url(./bg.png)` included;
 * - in the props of an island from the page: such a relative path;
 * - in each record a filled View draws: every load the HTML pass would refuse or inline, as pack draws the record.
 * Paths built from parts the code computes are found only by their written prefix, and a record's later states not at all.
 */
import type { Island } from "../../kit/islands/server.ts";
import { MIME } from "../data-uri.ts";
import { findLoads } from "../loads.ts";

/** The fix every finding shares. */
export const CLIENT_LOAD_FIX =
	'Fix: save the file next to the page and import it where it is used (import icon from "./icon.svg", then src={icon}): pack embeds an imported image or font.';

/** Extensions of files a browser would fetch for a page: what pack embeds, and audio and video, which it cannot. */
const FETCHED = [
	...Object.keys(MIME).map((ext) => ext.slice(1)),
	"ico",
	"bmp",
	"mp4",
	"webm",
	"ogg",
	"ogv",
	"mp3",
	"wav",
	"m4a",
].join("|");

/** A relative path to such a file, between quotes, backticks or the parentheses of a CSS url(). */
const ASSET_PATH = new RegExp(`["'\`(](\\.{1,2}/[^"'\`()\\s\\\\]*?\\.(?:${FETCHED}))["'\`)]`, "gi");

/** A string that is such a path, whole. */
const ASSET_VALUE = new RegExp(`^\\.{1,2}/\\S*\\.(?:${FETCHED})$`, "i");

/**
 * A `src`, `poster` or `srcset` given as text: an object key (JSX props compile to one) or default, a property assignment, or a
 * setAttribute call; then the value in quotes, or a template literal's text up to its end or its first `${`.
 */
const ATTRIBUTE =
	/(?:[{,]\s*["']?(src|poster|srcset)["']?\s*[:=]|\.(src|poster|srcset)\s*=|setAttribute\(\s*["'](src|poster|srcset)["']\s*,)\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\$]|\\.|\$(?!\{))*)(`|\$\{))/g;

/** A value that loads nothing: empty, inline data, a fragment or a script URL. */
const INLINE = /^(?:$|data:|blob:|#|about:|javascript:)/i;

/** The bundle's module comments (`// reveal.tsx`), which Bun writes before each module's code when it does not minify. */
const MODULE = /^\/\/ (\S.*)$/gm;

/** For each match position, the module whose code it is in: the last module comment before it. */
function moduleAt(code: string): (index: number) => string {
	const starts = [...code.matchAll(MODULE)].map((m) => ({ at: m.index, name: m[1] ?? "" }));
	return (index) => starts.findLast(({ at }) => at < index)?.name ?? "the client code";
}

/** The loads written as text in the client code (bundle.ts's clientScan output), as `module: what` lines. */
function codeLoads(code: string): string[] {
	const module = moduleAt(code);
	const found = new Map<string, string>();
	const add = (index: number, target: string, what: string) => {
		const key = `${module(index)}\0${target}`;
		if (!found.has(key)) {
			found.set(
				key,
				`${module(index)}: ${what} is a file the browser would load when the code runs`,
			);
		}
	};
	for (const m of code.matchAll(ATTRIBUTE)) {
		const name = m[1] ?? m[2] ?? m[3];
		const value = m[4] ?? m[5] ?? m[6] ?? "";
		if (!INLINE.test(value)) {
			add(m.index, value, `${name} "${value}${m[7] === "${" ? "…" : ""}"`);
		}
	}
	for (const m of code.matchAll(ASSET_PATH)) {
		const target = m[1] ?? "";
		add(m.index, target, `"${target}"`);
	}
	return [...found.values()];
}

/** The relative file paths in an island's props from the page, as `<Name path>: "value"` lines. */
function propLoads({ name, props }: Island): string[] {
	const found: string[] = [];
	const walk = (value: unknown, path: string) => {
		if (typeof value === "string" && ASSET_VALUE.test(value)) {
			found.push(
				`<${name} ${path}>: "${value}" is a file the browser would load when the code runs`,
			);
		} else if (value !== null && typeof value === "object") {
			for (const [key, item] of Object.entries(value)) {
				walk(item, path ? `${path}.${key}` : key);
			}
		}
	};
	walk(props, "");
	return found;
}

/** Elements whose attribute names a file the browser fetches; findLoads covers CSS and SVG references. */
const FETCHING = "[src], [poster], [srcset], object[data], link[href]";

/** What a filled View's record loads, as pack drew it: `#view/param: <tag attr> loads target` lines. */
async function drawnLoads(place: string, html: string): Promise<string[]> {
	const found: string[] = [];
	await new HTMLRewriter()
		.on(FETCHING, {
			element(el) {
				for (const attr of ["src", "poster", "srcset", "data", "href"]) {
					const target = el.getAttribute(attr)?.trim() ?? "";
					if (!INLINE.test(target)) {
						found.push(`${place}: <${el.tagName} ${attr}> loads ${target}`);
					}
				}
			},
		})
		.transform(new Response(html))
		.text();
	for (const { origin, kind, target } of await findLoads(html)) {
		found.push(
			kind === "entity" || kind === "unreadable"
				? `${place}: pack cannot read ${origin.label} (${target}), so it cannot tell what it loads`
				: `${place}: ${origin.label} loads ${target}`,
		);
	}
	return found;
}

/**
 * Every file the client code (`scan`, bundle.ts's clientScan output) and the islands would make the browser load, one line each;
 * empty when there is none. Each line is fixed by CLIENT_LOAD_FIX.
 */
export async function clientLoads(scan: string, islands: Island[]): Promise<string[]> {
	const drawn = await Promise.all(
		islands.flatMap(({ view, drawn = {} }) =>
			Object.entries(drawn).map(([param, html]) => drawnLoads(`#${view}/${param}`, html)),
		),
	);
	return [
		...codeLoads(scan),
		...islands.filter(({ view }) => view === undefined).flatMap(propLoads),
		...drawn.flat(),
	];
}
