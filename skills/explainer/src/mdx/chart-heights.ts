/**
 * The height a page's own CSS gives a chart, so what pack draws (draw.ts) has the shape the element will have, or the word that
 * pack cannot tell. Every rule that sets a chart's height is weighed, wherever it is: one whose selector names the element by
 * classes, ids and `div` alone, outside any at-rule, takes part in the cascade (!important, then specificity, then order) with a
 * length in px, rem, vw or vh, or clamp(), min() or max() of those. A rule that might reach the element but not surely (a
 * descendant or attribute selector, a pseudo-class, @media, nesting), a minimum, maximum or aspect ratio, a value of another kind
 * (a percentage, calc(), em) or a root font size of the page's own makes the height unknown, and draw.ts then draws nothing.
 */
import { readFileSync } from "node:fs";

/**
 * The element a chart is drawn for: its classes and id, as the component renders them. The same shape as
 * kit/components/parts/drawn.ts's Place, which pack's side cannot import: that module's types need the kit's globals.
 */
export interface Place {
	classes: readonly string[];
	id: string | undefined;
}

/** A window size, in CSS pixels, that vw and vh are read against. */
export interface Viewport {
	width: number;
	height: number;
}

/** What pack knows of a chart's height at a viewport: pixels, "theme" when no rule of the page's reaches it, or undefined. */
export type PageHeight = number | "theme" | undefined;

/** An element as selectors see it. */
interface Element extends Place {
	tag: string;
}

/** One declaration of a property this module weighs, with where it stands in the page's stylesheets. */
interface Declaration {
	/** The rule's selectors, nesting resolved into :is() of the parent's. */
	selectors: string[];
	/** Inside an at-rule that holds rules only in some windows, layers or documents. */
	conditional: boolean;
	property: string;
	value: string;
	important: boolean;
	order: number;
}

/** A selector's weight in the cascade: ids, classes, types. */
type Specificity = [number, number, number];

/** The properties that set the height, and those that bound or derive it, which pack does not weigh. */
const HEIGHT = new Set(["height", "block-size"]);
const BOUNDS = new Set([
	"min-height",
	"max-height",
	"min-block-size",
	"max-block-size",
	"aspect-ratio",
]);
/** The properties that set the root font size rem lengths are read against. */
const FONT = new Set(["font-size", "font"]);
/** At-rules whose rules hold in some windows, layers or documents only; the others' contents set no element's height. */
const GROUPING = new Set([
	"media",
	"supports",
	"container",
	"layer",
	"scope",
	"document",
	"starting-style",
]);

const ROOT_FONT = 16;
const CHART_TAG = "div";
const ROOT: Element = { tag: "html", classes: [], id: undefined };

/** The index of the character closing the bracket that opens at `open`, skipping quoted strings. */
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
	for (let i = 0; i < text.length; i++) {
		const char = text[i] as string;
		depth += "([".includes(char) ? 1 : ")]".includes(char) ? -1 : 0;
		if (char === separator && depth === 0) {
			parts.push(text.slice(start, i));
			start = i + 1;
		}
	}
	return [...parts, text.slice(start)].map((part) => part.trim()).filter(Boolean);
}

/** Where a block sits: the selectors of the rule around it, if any, and whether an at-rule makes it conditional. */
interface Scope {
	selectors: string[] | undefined;
	conditional: boolean;
}

/** The selectors of a rule in `scope`, nested ones resolved against the parent's as :is() of them. */
function resolved(prelude: string, scope: Scope): string[] {
	const own = splitTop(prelude, ",");
	if (!scope.selectors) {
		return own;
	}
	const parent = `:is(${scope.selectors.join(", ")})`;
	return own.map((s) => (s.includes("&") ? s.replaceAll("&", parent) : `${parent} ${s}`));
}

/** The declarations of the weighed properties in a block of CSS, appended to `out` in order. */
function collect(text: string, scope: Scope, out: Declaration[]): void {
	let start = 0;
	const declaration = (source: string) => {
		const found = /^\s*([\w-]+)\s*:\s*([\s\S]*?)\s*(!\s*important)?\s*$/i.exec(source);
		const property = found?.[1]?.toLowerCase() ?? "";
		if (
			found &&
			scope.selectors &&
			(HEIGHT.has(property) || BOUNDS.has(property) || FONT.has(property))
		) {
			const { selectors, conditional } = scope;
			out.push({
				selectors,
				conditional,
				property,
				value: found[2] ?? "",
				important: Boolean(found[3]),
				order: out.length,
			});
		}
	};
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (char === '"' || char === "'") {
			i = Math.max(i, text.indexOf(char, i + 1));
		} else if (char === ";") {
			declaration(text.slice(start, i));
			start = i + 1;
		} else if (char === "{") {
			const end = closing(text, i);
			block(text.slice(start, i).trim(), text.slice(i + 1, end), scope, out);
			i = end;
			start = end + 1;
		}
	}
	declaration(text.slice(start));
}

/** A block's contents collected in the scope it makes: an at-rule's, or a rule's. */
function block(prelude: string, body: string, scope: Scope, out: Declaration[]): void {
	const atRule = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase();
	if (atRule === undefined) {
		collect(body, { ...scope, selectors: resolved(prelude, scope) }, out);
	} else if (GROUPING.has(atRule)) {
		collect(body, { ...scope, conditional: true }, out);
	}
}

/** The last compound selector of a complex one, and whether a combinator comes before it. */
function subjectOf(selector: string): { compound: string; combined: boolean } {
	let depth = 0;
	let start = 0;
	let gap = false;
	for (let i = 0; i < selector.length; i++) {
		const char = selector[i] as string;
		depth += "([".includes(char) ? 1 : ")]".includes(char) ? -1 : 0;
		if (depth === 0 && /[\s>+~]/.test(char)) {
			gap = true;
		} else if (gap) {
			start = i;
			gap = false;
		}
	}
	return { compound: selector.slice(start), combined: start > 0 };
}

const SIMPLE = String.raw`\.[\w-]+|#[\w-]+|\[[^\]]*\]|::?[\w-]+(?:\((?:[^()]|\([^()]*\))*\))?`;
const COMPOUND = new RegExp(String.raw`^(\*|[a-zA-Z][\w-]*)?((?:${SIMPLE})*)$`);
const PSEUDO_ELEMENT = /^(::|:(before|after|first-line|first-letter)$)/i;

/**
 * Whether a selector matches `element`: "no" when its last compound rules the element out, its specificity when it surely
 * matches, "maybe" when only a browser could tell.
 */
function matches(
	selector: string,
	element: Element,
	conditional: boolean,
): "no" | "maybe" | Specificity {
	const { compound, combined } = subjectOf(selector);
	const parsed = COMPOUND.exec(compound);
	if (!parsed) {
		return "maybe";
	}
	const [, tag, rest = ""] = parsed;
	const simples = rest.match(new RegExp(SIMPLE, "g")) ?? [];
	const ruledOut =
		simples.some((s) => PSEUDO_ELEMENT.test(s)) ||
		(tag !== undefined && tag !== "*" && tag.toLowerCase() !== element.tag) ||
		simples.some((s) => s.startsWith(".") && !element.classes.includes(s.slice(1))) ||
		simples.some((s) => s.startsWith("#") && s.slice(1) !== element.id);
	if (ruledOut) {
		return "no";
	}
	if (combined || conditional || simples.some((s) => !/^[.#]/.test(s))) {
		return "maybe";
	}
	const ids = simples.filter((s) => s.startsWith("#")).length;
	return [ids, simples.length - ids, tag && tag !== "*" ? 1 : 0];
}

/** How a declaration reaches `element`: not at all, maybe, or surely with the specificity of its weightiest selector. */
function reach(declaration: Declaration, element: Element): "no" | "maybe" | Specificity {
	let best: "no" | "maybe" | Specificity = "no";
	for (const selector of declaration.selectors) {
		const found = matches(selector, element, declaration.conditional);
		if (found === "maybe") {
			return "maybe";
		}
		if (found !== "no" && (best === "no" || compare(found, best) > 0)) {
			best = found;
		}
	}
	return best;
}

/** Which of two weights wins the cascade: positive for the first. */
function compare(a: readonly number[], b: readonly number[]): number {
	for (const [i, x] of a.entries()) {
		const d = x - (b[i] as number);
		if (d) {
			return d;
		}
	}
	return 0;
}

/** The arguments of a CSS function, split at its top-level commas. */
const functionArguments = (inside: string) => splitTop(inside, ",");

/** A CSS length in pixels at `viewport`, or undefined when it is not one pack can work out. */
function lengthAt(value: string, viewport: Viewport): number | undefined {
	const plain = /^(-?\d*\.?\d+)(px|rem|vw|vh)$/.exec(value);
	if (plain) {
		const pixelsPer = {
			px: 1,
			rem: ROOT_FONT,
			vw: viewport.width / 100,
			vh: viewport.height / 100,
		};
		return Number(plain[1]) * pixelsPer[plain[2] as keyof typeof pixelsPer];
	}
	const call = /^(clamp|min|max)\((.*)\)$/.exec(value);
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

/**
 * The declaration that sets `element`'s height in the cascade, null when none reaches it, or undefined when one might reach it
 * and pack cannot tell (or one bounds the height).
 */
function cascadeWinner(
	declarations: Declaration[],
	element: Element,
): Declaration | null | undefined {
	let winner: { declaration: Declaration; weight: number[] } | null = null;
	for (const declaration of declarations) {
		const found = reach(declaration, element);
		if (found === "maybe" || (found !== "no" && BOUNDS.has(declaration.property))) {
			return undefined;
		}
		const weight =
			found === "no" ? undefined : [Number(declaration.important), ...found, declaration.order];
		if (weight && (!winner || compare(weight, winner.weight) > 0)) {
			winner = { declaration, weight };
		}
	}
	return winner?.declaration ?? null;
}

/** The height the stylesheets at `paths` give a chart at a viewport, as PageHeight says. */
export function pageHeights(
	paths: Iterable<string>,
): (place: Place, viewport: Viewport) => PageHeight {
	const declarations: Declaration[] = [];
	for (const path of paths) {
		const css = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
		collect(css, { selectors: undefined, conditional: false }, declarations);
	}
	// rem, and the theme's own heights, are read at the browser's root font size, unless the page may set its own.
	const fonts = declarations.filter((d) => FONT.has(d.property));
	const rootFontKnown = fonts.every((d) => reach(d, ROOT) === "no");
	const heights = declarations.filter((d) => !FONT.has(d.property));
	return (place, viewport) => {
		const winner = rootFontKnown ? cascadeWinner(heights, { ...place, tag: CHART_TAG }) : undefined;
		return winner === null ? "theme" : winner && lengthAt(winner.value, viewport);
	};
}
