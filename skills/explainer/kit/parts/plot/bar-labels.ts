/* plot bar labels: a bar's value label, inside a stacked segment or at a side-by-side bar's end, not referenced from pages: pack
   joins it in front of plot.js with draw.ts, which uses it. PlotBarLabels({ svgLine, svgText, size }) gives barLabel(...), the
   label clear of the markers' lines; text is set at size() px. */
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

	/**
	 * Where a side-by-side bar's label goes: past its end (`dir` is the screen direction it grows), or inside the end when the
	 * panel has no room past it; where a marker's line would cross it there, inside the end when it fits, else past the line.
	 * `from` is where the label starts out from, `inside` whether it runs back into the bar.
	 */
	function endSpot(reach: number, bar: PlotBarGeometry, crossing: readonly number[]) {
		const { length, end, dir, bound } = bar;
		const room = (from: number) => dir * (bound - from) >= reach;
		const clear = (a: number, b: number) =>
			crossing.every((at) => at <= Math.min(a, b) - 2 || at >= Math.max(a, b) + 2);
		const fits = length >= reach + 6;
		const past = (from: number) => ({
			from,
			inside: false,
			ok: room(from) && clear(from + dir * 4, from + dir * reach),
		});
		const back = { from: end, inside: true, ok: fits && clear(end - dir * reach, end - dir * 4) };
		// Where the label goes with no marker in the way, then the other side of the end, then past each line beyond it.
		const usual = room(end) || !fits ? past(end) : back;
		const beyond = crossing.filter((at) => dir * (at - end) > 0).sort((a, b) => dir * (a - b));
		return [usual, usual.inside ? past(end) : back, ...beyond.map(past)].find((s) => s.ok) ?? usual;
	}

	/** Label of a side-by-side bar, where endSpot puts it. */
	function endLabel(
		t: string,
		bar: PlotBarGeometry,
		textWidth: (s: unknown) => number,
		crossing: readonly number[],
	) {
		const { horizontal, mid, dir } = bar;
		const reach = horizontal ? textWidth(t) + 6 : size() + 4;
		const { from, inside } = endSpot(reach, bar, crossing);
		const at = inside ? -dir : dir;
		const [cls, style] = inside ? onBar(bar) : (["value", ""] as const);
		return horizontal
			? svgText(cls, from + at * 6, mid, at > 0 ? "start" : "end", t, style)
			: svgText(cls, mid, from + at * (size() / 2 + 4), "middle", t, style);
	}

	/** A value label: inside a stacked segment when it fits, else at the end of a side-by-side bar. */
	const barLabel = (
		t: string,
		bar: PlotBarGeometry,
		stack: boolean,
		textWidth: (s: unknown) => number,
		crossing: readonly number[],
	) => (stack ? segmentLabel(t, bar, textWidth) : endLabel(t, bar, textWidth, crossing));

	return { barLabel };
};
