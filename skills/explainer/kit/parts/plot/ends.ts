/* plot ends: what a plot's lines say at their ends, their names in place of a legend and a labelled line's last value, not
   referenced from pages: pack joins it in front of plot.js with draw.ts, which uses it. PlotEnds({ svgLine, svgText, size,
   place, format, colour, dash, wrap }) gives fit(...), whether the names go at the ends; named(...), the lines with text there;
   room(...), the room a name takes right of the plot; and marks(...), the texts drawn, placed with the plot's other labels. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the function only scopes the part's names away from the page; the code in it is split into small functions
window.PlotEnds = ({ svgLine, svgText, size, place, format, colour, dash, wrap }) => {
	const END_GAP = 6; // px between a line's end and its name
	const LEADER = 10; // px more for a name moved off its line's end, which a leader ties to it
	// Names at the line ends fit when, in the narrowest figure the kit lays out (288 px), they leave the plot 55% of it, and when
	// they stack a line of text apart down the plot; else the legend names them.
	const NARROWEST = 288;
	const NAMES_SHARE = 0.45;
	const step = () => size() + 3; // px between the names' lines
	/** px a line's end text takes across with its gap, a leader's room and a margin. */
	const across = (width: number) => END_GAP + LEADER + width + 4;
	// px a line of a line's end text may take: the names' share of the narrowest figure; a text wraps to it on two lines at most.
	const MOST = NARROWEST * NAMES_SHARE - across(0);

	/** A line's end text wrapped to MOST, or none past two lines. */
	function wrapped(text: string, textWidth: (s: unknown) => number) {
		const lines = wrap(text, MOST, textWidth);
		return lines.length <= 2 && Math.max(...lines.map(textWidth)) <= MOST ? lines : [];
	}
	/** px a text at a line's end takes on the right of the plot, wrapped. */
	const room = (name: string, textWidth: (s: unknown) => number) =>
		across(Math.max(0, ...wrapped(name, textWidth).map(textWidth)));

	const finite = (p: number | PlotPoint): p is PlotPoint =>
		typeof p !== "number" && Number.isFinite(p[0]) && Number.isFinite(p[1]);
	/** A line's label of its last point, which it writes after its name at its end; "" without one. */
	function lastValue(option: PlotOption, s: PlotSeries) {
		const k = s.data.findLastIndex(finite);
		const last = s.data[k];
		const label =
			(s.type ?? "line") === "line" &&
			format.labeller(s.label, format.formatter(option.y?.format), true);
		return label && last && finite(last) ? label(last[1], k, last[0]) : "";
	}
	/** What a line's end says with names at the ends: its name, then its last value ("10 kΩ: 847 ns"). */
	const nameAndValue = (option: PlotOption, s: PlotSeries) =>
		[s.name, lastValue(option, s)].filter(Boolean).join(": ");

	/**
	 * Whether the series carry their names at their line ends in place of a legend, above a plot whose bottom edge is `bottom` px
	 * down: two or more have a name, every named one is a line, each name fits the narrowest figure's share (NAMES_SHARE), all
	 * stack a line apart above the bottom edge, and the author left the legend unset (legend: true keeps the legend, false shows
	 * neither). The width never decides it, so one legend serves a copy over all the widths it is shown at.
	 */
	function fits(option: PlotOption, textWidth: (s: unknown) => number, bottom: number) {
		const named = (option.series ?? []).filter((s) => s.name);
		return (
			option.legend === undefined &&
			!option.categories &&
			named.length > 0 &&
			(named.length - 1) * step() <= bottom - size() / 2 &&
			named.every(
				(s) =>
					(s.type ?? "line") === "line" &&
					across(textWidth(nameAndValue(option, s))) <= NARROWEST * NAMES_SHARE,
			)
		);
	}

	/**
	 * The lines that carry text at their ends, with their index: name and value when names fit there, else the value alone, left
	 * out when it takes more than two lines of MOST.
	 */
	function named(option: PlotOption, textWidth: (s: unknown) => number, bottom: number) {
		const names = fits(option, textWidth, bottom);
		return (option.series ?? []).flatMap((s, i) => {
			const name = names && s.name ? nameAndValue(option, s) : lastValue(option, s);
			return name && wrapped(name, textWidth).length ? [{ s, i, name }] : [];
		});
	}

	/** A name at y right of its line's end, a leader's length further right with the leader when it was moved off the end. */
	function classic({ name, at, colour, dash }: PlotEndName, y: number, f: PlotNoteFrame) {
		const moved = Math.abs(y - at.y) >= 0.5;
		const x = at.x + END_GAP + (moved ? LEADER : 0);
		const half = step() / 2 - 1; // names spread a step apart keep apart
		const box = { x0: x, x1: x + f.textWidth(name), y0: y - half, y1: y + half };
		const style = `--c:${colour}${dash ? `;stroke-dasharray:${dash}` : ""}`;
		const leader = moved ? svgLine("leader", at.x + 2, x - 3, at.y, y, style) : "";
		return {
			box,
			lines: [name],
			anchor: "start" as const,
			markup: leader + svgText("end", x, y, "start", name),
		};
	}

	/**
	 * The spots right beside a line's end, in the order they are preferred: above it on the right and on the left, below it on
	 * the right and on the left, and level with it on the left; each on one line, then as its name and value on two, then wrapped.
	 * Each is moved inside the frame, so a name near an edge stays over or under its end.
	 */
	function besideSpots({ name, at }: PlotEndName, f: PlotNoteFrame): PlotSpot[] {
		const cut = name.indexOf(": ");
		const layouts = [
			[name],
			...(cut > 0 ? [[name.slice(0, cut + 1), name.slice(cut + 2)]] : []),
			wrapped(name, f.textWidth),
		];
		return layouts.flatMap((lines) => {
			const w = Math.max(...lines.map(f.textWidth));
			const h = lines.length * f.line;
			const spot = (x0: number, y0: number, anchor: PlotSpot["anchor"]): PlotSpot => {
				const left = Math.min(Math.max(x0, f.L), f.R - w);
				const top = Math.min(Math.max(y0, f.T), f.B - h);
				return { box: { x0: left, x1: left + w, y0: top, y1: top + h }, lines, anchor };
			};
			const [above, below] = [at.y - 4 - h, at.y + 4];
			return [
				spot(at.x + 2, above, "start"),
				spot(at.x - 2 - w, above, "end"),
				spot(at.x + 4, below, "start"),
				spot(at.x - 4 - w, below, "end"),
				spot(at.x - END_GAP - w, at.y - h / 2, "end"),
			];
		});
	}

	/** A spot's lines of text, one <text> a line. */
	function spotText({ box, lines, anchor }: PlotSpot, line: number) {
		const x = anchor === "start" ? box.x0 : anchor === "end" ? box.x1 : (box.x0 + box.x1) / 2;
		return lines.map((t, k) => svgText("end", x, box.y0 + line / 2 + k * line, anchor, t)).join("");
	}

	/**
	 * Each name just past its line's last point. Names closer than a line of text apart, and sharing some of their width, are
	 * spread apart, in order from the top, and kept above the plot's bottom edge; a name moved off its line's end sits a leader further right, the leader drawn from
	 * the end in its line's colour and dash. A name there that would cross a line or touch a label placed before it (`placed`,
	 * which it joins) takes the spot beside its end that crosses and touches least instead, as a note does.
	 */
	function spread(list: readonly PlotEndName[], f: PlotNoteFrame, placed: PlotBox[]) {
		const ends = list
			.map((end) => {
				const x0 = end.at.x + END_GAP;
				return { end, y: end.at.y, x0, x1: x0 + LEADER + f.textWidth(end.name) };
			})
			.sort((a, b) => a.y - b.y);
		// Only names that share some of their width stack: one far along the plot from another keeps its place.
		type End = (typeof ends)[number];
		const sharing = (a: End) => (b: End) => a.x0 < b.x1 && b.x0 < a.x1;
		for (const [k, end] of ends.entries()) {
			const above = ends.slice(0, k).filter(sharing(end));
			end.y = Math.max(end.y, size() / 2, ...above.map((other) => other.y + step()));
		}
		for (let k = ends.length - 1; k >= 0; k--) {
			const end = ends[k] as End;
			const below = ends.slice(k + 1).filter(sharing(end));
			end.y = Math.min(end.y, f.B, ...below.map((other) => other.y - step()));
		}
		return ends
			.map(({ end, y }) => {
				const first = classic(end, y, f);
				const beside = besideSpots(end, f);
				// A name past the frame's right edge is not drawn there.
				const spots = first.box.x1 <= f.R ? [first, ...beside] : beside;
				const chosen = place.cheapest(spots, f, placed) ?? first;
				placed.push(chosen.box);
				return chosen === first ? first.markup : spotText(chosen, f.line);
			})
			.join("");
	}

	/**
	 * The text at the ends of the lines switched on (`shown`), X and Y mapping data to px, placed by spread. The texts are those
	 * of `texts`, where a move is going, so they never change while the lines do.
	 */
	function marks(
		option: PlotOption,
		{ X, Y, shown, textWidth, texts = option }: PlotEndMap,
		bottom: number,
		f: PlotNoteFrame,
		placed: PlotBox[],
	) {
		const list = named(texts, textWidth, bottom).flatMap(({ s: said, i, name }) => {
			const s = option.series?.[i] ?? said;
			const last = s.data.filter(finite).at(-1);
			return last && shown[i]
				? [{ name, at: { x: X(last[0]), y: Y(last[1]) }, colour: colour(s, i), dash: dash(s, i) }]
				: [];
		});
		return spread(list, f, placed);
	}

	return { fit: fits, named, room, marks };
};
