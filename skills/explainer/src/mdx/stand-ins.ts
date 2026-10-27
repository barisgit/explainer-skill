/**
 * Stand-in colours for the CSS colour expressions of one page's charts (draw.ts). ECharts draws a stand-in as it would the
 * expression's colour, and the SVG it writes gets the expression back, so the drawing follows light and dark, a page's token
 * overrides and the tone under it.
 *
 * ECharts also derives colours: a visualMap or a gradient it samples mixes two colours linearly in sRGB. The stand-ins are
 * spread through the colour cube, far from each other and from the lines between any two, so such a mix is read back as a
 * color-mix() of the two expressions, which mixes the same way.
 */

type Rgb = [number, number, number];

/** How far apart, per channel, two stand-ins are at least, while the colour cube has room for that. */
const SPACING = 24;
/** How far, per channel, a mixed colour may be from its exact mix: ECharts rounds each channel. */
const ROUNDING = 1.5;
/** How far, per channel, a stand-in is at least from the line between two others, so no mix of theirs is read as it. */
const OFF_LINE = 4;
/** How many candidates `fresh` tries at SPACING before it settles for any colour clear of the others. */
const TRIES = 2000;
/**
 * Colours ECharts and authors use as they are (white, black, ECharts' greys and default palette), kept clear of the stand-ins
 * so that none of them is read back as an expression.
 */
const LITERALS: Rgb[] = [
	"#ffffff",
	"#000000",
	"#cccccc",
	"#333333",
	"#666666",
	"#999999",
	"#eeeeee",
	"#cfd2d7",
	"#e8ebf0",
	"#54555a",
	"#5470c6",
	"#91cc75",
	"#fac858",
	"#ee6666",
	"#73c0de",
	"#3ba272",
	"#fc8452",
	"#9a60b4",
	"#ea7ccc",
].map((hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as Rgb);

const hex = (rgb: Rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;

/** The largest per-channel difference between two colours. */
const apart = (a: Rgb, b: Rgb) => Math.max(...a.map((c, i) => Math.abs(c - (b[i] as number))));

/**
 * Where `c` lies between `a` and `b` as a fraction of the way from a, when it is within `tolerance` of that line between
 * them (ends excluded), else undefined.
 */
function between(c: Rgb, a: Rgb, b: Rgb, tolerance: number): number | undefined {
	const deltas = b.map((v, i) => v - (a[i] as number));
	const longest = deltas.reduce(
		(m, d, i) => (Math.abs(d) > Math.abs(deltas[m] as number) ? i : m),
		0,
	);
	const t = ((c[longest] as number) - (a[longest] as number)) / (deltas[longest] as number);
	if (!(t > 0 && t < 1)) {
		return undefined;
	}
	const off = c.some(
		(v, i) => Math.abs(v - ((a[i] as number) + t * (deltas[i] as number))) > tolerance,
	);
	return off ? undefined : t;
}

/** The next value of a fixed sequence (a linear congruential generator), so a page's stand-ins are the same on every pack. */
const next = (seed: number) => (seed * 1103515245 + 12345) % 2 ** 31;

/** The stand-ins of one page: `color` gives an expression's, `expressionOf` reads an SVG colour value back. */
export function standIns() {
	const expressions: string[] = [];
	const rgbs: Rgb[] = [];
	const byExpression = new Map<string, string>();
	let seed = 1;

	/** A colour far from every stand-in, every literal and every line between two stand-ins. */
	function fresh(): Rgb {
		for (let tries = 0; ; tries++) {
			seed = next(seed);
			const rgb = [seed >> 7, seed >> 15, seed >> 23].map((v) => 16 + (v % 224)) as Rgb;
			const spacing = tries < TRIES ? SPACING : OFF_LINE;
			const clear =
				rgbs.every((s) => apart(rgb, s) >= spacing) &&
				LITERALS.every((s) => apart(rgb, s) >= spacing) &&
				rgbs.every((a, i) =>
					rgbs.slice(i + 1).every((b) => between(rgb, a, b, OFF_LINE) === undefined),
				);
			if (clear) {
				return rgb;
			}
		}
	}

	/** The stand-in for a colour expression, the same one each time. */
	const color = (expression: string) => {
		let found = byExpression.get(expression);
		if (!found) {
			const rgb = fresh();
			found = hex(rgb);
			byExpression.set(expression, found);
			expressions.push(expression);
			rgbs.push(rgb);
		}
		return found;
	};

	/** The expression for a colour, or the color-mix() of two when it lies on the line between their stand-ins. */
	function expressionFor(rgb: Rgb): string | undefined {
		const exact = rgbs.findIndex((s) => apart(rgb, s) === 0);
		if (exact >= 0) {
			return expressions[exact];
		}
		for (const [i, a] of rgbs.entries()) {
			for (let j = i + 1; j < rgbs.length; j++) {
				const t = between(rgb, a, rgbs[j] as Rgb, ROUNDING);
				if (t !== undefined) {
					return `color-mix(in srgb, ${expressions[i]} ${percent(1 - t)}, ${expressions[j]})`;
				}
			}
		}
		return undefined;
	}

	/** The expression for an SVG colour value, its alpha mixed in, or undefined when it is not a stand-in or a mix of two. */
	const expressionOf = (value: string) => {
		const [rgb, alpha] = parsed(value) ?? [];
		const expression = rgb && expressionFor(rgb);
		if (!expression) {
			return undefined;
		}
		return alpha === undefined || alpha >= 1
			? expression
			: `color-mix(in srgb, ${expression} ${percent(alpha)}, transparent)`;
	};
	return { color, expressionOf };
}

const percent = (share: number) => `${+(share * 100).toFixed(1)}%`;

/** The channels and alpha of an SVG colour value written #rrggbb, rgb(...) or rgba(...); undefined for anything else. */
function parsed(value: string): [Rgb, number | undefined] | undefined {
	if (/^#[0-9a-f]{6}$/i.test(value)) {
		return [[1, 3, 5].map((i) => Number.parseInt(value.slice(i, i + 2), 16)) as Rgb, undefined];
	}
	const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(value);
	return rgb
		? [
				[Number(rgb[1]), Number(rgb[2]), Number(rgb[3])],
				rgb[4] === undefined ? undefined : Number(rgb[4]),
			]
		: undefined;
}
