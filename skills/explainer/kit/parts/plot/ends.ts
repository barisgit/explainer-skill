/* plot ends: the names a plot's lines carry at their ends in place of a legend, not referenced from pages: pack joins it in front
   of plot.js with draw.ts, which uses it. PlotEnds({ svgLine, svgText, size }) gives fit(...), whether the names go at the ends;
   room(...), the room a name takes right of the plot; and marks(...), the names drawn. */
window.PlotEnds = ({ svgLine, svgText, size }) => {
	const END_GAP = 6; // px between a line's end and its name
	const LEADER = 10; // px more for a name moved off its line's end, which a leader ties to it
	// Names at the line ends fit when, in the narrowest figure the kit lays out (288 px), they leave the plot 55% of it, and when
	// they stack a line of text apart down the plot; else the legend names them.
	const NARROWEST = 288;
	const NAMES_SHARE = 0.45;
	const step = () => size() + 3; // px between the names' lines

	/** px a name at a line's end takes on the right of the plot, with its gap, a leader's room and a margin. */
	const room = (name: string, textWidth: (s: unknown) => number) =>
		END_GAP + LEADER + textWidth(name) + 4;

	/**
	 * Whether the series carry their names at their line ends in place of a legend, above a plot whose bottom edge is `bottom` px
	 * down: two or more have a name, every named one is a line, each name fits the narrowest figure's share (NAMES_SHARE), all
	 * stack a line apart above the bottom edge, and the author left the legend unset (legend: true keeps the legend, false shows
	 * neither). The width never decides it, so one legend serves a copy over all the widths it is shown at.
	 */
	function fit(option: PlotOption, textWidth: (s: unknown) => number, bottom: number) {
		const named = (option.series ?? []).filter((s) => s.name);
		return (
			option.legend === undefined &&
			!option.categories &&
			named.length > 1 &&
			(named.length - 1) * step() <= bottom - size() / 2 &&
			named.every(
				(s) =>
					(s.type ?? "line") === "line" &&
					room(String(s.name), textWidth) <= NARROWEST * NAMES_SHARE,
			)
		);
	}

	/** A name at its line's end, or a leader's length further right with the leader when it was moved. */
	function mark({ name, at, colour, dash }: PlotEndName, y: number) {
		if (Math.abs(y - at.y) < 0.5) {
			return svgText("end", at.x + END_GAP, y, "start", name);
		}
		const x = at.x + END_GAP + LEADER;
		const style = `--c:${colour}${dash ? `;stroke-dasharray:${dash}` : ""}`;
		return svgLine("leader", at.x + 2, x - 3, at.y, y, style) + svgText("end", x, y, "start", name);
	}

	/**
	 * Each name just past its line's last point. Names closer than a line of text apart are spread apart, in order from the top,
	 * and kept above the plot's bottom edge B; a name moved off its line's end sits a leader further right, the leader drawn from
	 * the end in its line's colour and dash.
	 */
	function marks(named: readonly PlotEndName[], B: number) {
		const ends = named.map((end) => ({ end, y: end.at.y })).sort((a, b) => a.y - b.y);
		for (const [k, end] of ends.entries()) {
			end.y = Math.max(end.y, (ends[k - 1]?.y ?? size() / 2 - step()) + step());
		}
		for (let k = ends.length - 1; k >= 0; k--) {
			const end = ends[k] as (typeof ends)[number];
			end.y = Math.min(end.y, (ends[k + 1]?.y ?? B + step()) - step());
		}
		return ends.map(({ end, y }) => mark(end, y)).join("");
	}

	return { fit, room, marks };
};
