/* Plot axis labels: draws placed axes and tells the layout how much width a category axis needs to retain its tick labels. */
window.PlotAxisLabels = ({ svgText, svgLine, size, pad, gap }) => {
	/** The spacing between adjacent tick labels that keeps them from touching. */
	const labelSpacing = (axis: PlotAxis, textWidth: PlotAxisFrame["textWidth"]) =>
		axis.vertical
			? size() + 6
			: Math.max(...axis.labels.map(textWidth), ...(axis.notes ?? []).map(textWidth)) + 12;

	/** Every nth tick label, so that neighbours do not touch. */
	function labelEvery(axis: PlotAxis, textWidth: PlotAxisFrame["textWidth"]) {
		const [first, second] = axis.ticks;
		if (first === undefined || second === undefined) {
			return 1;
		}
		const step = axis.band || Math.abs(axis.at(second) - axis.at(first));
		return Math.ceil(labelSpacing(axis, textWidth) / step);
	}

	/**
	 * A tick label's class: the picked category's name in ink (the pick of `texts`, so a previewed frame elsewhere leaves it), a
	 * name over its note in ink, else none (muted).
	 */
	const tickClass = (axis: PlotAxis, i: number, picked: number | undefined) =>
		axis.names && picked === i ? "picked" : axis.notes ? "cat" : "";

	/**
	 * The label of one tick, or none when thinned out. Where categories have notes, each name is in ink with its note under it,
	 * the two centred on the band together on a vertical axis.
	 */
	function tickLabel(
		axis: PlotAxis,
		t: number,
		i: number,
		every: number,
		{ L, B, picked }: PlotAxisFrame,
	) {
		const p = axis.at(t);
		const text = i % every === 0 ? axis.labels[i] : undefined;
		if (!text) {
			return "";
		}
		const note = axis.notes?.[i] ?? "";
		const cls = tickClass(axis, i, picked);
		const line = axis.notes ? size() + 4 : 0;
		const [x, y, anchor] = axis.vertical
			? [L - gap - 4, p - line / 2, "end" as const]
			: [p, B + gap + 3 + size() / 2, "middle" as const];
		return (
			svgText(cls, x, y, anchor, text) + (note ? svgText("note", x, y + line, anchor, note) : "")
		);
	}

	/**
	 * Tick labels, axis names and one quiet baseline, without gridlines or tick marks, as Chart draws its axes: the baseline runs
	 * along the category axis (across the plot for lines and stems) at value 0, or the edge nearest 0.
	 */
	function draw(ctx: PlotAxisFrame) {
		const { xa, ya, L, R, T, B, H, textWidth } = ctx;
		let out = "";
		for (const axis of [xa, ya]) {
			const every = labelEvery(axis, textWidth);
			out += axis.ticks.map((t, i) => tickLabel(axis, t, i, every, ctx)).join("");
		}
		out += ya.names
			? svgLine("axis", xa.at(0), xa.at(0), T, B)
			: svgLine("axis", L, R, ya.at(0), ya.at(0));
		out += xa.name ? svgText("name", R, H - size() / 2 - 2, "end", xa.name) : "";
		out += ya.name ? svgText("name", pad, size() / 2 + 3, "start", ya.name) : "";
		return out;
	}

	/** The smallest span that keeps at least the ticks this placed category axis already draws. */
	function labelSpan(axis: PlotAxis, textWidth: PlotAxisFrame["textWidth"]) {
		return axis.band && axis.ticks.length > 1 && axis.labels.some(Boolean)
			? (labelSpacing(axis, textWidth) * axis.ticks.length) / labelEvery(axis, textWidth)
			: 0;
	}

	return { labelSpan, draw };
};
