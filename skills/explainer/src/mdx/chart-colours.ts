/**
 * What a Chart's option says about its colours, for stand-ins.ts, and whether pack can draw the chart with exact colours at
 * all (draw.ts). The kit's contract: a palette token (`var(--c1)`, `var(--accent)`) is an opaque colour, so ECharts mixing two
 * of them is the same mix as CSS's color-mix() of them.
 */
import type { ChartColours } from "./stand-ins.ts";

/** The keys under which ECharts changes a colour's alpha or hue instead of using it as written. */
const TRANSFORMS = new Set(["colorAlpha", "colorLightness", "colorSaturation", "colorHue"]);
/** The keys under which an option writes a colour or a list of them, as kit/parts/charts/option.ts reads them. */
const COLOR_KEY = /(olor|^fill|^stroke)$/;
/** The colour expressions pack stands in for, as kit/parts/charts/option.ts finds them. */
const COLOR_EXPR = /^(var|color-mix|light-dark)\(/;
const BARE_TOKEN = /^var\(--[\w-]+\)$/;

/** A value in an option, the key it sits under (an array's items sit under the array's), and whether a visualMap holds it. */
interface Node {
	value: unknown;
	key: string;
	mapped: boolean;
}

/** Every value in an option, with where it sits. */
function* nodes(value: unknown, key = "", mapped = false): Generator<Node> {
	yield { value, key, mapped };
	if (value !== null && typeof value === "object") {
		for (const [name, item] of Object.entries(value)) {
			const under = Array.isArray(value) ? key : name;
			yield* nodes(item, under, mapped || under === "visualMap");
		}
	}
}

/** The palette tokens an array lists, as strings or under its items' colour keys: the colours ECharts may mix. */
const listed = (items: unknown[]) =>
	items.flatMap((item) => {
		const values =
			item !== null && typeof item === "object"
				? Object.entries(item).flatMap(([key, value]) => (COLOR_KEY.test(key) ? [value] : []))
				: [item];
		return values.filter((v): v is string => typeof v === "string" && BARE_TOKEN.test(v));
	});

/**
 * The colours `option` writes as they are, with `own` (ECharts' own), and the tokens it lists together. Undefined when the
 * drawing could not be exact: a colour that is a function (its result is unknown), one ECharts transforms (alpha, lightness,
 * saturation, hue, or a visualMap's opacity), or a markArea, which replaces the alpha of its fill, beside a colour that may be
 * translucent.
 */
export function chartColours(option: unknown, own: readonly string[]): ChartColours | undefined {
	const all = [...nodes(option)];
	const strings = all.flatMap(({ value }) => (typeof value === "string" ? [value] : []));
	const expressions = strings.filter((v) => COLOR_EXPR.test(v));
	const unreadable = all.some(
		({ value, key, mapped }) =>
			TRANSFORMS.has(key) ||
			(mapped && key === "opacity") ||
			(typeof value === "function" && COLOR_KEY.test(key)),
	);
	const replacesAlpha = all.some(({ key }) => key === "markArea");
	if (unreadable || (replacesAlpha && expressions.some((e) => !BARE_TOKEN.test(e)))) {
		return undefined;
	}
	const mixes = all.flatMap(({ value }) => (Array.isArray(value) ? [listed(value)] : []));
	return {
		literals: [
			...own,
			...strings.filter((v) => !COLOR_EXPR.test(v) && Bun.color(v, "css") !== null),
		],
		mixes: mixes.filter((group) => group.length > 1),
	};
}
