/**
 * Stand-in colours for the CSS colour expressions of one chart (draw.ts). ECharts draws a stand-in as it would the expression's
 * colour, and the SVG it writes gets the expression back, so the drawing follows light and dark, a page's token overrides and
 * the tone under it.
 *
 * ECharts also derives colours: a visualMap or a gradient it samples mixes two of the colours listed with it linearly in sRGB.
 * The stand-ins are spread through the colour cube, far from each other, from the colours the option writes as they are, and
 * from the lines between any two, so a mix of two opaque expressions is read back as a color-mix() of them, which mixes the same
 * way. Any other colour (mixed with a literal, or of a stand-in that is none of those) has no exact expression: the drawing is
 * then not to be trusted, and draw.ts leaves the figure to the kit script.
 */

type Rgb = [number, number, number];

const toHex = (rgb: Rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;

/** How far apart, per channel, two stand-ins are at least, while the colour cube has room for that. */
const SPACING = 24;
/** How far, per channel, a mixed colour may be from its exact mix: ECharts rounds each channel. */
const ROUNDING = 1.5;
/** How far, per channel, a stand-in or literal is at least from the line between two stand-ins, so no mix of theirs is read as it. */
const OFF_LINE = 4;
/** How many candidates `fresh` tries at SPACING before it settles for any colour clear of the others. */
const TRIES = 2000;
/** Paint values that name no colour of their own, kept as they are. */
const KEYWORDS = /^(none|transparent|currentcolor|url\(#[\w-]+\))$/i;

/** The largest per-channel difference between two colours. */
const apart = (a: Rgb, b: Rgb) => Math.max(...a.map((c, i) => Math.abs(c - (b[i] as number))));

/**
 * Where `c` lies on the line from `a` to `b`: the fraction of the way from a (least squares over the channels) and how far, per
 * channel at most, `c` is off the line there; undefined beyond the ends.
 */
function onLine(c: Rgb, a: Rgb, b: Rgb): { t: number; off: number } | undefined {
	const deltas = b.map((v, i) => v - (a[i] as number));
	const length = deltas.reduce((sum, d) => sum + d * d, 0);
	const t =
		deltas.reduce((sum, d, i) => sum + d * ((c[i] as number) - (a[i] as number)), 0) / length;
	if (!(t > 0 && t < 1)) {
		return undefined;
	}
	const off = Math.max(
		...c.map((v, i) => Math.abs(v - ((a[i] as number) + t * (deltas[i] as number)))),
	);
	return { t, off };
}

/** Whether `c` lies on the line between `a` and `b` (ends excluded), within `tolerance` per channel. */
const between = (c: Rgb, a: Rgb, b: Rgb, tolerance: number) =>
	(onLine(c, a, b)?.off ?? Number.POSITIVE_INFINITY) <= tolerance;

/** The channels of any CSS colour, or undefined for what is not one (an expression, a keyword such as "none", other text). */
function rgbOf(value: string): Rgb | undefined {
	const color = Bun.color(value, "{rgb}");
	return color ? [color.r, color.g, color.b] : undefined;
}

/** The next value of a fixed sequence (a linear congruential generator), so a chart's stand-ins are the same on every pack. */
const next = (seed: number) => (seed * 1103515245 + 12345) % 2 ** 31;

const percent = (share: number) => `${+(share * 100).toFixed(1)}%`;

/** What one chart's option says about its colours, beyond the expressions it stands in for. */
export interface ChartColours {
	/**
	 * Every colour the drawing may hold as it is: those the option writes (#ed5c93, red, rgb(...)) and ECharts' own. Stand-ins
	 * keep clear of them, and they stay as they are.
	 */
	literals: readonly string[];
	/**
	 * The opaque expressions the option lists together (a visualMap's range, a gradient's stops), which ECharts may mix: only
	 * their mixes are read back as such, as a mix with a translucent colour differs in CSS.
	 */
	mixes: readonly (readonly string[])[];
}

/**
 * How the drawing writes one paint attribute's value: `css` for the expression it stood in for, set in the element's style; null
 * for a value kept as it is; undefined when no expression gives that colour exactly.
 */
export type PaintOf = (value: string) => string | null | undefined;

/** The stand-ins of one chart: `color` gives an expression's, `paintOf` reads an SVG paint value back. */
export function standIns({ literals, mixes }: ChartColours) {
	const kept = literals.map(rgbOf).filter((rgb) => rgb !== undefined);
	const expressions: string[] = [];
	const rgbs: Rgb[] = [];
	const byExpression = new Map<string, string>();
	let seed = 1;

	/** Whether `rgb` keeps `spacing` from every stand-in and kept colour, and no kept colour lies on a line it makes with a stand-in. */
	const clear = (rgb: Rgb, spacing: number) =>
		[...rgbs, ...kept].every((s) => apart(rgb, s) >= spacing) &&
		rgbs.every((a) => kept.every((k) => !between(k, a, rgb, OFF_LINE))) &&
		rgbs.every((a, i) => rgbs.slice(i + 1).every((b) => !between(rgb, a, b, OFF_LINE)));

	/** A colour far from every stand-in, every kept colour and every line between two stand-ins. */
	function fresh(): Rgb {
		for (let tries = 0; ; tries++) {
			seed = next(seed);
			const rgb = [seed >> 7, seed >> 15, seed >> 23].map((v) => 16 + (v % 224)) as Rgb;
			if (clear(rgb, tries < TRIES ? SPACING : OFF_LINE)) {
				return rgb;
			}
		}
	}

	/** The stand-in for a colour expression, the same one each time. */
	const color = (expression: string) => {
		let found = byExpression.get(expression);
		if (!found) {
			const rgb = fresh();
			found = toHex(rgb);
			byExpression.set(expression, found);
			expressions.push(expression);
			rgbs.push(rgb);
		}
		return found;
	};

	/** Each two expressions the option lists together, with their stand-ins: the colours ECharts may mix. */
	const mixable = () =>
		mixes.flatMap((group) =>
			group.flatMap((a, i) =>
				group.slice(i + 1).flatMap((b) => {
					const [ra, rb] = [a, b].map((e) => rgbOf(byExpression.get(e) ?? ""));
					return ra && rb && a !== b ? [{ a, b, ra, rb }] : [];
				}),
			),
		);

	/**
	 * The expression for a colour, or the color-mix() of two the option lists together when it lies on the line between their
	 * stand-ins; of several such lines, the one it lies closest to.
	 */
	function expressionFor(rgb: Rgb): string | undefined {
		const exact = rgbs.findIndex((s) => apart(rgb, s) === 0);
		if (exact >= 0) {
			return expressions[exact];
		}
		const [best] = mixable()
			.flatMap(({ a, b, ra, rb }) => {
				const found = onLine(rgb, ra, rb);
				return found && found.off <= ROUNDING ? [{ a, b, ...found }] : [];
			})
			.sort((x, y) => x.off - y.off);
		return best && `color-mix(in srgb, ${best.a} ${percent(1 - best.t)}, ${best.b})`;
	}

	/** A stand-in's expression, or a mix of two; null for a value kept as it is, undefined for a colour no expression gives. */
	const paintOf: PaintOf = (value) => {
		if (KEYWORDS.test(value)) {
			return null;
		}
		const rgb = rgbOf(value);
		if (!rgb || Bun.color(value, "{rgba}")?.a !== 1) {
			return undefined;
		}
		return expressionFor(rgb) ?? (kept.some((k) => apart(rgb, k) === 0) ? null : undefined);
	};
	return { color, paintOf };
}
