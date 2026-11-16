/* plot bar labels: a bar's value label, inside a stacked segment or at a side-by-side bar's end, not referenced from pages: pack
   joins it in front of plot.js with draw.ts, which uses it. PlotBarLabels({ svgLine, svgText, size }) gives barLabel(...). */
window.PlotBarLabels = ({ svgText, size }) => {
	/** A value's class and style on its bar: written against the bar's colour, or as a value outside it on an open bar. */
	const onBar = ({ open, colour }: PlotBarGeometry) =>
		open ? (["value", ""] as const) : (["value inside", `--c:${colour}`] as const);

	/** Label of a stacked segment: centred when it fits, else none. */
	function segmentLabel(t: string, bar: PlotBarGeometry, textWidth: (s: unknown) => number) {
		const { horizontal, start, length, mid, each } = bar;
		const tw = textWidth(t);
		const fits = horizontal
			? length >= tw + 10 && each >= size() + 2
			: length >= size() + 6 && each >= tw + 6;
		const centre = start + length / 2;
		const [cls, style] = onBar(bar);
		return fits
			? svgText(cls, horizontal ? centre : mid, horizontal ? mid : centre, "middle", t, style)
			: "";
	}

	/** Label of a side-by-side bar: past its end (`dir` is the screen direction it grows), or inside the end when the panel has no room past it. */
	function endLabel(t: string, bar: PlotBarGeometry, textWidth: (s: unknown) => number) {
		const { horizontal, length, end, mid, dir, bound } = bar;
		const reach = horizontal ? textWidth(t) + 6 : size() + 4;
		const fitsInside = length >= reach + 6;
		const inside = dir * (bound - end) < reach && fitsInside;
		const at = inside ? -dir : dir;
		const [cls, style] = inside ? onBar(bar) : (["value", ""] as const);
		return horizontal
			? svgText(cls, end + at * 6, mid, at > 0 ? "start" : "end", t, style)
			: svgText(cls, mid, end + at * (size() / 2 + 4), "middle", t, style);
	}

	/** A value label: inside a stacked segment when it fits, else at the end of a side-by-side bar. */
	const barLabel = (
		t: string,
		bar: PlotBarGeometry,
		stack: boolean,
		textWidth: (s: unknown) => number,
	) => (stack ? segmentLabel(t, bar, textWidth) : endLabel(t, bar, textWidth));

	return { barLabel };
};
