/**
 * The height a page's own CSS gives a chart, as far as pack can tell without a browser, so what it draws (draw.ts) has the
 * shape the element will have. It reads only top-level rules whose selectors name the element itself by class or id
 * (`.chart.mix`, `#budget-chart`, `div.wide`) and set `block-size` or `height` to a length in px, rem, em, vw or vh, or to
 * clamp(), min() or max() of those. Anything else (a rule inside @media, a descendant selector, a percentage, calc()) is left
 * out, and the theme's height stands; the kit script draws at the real size either way.
 */
import { readFileSync } from "node:fs";

/** The element a chart is drawn for: its classes and id, as the component renders them. */
export interface Place {
	classes: readonly string[];
	id: string | undefined;
}

/** A window size, in CSS pixels, that vw and vh are read against. */
export interface Viewport {
	width: number;
	height: number;
}

/** One rule that sets a chart's height: the compound selectors it applies through, and the value it sets. */
interface HeightRule {
	selectors: { classes: string[]; id: string | undefined }[];
	value: string;
}

const ROOT_FONT = 16;

/** The text of a stylesheet cut at the ends of its top-level blocks and statements, without comments. */
function topLevelChunks(css: string): string[] {
	const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
	const chunks: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		depth += char === "{" ? 1 : char === "}" ? -1 : 0;
		if (depth === 0 && (char === "}" || char === ";")) {
			chunks.push(text.slice(start, i + 1));
			start = i + 1;
		}
	}
	return chunks;
}

/** The rules at the top level of a stylesheet; the blocks nested in a rule are dropped, and at-rules with all they hold. */
function topLevelRules(css: string): { selector: string; body: string }[] {
	return topLevelChunks(css).flatMap((chunk) => {
		const open = chunk.indexOf("{");
		const selector = chunk.slice(0, open).trim();
		if (open < 0 || selector.startsWith("@")) {
			return [];
		}
		let body = chunk.slice(open + 1, -1);
		for (let nested = /[^;{}]*\{[^{}]*\}/g; nested.test(body); nested.lastIndex = 0) {
			body = body.replace(nested, "");
		}
		return [{ selector, body }];
	});
}

/** A compound selector of an optional div and classes and ids only, as its parts; undefined for any other selector. */
function compound(selector: string): { classes: string[]; id: string | undefined } | undefined {
	if (!/^(div)?([.#][\w-]+)+$/.test(selector)) {
		return undefined;
	}
	const classes = [...selector.matchAll(/\.([\w-]+)/g)].map((m) => m[1] as string);
	const ids = [...selector.matchAll(/#([\w-]+)/g)].map((m) => m[1] as string);
	return ids.length > 1 ? undefined : { classes, id: ids[0] };
}

/** The height rules of the stylesheets, in cascade order. */
function heightRules(css: string): HeightRule[] {
	return topLevelRules(css).flatMap(({ selector, body }) => {
		const value = [...body.matchAll(/(?:^|;)\s*(?:block-size|height)\s*:\s*([^;]+)/g)]
			.at(-1)?.[1]
			?.trim();
		const selectors = selector.split(",").map((s) => compound(s.trim()));
		if (!value || selectors.some((s) => s === undefined)) {
			return [];
		}
		return [{ selectors: selectors.filter((s) => s !== undefined), value }];
	});
}

/** The arguments of a CSS function, split at its top-level commas. */
function args(inside: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < inside.length; i++) {
		const char = inside[i];
		depth += char === "(" ? 1 : char === ")" ? -1 : 0;
		if (char === "," && depth === 0) {
			parts.push(inside.slice(start, i));
			start = i + 1;
		}
	}
	return [...parts, inside.slice(start)].map((part) => part.trim());
}

/** A CSS length in pixels at `viewport`, or undefined when it is not one pack can work out. */
export function lengthAt(value: string, viewport: Viewport): number | undefined {
	const plain = /^(-?\d*\.?\d+)(px|rem|em|vw|vh)$/.exec(value.replace(/\s*!important$/, ""));
	if (plain) {
		const n = Number(plain[1]);
		const unit = plain[2];
		const per = {
			px: 1,
			rem: ROOT_FONT,
			em: ROOT_FONT,
			vw: viewport.width / 100,
			vh: viewport.height / 100,
		};
		return n * per[unit as keyof typeof per];
	}
	const call = /^(clamp|min|max)\((.*)\)$/.exec(value);
	const values = call ? args(call[2] as string).map((arg) => lengthAt(arg, viewport)) : [];
	if (!call || !values.length || values.some((v) => v === undefined)) {
		return undefined;
	}
	const [a = 0, b = 0, c = 0] = values as number[];
	if (call[1] === "clamp") {
		return values.length === 3 ? Math.max(a, Math.min(b, c)) : undefined;
	}
	return call[1] === "min" ? Math.min(...(values as number[])) : Math.max(...(values as number[]));
}

/**
 * The height the stylesheets at `paths` give an element at a viewport, from the last rule that applies to it, or undefined
 * when none does (or its value is not one pack can work out).
 */
export function pageHeights(
	paths: Iterable<string>,
): (place: Place, viewport: Viewport) => number | undefined {
	const rules = [...paths].flatMap((path) => heightRules(readFileSync(path, "utf8")));
	return (place, viewport) => {
		const applies = (rule: HeightRule) =>
			rule.selectors.some(
				(s) => s.classes.every((c) => place.classes.includes(c)) && (!s.id || s.id === place.id),
			);
		const rule = rules.findLast(applies);
		return rule && lengthAt(rule.value, viewport);
	};
}
