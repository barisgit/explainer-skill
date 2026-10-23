/**
 * Page classes the kit styles too. The kit's CSS sits in `@layer kit`, so a page rule wins wherever both set a property, but
 * the kit's other properties still reach every element carrying its class: a page component that happens to share a kit class
 * name (`.tree`, added in v0.8.0) is restyled silently. This names such classes so the author can rename theirs.
 *
 * The rule, kept to what that case needs without flagging normal use of the kit:
 * - a kit class counts where the kit styles it on its own: in the first compound of a kit selector that has classes, so `.tree`
 *   in `.tree summary` counts, while `.node` in `.dg .node` (only inside `.dg`) and `.bad` in `.chip.bad` (only with `.chip`)
 *   count only together with those classes;
 * - a page rule collides when the element it styles (its selector's last compound) carries such a kit class and no class the
 *   kit never uses. `ul.tree` and `.card .tree` collide; `.chart.mine` (a variant of the kit's chart) and `.compare th` (a part
 *   inside a kit component) do not, and neither does markup that only uses kit classes.
 * A deliberate restyle of a kit class with a plain rule (`.panel { ... }`) is reported too: the kit's documented classes are no
 * exception, since `.tree` was one.
 * Selectors are read lexically (comments and string contents blanked, attribute selectors and functional pseudo-classes dropped,
 * a single-selector `:is()`/`:where()` unwrapped), which is enough to find classes; a nested page rule counts by its own selector.
 */
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { isKitFile, sourceFiles } from "./kit.ts";
import { KIT_DIR } from "./paths.ts";

/** A stylesheet's text and where the author finds it: `<style>`, a page's stylesheet href, or a kit file relative to kit/. */
interface Sheet {
	where: string;
	css: string;
}

/** A selector as the author wrote it (`written`) and with its strings' contents blanked (`plain`), which is what is parsed. */
interface Selector {
	written: string;
	plain: string;
}

/** Classes the kit styles on its own (`classes` all present), from one of its selectors in `file`. */
interface KitKey {
	classes: string[];
	file: string;
}

const CLASS = /\.(-?[_a-zA-Z][\w-]*)/g;
const classesIn = (text: string) => [...text.matchAll(CLASS)].map((m) => m[1] ?? "");

/** `text` with each match of `pattern` turned into spaces, so offsets into one are offsets into the other. */
const blank = (text: string, pattern: RegExp) =>
	text.replace(pattern, (match) => " ".repeat(match.length));

/** The ranges of a selector list's selectors, at `offset`: split at commas outside parentheses (`:is(.a, .b)` is one). */
function listRanges(list: string, offset: number): [number, number][] {
	const ranges: [number, number][] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < list.length; i++) {
		const char = list[i];
		depth += char === "(" ? 1 : char === ")" ? -1 : 0;
		if (char === "," && depth === 0) {
			ranges.push([offset + start, offset + i]);
			start = i + 1;
		}
	}
	ranges.push([offset + start, offset + list.length]);
	return ranges;
}

/**
 * The selectors of every style rule, comma lists split; at-rule preludes (`@media ...`, `@font-face`) are not selectors.
 * Comments and string contents are blanked first, so a `{`, `;` or `,` inside them ends nothing.
 */
function selectorsOf(css: string): Selector[] {
	const written = blank(css, /\/\*[\s\S]*?\*\//g);
	const plain = written.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, (s) =>
		s.length > 1 ? `${s[0]}${" ".repeat(s.length - 2)}${s[0]}` : s,
	);
	const selectors: Selector[] = [];
	for (const rule of plain.matchAll(/[^{};]+(?=\{)/g)) {
		if (rule[0].trim().startsWith("@")) {
			continue;
		}
		for (const [start, end] of listRanges(rule[0], rule.index)) {
			const cut = (text: string) => text.slice(start, end).trim().replace(/\s+/g, " ");
			selectors.push({ written: cut(written), plain: cut(plain) });
		}
	}
	return selectors.filter(({ plain }) => plain);
}

/**
 * The classes of each compound of a selector (its `plain` form), outermost first. Classes inside `:not()`, `:has()` or a
 * selector list do not select the element, so they are dropped; `:is(.a)` and `:where(.a)` with one selector are `.a`.
 */
function compounds(plain: string): string[][] {
	let text = plain.replace(/\[[^\]]*\]/g, "");
	for (let before = ""; before !== text; ) {
		before = text;
		text = text.replace(/:([\w-]+)\(([^()]*)\)/g, (_, name: string, arg: string) =>
			(name === "is" || name === "where") && !arg.includes(",") ? arg : "",
		);
	}
	return text
		.trim()
		.split(/\s*[>+~]\s*|\s+/)
		.map(classesIn);
}

/** The kit's keys, and every class its selectors mention: a class outside that set is the page's own. */
function readKit(sheets: Sheet[]): { keys: KitKey[]; mentioned: Set<string> } {
	const keys: KitKey[] = [];
	const mentioned = new Set<string>();
	for (const { where, css } of sheets) {
		for (const { plain } of selectorsOf(css)) {
			for (const name of classesIn(plain)) {
				mentioned.add(name);
			}
			const first = compounds(plain).find((classes) => classes.length);
			if (first) {
				keys.push({ classes: first, file: where });
			}
		}
	}
	return { keys, mentioned };
}

/**
 * The page's stylesheets as written (`<style>` elements, local `<link>` files) and the kit stylesheets it links. `localFile`
 * resolves a stylesheet href as pack does, or returns undefined for one pack cannot read (remote or missing), which pack reports.
 */
async function sheetsOf(
	html: string,
	localFile: (href: string) => string | undefined,
): Promise<{ page: Sheet[]; kit: Sheet[] }> {
	const page: Sheet[] = [];
	const kit: Sheet[] = [];
	let style: string[] | undefined;
	await new HTMLRewriter()
		.on("link[rel~=stylesheet][href]", {
			element(el) {
				const href = el.getAttribute("href") ?? "";
				const path = localFile(href);
				if (!path) {
					return;
				}
				if (!isKitFile(path)) {
					return void page.push({ where: href, css: readFileSync(path, "utf8") });
				}
				for (const file of sourceFiles(path)) {
					kit.push({ where: relative(KIT_DIR, file), css: readFileSync(file, "utf8") });
				}
			},
		})
		.on("style", {
			element(el) {
				const text: string[] = [];
				style = text;
				el.onEndTag(() => void page.push({ where: "<style>", css: text.join("") }));
			},
			text(chunk) {
				style?.push(chunk.text);
			},
		})
		.transform(new Response(html))
		.text();
	return { page, kit };
}

/**
 * One warning per kit class that a page rule styles as its own (see the module comment), naming the class, the first such page
 * rule with where it is, and the kit file that styles the class. Empty when the page links no kit stylesheet. `localFile` is
 * pack's resolution of a stylesheet href (see sheetsOf).
 */
export async function classCollisions(
	html: string,
	localFile: (href: string) => string | undefined,
): Promise<string[]> {
	const sheets = await sheetsOf(html, localFile);
	const { keys, mentioned } = readKit(sheets.kit);
	const found = new Map<string, string>();
	for (const { where, css } of sheets.page) {
		for (const { written, plain } of selectorsOf(css)) {
			const subject = compounds(plain).at(-1) ?? [];
			if (!subject.length || !subject.every((name) => mentioned.has(name))) {
				continue;
			}
			const key = keys.find(({ classes }) => classes.every((name) => subject.includes(name)));
			const name = key && `.${key.classes.join(".")}`;
			if (key && name && !found.has(name)) {
				found.set(
					name,
					`${name} is a kit class too (kit ${key.file}), so the kit's rules also reach the page's "${written}" (${where}): rename the page's class unless the rule restyles the kit's`,
				);
			}
		}
	}
	return [...found.values()];
}
