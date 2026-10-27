/**
 * The SVG ECharts' SSR writes for a chart (draw.ts), made the kit's: colours back to the CSS expressions they stood in for, and
 * no more than the page needs to show it, since every chart is in the page twice.
 */

/** Turns an SVG colour value back into the CSS expression it stood in for, or undefined when it stood in for none. */
export type ExpressionOf = (value: string) => string | undefined;

/** The SVG attributes that hold a colour. */
const PAINT = /^(fill|stroke|stop-color|flood-color|lighting-color)$/;

/**
 * An element's opening tag with each stand-in colour among its paint attributes moved into its style as the expression, which
 * CSS resolves in place: var(--under) is the tone of the block the chart sits in.
 */
function cssPaint(tag: string, expressionOf: ExpressionOf): string {
	const styles: string[] = [];
	const rest = tag.replace(/\s([\w-]+)="([^"]*)"/g, (whole, name: string, value: string) => {
		const expression = PAINT.test(name) ? expressionOf(value) : undefined;
		if (expression === undefined) {
			return whole;
		}
		styles.push(`${name}:${expression}`);
		return "";
	});
	if (!styles.length) {
		return tag;
	}
	const style = styles.join(";");
	return / style="/.test(rest)
		? rest.replace(/ style="/, ` style="${style};`)
		: rest.replace(/\s*(\/?>)$/, ` style="${style}"$1`);
}

/** How far, in pixels, a dropped point of a line may lie from the line drawn without it: a quarter pixel, which no one sees. */
const TOLERANCE = 0.25;

type Point = [number, number];

/** The distance from `p` to the segment from `a` to `b`. */
function distance([x, y]: Point, [ax, ay]: Point, [bx, by]: Point): number {
	const dx = bx - ax;
	const dy = by - ay;
	const length = dx * dx + dy * dy;
	const t = length ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0;
	return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

/** The points of a polyline that keep it within TOLERANCE of itself (Ramer, Douglas and Peucker), first and last always kept. */
function simplified(points: Point[]): Point[] {
	const keep = new Uint8Array(points.length);
	keep[0] = keep[points.length - 1] = 1;
	const spans: [number, number][] = [[0, points.length - 1]];
	for (let span = spans.pop(); span; span = spans.pop()) {
		const [from, to] = span;
		let far = -1;
		let farthest = TOLERANCE;
		for (let i = from + 1; i < to; i++) {
			const d = distance(points[i] as Point, points[from] as Point, points[to] as Point);
			if (d > farthest) {
				far = i;
				farthest = d;
			}
		}
		if (far > 0) {
			keep[far] = 1;
			spans.push([from, far], [far, to]);
		}
	}
	return points.filter((_, i) => keep[i]);
}

/** A number as a path writes it: at most one decimal, which is a tenth of a pixel. */
const short = (n: number) => String(Math.round(n * 10) / 10);

/**
 * A path of straight lines (M, L and Z commands only, as ECharts writes a line or an area with many points) with the points
 * that do not change its shape left out, the rest written relative to the one before; any other path as it is.
 */
export function shorterPath(d: string): string {
	if (!/^[MLZ\d\s.,-]+$/.test(d)) {
		return d;
	}
	return d
		.split(/(?=M)/)
		.map((sub) => {
			const closed = /Z\s*$/.test(sub);
			const numbers = (sub.match(/-?\d*\.?\d+(?:e-?\d+)?/g) ?? []).map(Number);
			const points: Point[] = [];
			for (let i = 0; i + 1 < numbers.length; i += 2) {
				points.push([numbers[i] as number, numbers[i + 1] as number]);
			}
			if (points.length < 3) {
				return sub;
			}
			const kept = simplified(points).map(
				([x, y]): Point => [Math.round(x * 10), Math.round(y * 10)],
			);
			const [[x0, y0] = [0, 0], ...rest] = kept;
			let [px, py] = [x0, y0];
			const steps = rest.map(([x, y]) => {
				const step = `${short((x - px) / 10)} ${short((y - py) / 10)}`;
				[px, py] = [x, y];
				return step;
			});
			return `M${short(x0 / 10)} ${short(y0 / 10)}l${steps.join(" ")}${closed ? "Z" : ""}`;
		})
		.join("");
}

/** `svg` with every path's points written as shorterPath writes them. */
export const shorterPaths = (svg: string): string =>
	svg.replace(/ d="([^"]*)"/g, (_, d: string) => ` d="${shorterPath(d)}"`);

/**
 * A gradient with each transparent stop (ECharts writes stop-color="none") in the colour of the nearest stop that has one, at
 * no opacity: a fade to transparent keeps its hue, as the canvas draws it, rather than passing through black.
 */
function fadedStops(gradient: string): string {
	const stops = gradient.match(/<stop [^>]*>/g) ?? [];
	/** A stop's colour as it is written (attribute or style), or undefined for a transparent one. */
	const colourOf = (stop = "") => / stop-color="(?!none")[^"]*"|stop-color:[^;"]*/.exec(stop)?.[0];
	const faded = stops.map((stop, i) => {
		if (!stop.includes(' stop-color="none"')) {
			return stop;
		}
		for (let d = 1; d < stops.length; d++) {
			const near = colourOf(stops[i - d]) ?? colourOf(stops[i + d]);
			if (near) {
				const colour = near.startsWith(" ") ? near : ` style="${near}"`;
				return stop.replace(' stop-color="none"', `${colour} stop-opacity="0"`);
			}
		}
		return stop;
	});
	let i = 0;
	return gradient.replace(/<stop [^>]*>/g, () => faded[i++] ?? "");
}

/** Numbers in an attribute value with more than two decimals, which no drawing needs. */
const LONG_DECIMAL = /(\d+\.\d\d)\d+/g;

/**
 * The SVG ECharts wrote, made the kit's: stand-ins back to their expressions; without the hover styles (whose colours ECharts
 * mixed from the stand-ins, and which the live chart replaces), the event metadata, the full-size background and the page's own
 * font family (theme.css sets it); lines without points that change nothing; `svgTag` for its own, so it scales by its viewBox
 * to the size CSS gives it.
 */
export function kitSvg(svg: string, svgTag: string, expressionOf: ExpressionOf): string {
	return shorterPaths(svg)
		.replace(/<style[\s\S]*?<\/style>/g, "")
		.replace(/ (?:ecmeta_\w+|pointer-events)="[^"]*"| class="zr\d+-cls-\d+"/g, "")
		.replace(/<rect width="\d+" height="\d+" x="0" y="0" fill="none"><\/rect>\n?/, "")
		.replace(/font-family:var\(--font\);/g, "")
		.replace(/^<svg [^>]*>/, svgTag)
		.replace(/="([^"]*)"/g, (_, value: string) => `="${value.replace(LONG_DECIMAL, "$1")}"`)
		.replace(/<[a-zA-Z][\w-]*(?:\s[\w:-]+="[^"]*")*\s*\/?>/g, (tag) => cssPaint(tag, expressionOf))
		.replace(/<(linear|radial)Gradient[\s\S]*?<\/\1Gradient>/g, fadedStops)
		.replace(/>\s+</g, "><");
}
