/**
 * Page classes the kit styles too. The kit's CSS sits in `@layer kit`, so a page rule wins wherever both set a property, but
 * the kit's other properties still reach every element carrying its class: a page component that happens to share a kit class
 * name (`.tree`, added in v0.8.0) is restyled silently. This names such classes so the author can rename theirs.
 *
 * The rule, kept to what that case needs without flagging normal use of the kit:
 * - a kit class counts where the kit styles it on its own: in the first compound of a kit selector that has classes, so `.tree`
 *   in `.tree summary` counts, while `.node` in `.dg .node` (only inside `.dg`) and `.bad` in `.chip.bad` (only with `.chip`)
 *   count only together with those classes;
 * - a page rule collides when it sets a property on an element (its selector's last compound, not a pseudo-element) that
 *   carries such a kit class and no class the kit never uses. `ul.tree` and `.card .tree` collide; `.chart.mine` (a variant of
 *   the kit's chart), `.compare th` (a part inside a kit component) and `.tree { li { ... } }` do not, and neither does markup
 *   that only uses kit classes.
 * A deliberate restyle of a kit class with a plain rule (`.panel { ... }`) is reported too: the kit's documented classes are no
 * exception, since `.tree` was one.
 * Selectors are read lexically: comments and string contents blanked, attribute selectors and functional pseudo-classes dropped
 * (a selector list inside `:is()` or `:where()` too; a single selector there is unwrapped), CSS escapes kept as written. That
 * finds the classes of the selectors pages are written with; a nested rule counts by its own selector.
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

/** A class name with its escapes as written, so `.tree\:wide` is not `.tree`. */
const CLASS = /\.(-?(?:[_a-zA-Z]|\\.)(?:[\w-]|\\.)*)/g;
const classesIn = (text: string) => [...text.matchAll(CLASS)].map((m) => m[1] ?? "");
const PSEUDO_ELEMENT = /::|:(?:before|after|first-line|first-letter)\b/;

/**
 * `css` with its comments blanked (`written`), and with its string contents blanked too (`plain`, quotes kept): spaces of the
 * same length, so an offset into one is an offset into the other, and a `{`, `}`, `;` or `,` inside them ends nothing.
 */
function blanked(css: string): { written: string; plain: string } {
	const written = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => " ".repeat(comment.length));
	const plain = written.replace(
		/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g,
		(s) => `${s[0]}${" ".repeat(s.length - 2)}${s[0]}`,
	);
	return { written, plain };
}

/** The selectors of the list at `start`..`end` of `written` and `plain`, split at commas outside parentheses (`:is(.a, .b)`). */
function selectorList(written: string, plain: string, start: number, end: number): Selector[] {
	const cuts = [start - 1];
	let depth = 0;
	for (let i = start; i < end; i++) {
		depth += plain[i] === "(" ? 1 : plain[i] === ")" ? -1 : 0;
		if (plain[i] === "," && depth === 0) {
			cuts.push(i);
		}
	}
	cuts.push(end);
	const cut = (text: string, i: number) =>
		text
			.slice((cuts[i] ?? 0) + 1, cuts[i + 1])
			.trim()
			.replace(/\s+/g, " ");
	return cuts
		.slice(1)
		.map((_, i) => ({ written: cut(written, i), plain: cut(plain, i) }))
		.filter(({ plain }) => plain);
}

/**
 * The selectors of every style rule that sets a property itself, comma lists split: a rule that only wraps nested rules
 * styles nothing, and an at-rule prelude (`@media ...`, `@font-face`) is not a selector.
 */
function selectorsOf(css: string): Selector[] {
	const { written, plain } = blanked(css);
	const selectors: Selector[] = [];
	// The open blocks, innermost last: a style rule's selectors (none for an at-rule) and whether it has a declaration of its own.
	const open: { selectors: Selector[]; declares: boolean }[] = [];
	let from = 0;
	for (const { 0: char, index } of plain.matchAll(/[{};]/g)) {
		const start = from;
		const text = plain.slice(start, index).trim();
		const block = open.at(-1);
		from = index + 1;
		if (char === "{") {
			const atRule = text.startsWith("@");
			open.push({
				selectors: atRule ? [] : selectorList(written, plain, start, index),
				declares: false,
			});
			continue;
		}
		// A declaration ends at `;`, or at `}` when it is the block's last.
		if (block && text) {
			block.declares = true;
		}
		if (char === "}" && open.pop()?.declares) {
			selectors.push(...(block?.selectors ?? []));
		}
	}
	return selectors;
}

/**
 * The compounds of a selector (its `plain` form), outermost first, without attribute selectors and functional pseudo-classes:
 * classes inside `:not()`, `:has()` or a selector list do not select the element; `:is(.a)` and `:where(.a)` are `.a`.
 */
function compounds(plain: string): string[] {
	let text = plain.replace(/\[[^\]]*\]/g, "");
	for (let before = ""; before !== text; ) {
		before = text;
		text = text.replace(/:([\w-]+)\(([^()]*)\)/g, (_, name: string, arg: string) =>
			(name === "is" || name === "where") && !arg.includes(",") ? arg : "",
		);
	}
	return text.trim().split(/\s*[>+~]\s*|\s+/);
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
			const first = compounds(plain)
				.map(classesIn)
				.find((classes) => classes.length);
			if (first) {
				keys.push({ classes: first, file: where });
			}
		}
	}
	return { keys, mentioned };
}

/**
 * The page's stylesheets as written (`<style>` elements, local `<link>` files) and the kit stylesheets it links, outside
 * `<template>`, whose content is inert. `localFile` resolves a stylesheet href as pack does, or returns undefined for one pack
 * cannot read (remote or missing), which pack reports. A style element left open is read to the end of the page, as browsers do.
 */
async function sheetsOf(
	html: string,
	localFile: (href: string) => string | undefined,
): Promise<{ page: Sheet[]; kit: Sheet[] }> {
	const page: Sheet[] = [];
	const kit: Sheet[] = [];
	let templates = 0;
	let style: string[] | undefined;
	const readStyle = () => {
		if (style) {
			page.push({ where: "<style>", css: style.join("") });
			style = undefined;
		}
	};
	await new HTMLRewriter()
		.on("template", {
			element(el) {
				templates++;
				el.onEndTag(() => void templates--);
			},
		})
		.on("link[rel~=stylesheet][href]", {
			element(el) {
				const href = el.getAttribute("href") ?? "";
				const path = templates ? undefined : localFile(href);
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
				if (!templates) {
					style = [];
					el.onEndTag(readStyle);
				}
			},
			text(chunk) {
				style?.push(chunk.text);
			},
		})
		.onDocument({ end: readStyle })
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
			const subject = compounds(plain).at(-1) ?? "";
			const classes = classesIn(subject);
			if (
				!classes.length ||
				PSEUDO_ELEMENT.test(subject) ||
				!classes.every((c) => mentioned.has(c))
			) {
				continue;
			}
			const key = keys.find((k) => k.classes.every((c) => classes.includes(c)));
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
