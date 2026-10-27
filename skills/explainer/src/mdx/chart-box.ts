/**
 * The size a figure's element has, so what pack draws (draw.ts) has its shape: the height comes from the kit (the theme's, its
 * `tall` class, or the `height` prop), and a page's own CSS may not change the element's box. A rule that may reach the element
 * and sets its size, padding, border, `all` or `box-sizing` makes draw.ts draw nothing, as does a page rule that may set the
 * root font size the rem lengths are read against.
 */
import { readFileSync } from "node:fs";

/**
 * The element a figure is drawn for: its classes, id and `height` prop, as the component renders them. The same shape as
 * kit/components/parts/drawn.ts's Place, which pack's side cannot import: that module's types need the kit's globals.
 */
export interface Place {
	classes: readonly string[];
	id: string | undefined;
	height: string | undefined;
}

/** A window size, in CSS pixels, that vw and vh are read against. */
export interface Viewport {
	width: number;
	height: number;
}

/** An element as selectors see it; `attributes` are all it has, when that is known. */
interface Element {
	tag: string;
	classes: readonly string[];
	id: string | undefined;
	attributes?: readonly string[];
}

/** A rule: its selectors and the properties it declares itself. */
interface Rule {
	selectors: string[];
	properties: string[];
}

/** The properties that size or reshape an element's box. */
const BOX =
	/^(?:(?:min-|max-)?(?:height|width|block-size|inline-size)|aspect-ratio|box-sizing|all|padding|border)(?:-[\w-]+)?$/;
/** The properties that set the font size rem is read against, on the root. */
const FONT = /^font(?:-size)?$/;
/** At-rules whose rules hold in some windows, layers or documents; the others' contents style no element. */
const GROUPING = /^@(?:media|supports|container|layer|scope|document|starting-style)\b/i;

/** The attributes the Chart and Plot components render on their element. */
const FIGURE_ATTRIBUTES = ["class", "id", "role", "aria-label", "style"];
const ROOT_FONT = 16;
const ROOT: Element = { tag: "html", classes: [], id: undefined };

/** The index of the character closing the brace that opens at `open`, skipping quoted strings. */
function closing(text: string, open: number): number {
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		const char = text[i];
		if (char === '"' || char === "'") {
			i = text.indexOf(char, i + 1);
			if (i < 0) {
				return text.length;
			}
		} else if (char === "{") {
			depth++;
		} else if (char === "}" && --depth === 0) {
			return i;
		}
	}
	return text.length;
}

/** `text` split at the top-level occurrences of `separator`, outside brackets and parentheses. */
function splitTop(text: string, separator: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let start = 0;
	for (const [i, char] of [...text].entries()) {
		depth += "([".includes(char) ? 1 : ")]".includes(char) ? -1 : 0;
		if (char === separator && depth === 0) {
			parts.push(text.slice(start, i));
			start = i + 1;
		}
	}
	return [...parts, text.slice(start)].map((part) => part.trim()).filter(Boolean);
}

/**
 * The rules in a block of CSS, appended to `out`: a nested rule is its own, with the selector as written (it may begin with &,
 * which `mayMatch` takes as matching), and the at-rules that group rules are looked through.
 */
function scan(text: string, selectors: string[] | undefined, out: Rule[]): void {
	let start = 0;
	let flat = "";
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (char === '"' || char === "'") {
			i = Math.max(i, text.indexOf(char, i + 1));
		} else if (char === "{") {
			const end = closing(text, i);
			const before = text.slice(start, i);
			const semicolon = before.lastIndexOf(";");
			flat += before.slice(0, semicolon + 1);
			const prelude = before.slice(semicolon + 1).trim();
			const body = text.slice(i + 1, end);
			if (!prelude.startsWith("@")) {
				scan(body, splitTop(prelude, ","), out);
			} else if (GROUPING.test(prelude)) {
				scan(body, selectors, out);
			}
			i = end;
			start = end + 1;
		}
	}
	flat += text.slice(start);
	const properties = flat.split(";").map((d) => d.slice(0, d.indexOf(":")).trim().toLowerCase());
	if (selectors && properties.some((p) => BOX.test(p) || FONT.test(p))) {
		out.push({ selectors, properties });
	}
}

/** The last compound selector of a complex one: what follows its last combinator. */
function lastCompound(selector: string): string {
	let depth = 0;
	let start = 0;
	for (const [i, char] of [...selector].entries()) {
		depth += "([".includes(char) ? 1 : ")]".includes(char) ? -1 : 0;
		if (depth === 0 && /[\s>+~]/.test(char)) {
			start = i + 1;
		}
	}
	return selector.slice(start);
}

const SIMPLE = String.raw`\.[\w-]+|#[\w-]+|\[[^\]]*\]|::?[\w-]+(?:\((?:[^()]|\([^()]*\))*\))?`;
const COMPOUND = new RegExp(String.raw`^(\*|[a-zA-Z][\w-]*)?((?:${SIMPLE})*)$`);
const PSEUDO_ELEMENT = /^(::|:(before|after|first-line|first-letter)$)/i;

/**
 * Whether a selector may match `element`: false only when its last compound rules the element out (another tag, a class, id or
 * attribute it lacks, a pseudo-element); a combinator or pseudo-class before it is left to the browser, and so is what this
 * cannot parse.
 */
function mayMatch(selector: string, element: Element): boolean {
	const parsed = COMPOUND.exec(lastCompound(selector));
	if (!parsed) {
		return true;
	}
	const [, tag, rest = ""] = parsed;
	const simples = rest.match(new RegExp(SIMPLE, "g")) ?? [];
	return !(
		simples.some((s) => PSEUDO_ELEMENT.test(s)) ||
		(tag !== undefined && tag !== "*" && tag.toLowerCase() !== element.tag) ||
		simples.some((s) => s.startsWith(".") && !element.classes.includes(s.slice(1))) ||
		simples.some((s) => s.startsWith("#") && s.slice(1) !== element.id) ||
		simples.some((s) => {
			const name = /^\[\s*([\w-]+)/.exec(s)?.[1]?.toLowerCase();
			return name !== undefined && element.attributes?.includes(name) === false;
		})
	);
}

/**
 * Whether the stylesheets at `paths` may change the box of a figure's element, or the root font size its rem lengths are read
 * against: the returned function says it for a place.
 */
export function pageBoxTouch(paths: Iterable<string>): (place: Place) => boolean {
	const rules: Rule[] = [];
	for (const path of paths) {
		scan(readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, ""), undefined, rules);
	}
	const reaches = (rule: Rule, element: Element, property: RegExp) =>
		rule.properties.some((p) => property.test(p)) &&
		rule.selectors.some((s) => mayMatch(s, element));
	const rootFont = rules.some((rule) => reaches(rule, ROOT, FONT));
	return (place) =>
		rootFont ||
		rules.some((rule) =>
			reaches(rule, { tag: "div", ...place, attributes: FIGURE_ATTRIBUTES }, BOX),
		);
}

/** The arguments of a CSS function, split at its top-level commas. */
const functionArguments = (inside: string) => splitTop(inside, ",");

/** A CSS length in pixels at `viewport`, or undefined when it is not one pack can work out: px, rem, vw, vh, clamp(), min(), max(). */
export function lengthAt(value: string, viewport: Viewport): number | undefined {
	const plain = /^(-?\d*\.?\d+)(px|rem|vw|vh)$/.exec(value.trim());
	if (plain) {
		const pixelsPer = {
			px: 1,
			rem: ROOT_FONT,
			vw: viewport.width / 100,
			vh: viewport.height / 100,
		};
		return Number(plain[1]) * pixelsPer[plain[2] as keyof typeof pixelsPer];
	}
	const call = /^(clamp|min|max)\((.*)\)$/.exec(value.trim());
	if (!call) {
		return undefined;
	}
	const values = functionArguments(call[2] ?? "").map((arg) => lengthAt(arg, viewport));
	const lengths = values.filter((v) => v !== undefined);
	if (!lengths.length || lengths.length < values.length) {
		return undefined;
	}
	if (call[1] === "clamp") {
		const [least = 0, preferred = 0, most = 0] = lengths;
		return lengths.length === 3 ? Math.max(least, Math.min(preferred, most)) : undefined;
	}
	return call[1] === "min" ? Math.min(...lengths) : Math.max(...lengths);
}
