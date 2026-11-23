/* PlotStems draws a stem series and gives the value-label boxes that names and notes keep clear of. */
window.PlotStems = ({ svgLine, svgText, size, colour, labeller, finite, px }) => {
	const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

	/** A stem series' stems in px from `base` to each dot, with the value each prints (`t`) and where (x, y: its middle). */
	function stemsOf(s: PlotSeries, i: number, { X, Y, ya, W, textWidth, texts }: PlotStemFrame) {
		const said = texts.series?.[i]?.data;
		const base = Y(clamp(0, ya.lo, ya.hi));
		const format = labeller(s.label, ya.format, true);
		return s.data.flatMap((p, k) => {
			if (!finite(p)) {
				return [];
			}
			const [cx, cy] = [X(p[0]), Y(p[1])];
			const [tx, ty] = (said?.[k] ?? p) as PlotPoint;
			const t = format?.(ty, k, tx) ?? "";
			const half = t ? textWidth(t) / 2 : 0;
			const value = {
				t,
				x: clamp(cx, half + 4, W - half - 4),
				y: cy <= base ? Math.max(cy - 14, size()) : cy + 14,
				half,
			};
			return [{ base, cx: px(cx), cy, value }];
		});
	}
	/** The boxes of the values the stems print, which names and notes keep off. */
	const values = (series: readonly PlotSeries[], ctx: PlotStemFrame) =>
		series.flatMap((s, i) =>
			ctx.shown[i] && s.type === "stem"
				? stemsOf(s, i, ctx).flatMap(({ value: { t, x, y, half } }) =>
						t ? [{ x0: x - half, x1: x + half, y0: y - size() / 2, y1: y + size() / 2 }] : [],
					)
				: [],
		);

	/** Nearest horizontal neighbour in the drawing, independent of the series' data order. */
	function stemSpacing(centres: number[]) {
		centres.sort((a, b) => a - b);
		return new Map(
			centres.map((x, i) => [
				x,
				Math.min(x - (centres[i - 1] ?? -Infinity), (centres[i + 1] ?? Infinity) - x),
			]),
		);
	}

	function draw(s: PlotSeries, i: number, ctx: PlotStemFrame) {
		const stems = stemsOf(s, i, ctx);
		const spacing = stemSpacing(stems.map(({ cx }) => cx));
		const ink = `--c:${colour(s, i)}`;
		return stems
			.map(({ base, cx, cy, value: { t, x, y } }) => {
				const gap = spacing.get(cx) ?? Infinity;
				// Leave about 1 px between dots; once a dot would be as thin as a stem, the line alone reads better.
				const radius = px(Math.min(4.5, (gap - 1) / 2));
				const width = s.width ?? px(Math.max(0.5, Math.min(2.5, gap / 2)));
				const style = `${ink};--w:${width}`;
				const dot =
					radius > 1.25
						? `<circle class="dot" style="${style}" cx="${cx}" cy="${px(cy)}" r="${radius}"/>`
						: "";
				const text = t ? svgText("value", x, y, "middle", t) : "";
				return svgLine("stem", cx, cx, base, cy, style) + dot + text;
			})
			.join("");
	}

	return { draw, values };
};
