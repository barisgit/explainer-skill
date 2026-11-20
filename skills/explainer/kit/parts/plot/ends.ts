/* plot ends: what a plot's lines and stems say on themselves, their names (a plot never falls back to a legend for them) and a
   labelled line's last value, not referenced from pages: pack joins it in front of plot.js with draw.ts, which uses it. PlotEnds({
   svgLine, svgText, size, place, format, colour, dash, wrap }) gives onMarks(option), whether the series carry their names on
   their marks (bars too, which bar-names.ts names); named(...), the lines and stems with text at their ends; room(...), the room
   a name takes right of the plot; and marks(...), the texts drawn, placed with the plot's other labels, and the series whose
   name found no clear place. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the function only scopes the part's names away from the page; the code in it is split into small functions
window.PlotEnds = ({ svgLine, svgText, size, place, format, colour, dash, wrap }) => {
	const END_GAP = 6; // px between a line's end and its name
	const LEADER = 10; // px more for a name moved off its line's end, which a leader ties to it
	const ALONG = 8; // points along a line a name with no room at its end is tried beside
	// A name takes the room right of the plot when, in the narrowest figure the kit lays out (288 px), it leaves the plot 55% of
	// it; a longer one goes beside its end or along its line.
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

	const pointed = (s: PlotSeries) => (s.type ?? "line") !== "bar";
	/**
	 * Whether the series carry their names on their marks rather than in a legend: the author left the legend unset (legend: true
	 * keeps the legend, false shows neither) and picked no category (whose key stays), and one or more lines or stems have a
	 * name, or two or more bar series (one is the plot's own subject, which its label says). Neither the names' length nor the
	 * plot's size decides it: names that crowd are placed apart on the plot, never moved into a legend.
	 */
	function onMarks(option: PlotOption) {
		const named = (option.series ?? []).filter((s) => s.name);
		const { pick: at, categories } = option;
		// A pick that names a category shows its key (pick.ts pickedAt): any other is no pick.
		if (option.legend !== undefined || (typeof at === "number" && categories?.[at] !== undefined)) {
			return false;
		}
		return option.categories ? named.length > 1 : named.length > 0 && named.every(pointed);
	}

	/**
	 * The lines and stems that carry text at their ends, with their index: name and value when the series carry their names, else
	 * a line's value alone.
	 * The value is left out when the text would take more than two lines of MOST; a name is never left out.
	 */
	function named(option: PlotOption, textWidth: (s: unknown) => number) {
		const names = onMarks(option);
		const fitted = (text: string) => (text && wrapped(text, textWidth).length ? text : "");
		return (option.series ?? []).flatMap((s, i) => {
			if (!pointed(s)) {
				return [];
			}
			const own = names && s.name;
			const kept = own ? fitted(nameAndValue(option, s)) || own : fitted(lastValue(option, s));
			return kept ? [{ s, i, name: kept }] : [];
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
		].filter((lines) => lines.length);
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

	/** px from a point to a polyline. */
	function distance([x, y]: PlotPx, line: readonly PlotPx[]) {
		let least = Number.POSITIVE_INFINITY;
		for (const [i, [x1, y1]] of line.entries()) {
			const [x2, y2] = line[i + 1] ?? [x1, y1];
			const [dx, dy] = [x2 - x1, y2 - y1];
			const along = dx || dy ? ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy) : 0;
			const t = Math.min(Math.max(along, 0), 1);
			least = Math.min(least, Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)));
		}
		return least;
	}

	/**
	 * Whether a spot's middle lies nearer its own series' marks (`mine`: a line, or each stem) than any other series' (`others`),
	 * so the name reads as that series'.
	 */
	function owns(
		{ box }: PlotSpot,
		mine: readonly (readonly PlotPx[])[],
		others: readonly (readonly PlotPx[])[],
	) {
		const middle: PlotPx = [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
		const own = Math.min(...mine.map((shape) => distance(middle, shape)));
		return others.every((other) => distance(middle, other) > own);
	}

	/** The point a fraction `t` of the way along a polyline in px, by its drawn length, so a line of two points has a middle too. */
	function along(line: readonly PlotPx[], t: number): PlotPx | undefined {
		const lengths = line.slice(1).map((q, i) => {
			const p = line[i] as PlotPx;
			return Math.hypot(q[0] - p[0], q[1] - p[1]);
		});
		let left = t * lengths.reduce((sum, l) => sum + l, 0);
		for (const [i, l] of lengths.entries()) {
			const [p, q] = [line[i], line[i + 1]] as [PlotPx, PlotPx];
			if (left <= l) {
				const u = l ? left / l : 0;
				return [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
			}
			left -= l;
		}
		return line.at(-1);
	}

	/**
	 * The spots beside points along a line, from its end back (ALONG of them, evenly along its drawn length), each wrapped as a
	 * note's, for a name that has no room at its end.
	 */
	function alongSpots({ name, line }: PlotEndName, f: PlotNoteFrame) {
		const points = Array.from({ length: ALONG }, (_, k) => along(line, (ALONG - k) / (ALONG + 1)));
		return points.flatMap((p) => (p ? place.pointSpots(name, p, f).filter((s) => !s.leader) : []));
	}

	/** A spot's lines of text, one <text> a line. */
	function spotText({ box, lines, anchor }: PlotSpot, line: number) {
		const x = anchor === "start" ? box.x0 : anchor === "end" ? box.x1 : (box.x0 + box.x1) / 2;
		return lines.map((t, k) => svgText("end", x, box.y0 + line / 2 + k * line, anchor, t)).join("");
	}

	/**
	 * Each name just past its line's last point. Names closer than a line of text apart, and sharing some of their width, are
	 * spread apart, in order from the top, and kept above the plot's bottom edge; a name moved off its line's end sits a leader
	 * further right, the leader drawn from the end in its line's colour and dash. A name there that would cross a line or touch a
	 * label placed before it (`placed`, which it joins) takes the spot beside its end, else along its line, that crosses and
	 * touches least instead, as a note does, where it is nearer its own marks than any other series' switched on (`shapes`, by
	 * series). `crowded` names the series no spot was clear for, each drawn on its least bad one.
	 */
	function spread(
		list: readonly PlotEndName[],
		f: PlotNoteFrame,
		placed: PlotBox[],
		shapes: readonly (readonly (readonly PlotPx[])[])[],
	) {
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
		const crowded: string[] = [];
		const markup = ends
			.map(({ end, y }) => {
				const first = classic(end, y, f);
				const others = shapes.filter((mine) => mine !== end.shapes).flat();
				const { chosen, clear } = choose(end, first, others, f, placed);
				if (!clear) {
					crowded.push(end.series);
				}
				placed.push(chosen.box);
				return chosen === first ? first.markup : spotText(chosen, f.line);
			})
			.join("");
		return { markup, crowded };
	}

	/**
	 * Where a name goes: its stacked spot at the end (`first`), else beside its end, else along its line, the later spots tried
	 * only when no earlier one is clear, and beside or along only where the name reads as its own line's. A name with no clear
	 * spot takes its least bad one inside the frame, and `clear` is false.
	 */
	function choose(
		end: PlotEndName,
		first: ReturnType<typeof classic>,
		others: readonly (readonly PlotPx[])[],
		f: PlotNoteFrame,
		placed: readonly PlotBox[],
	): { chosen: PlotSpot; clear: boolean } {
		const mine = (spots: PlotSpot[]) => spots.filter((spot) => owns(spot, end.shapes, others));
		// A name past the frame's right edge, or stacked up past the drawing's top, is not drawn there.
		const inside = first.box.x1 <= f.R && first.box.y0 >= 0;
		const stages = [
			() => (inside ? [first] : []),
			() => mine(besideSpots(end, f)),
			() => mine(alongSpots(end, f)),
		];
		const tried: PlotSpot[] = [];
		let best: PlotSpot | undefined;
		for (const stage of stages) {
			tried.push(...stage());
			best = place.cheapest(tried, f, placed);
			if (best && place.cost(best, f, placed) < place.CLEAR) {
				return { chosen: best, clear: true };
			}
		}
		return {
			chosen: best ?? place.cheapest(besideSpots(end, f), f, placed) ?? first,
			clear: false,
		};
	}

	/**
	 * A series' marks in px: a line's points as one shape, or each stem from the baseline at `base` to its dot; and the path a
	 * name is tried beside along it (the line, or the stems' dots in turn).
	 */
	function shapesOf(
		s: PlotSeries,
		X: (v: number) => number,
		Y: (v: number) => number,
		base: number,
	) {
		const path = s.data.filter(finite).map(([x, y]): PlotPx => [X(x), Y(y)]);
		const shapes =
			s.type === "stem" ? path.map(([x, y]) => [[x, base] as const, [x, y] as const]) : [path];
		return { path, shapes: path.length ? shapes : [] };
	}

	/**
	 * The text on the lines and stems switched on (`shown`), X and Y mapping data to px, placed by spread. The texts are those of
	 * `texts`, where a move is going, so they never change while the marks do.
	 */
	function marks(
		option: PlotOption,
		{ X, Y, shown, textWidth, texts = option }: PlotEndMap,
		f: PlotNoteFrame,
		placed: PlotBox[],
	) {
		// Stems stand on 0, or on the plot's edge where 0 is off it.
		const base = Math.min(Math.max(Y(0), f.T), f.B);
		// Every line and stem switched on, named or not: a name reads as its own series' only when nearer it than any of them.
		const drawn = (option.series ?? []).map((s, i) =>
			shown[i] && pointed(s) ? shapesOf(s, X, Y, base) : { path: [], shapes: [] },
		);
		const list = named(texts, textWidth).flatMap(({ s: said, i, name }): PlotEndName[] => {
			const s = option.series?.[i] ?? said;
			const { path, shapes } = drawn[i] ?? shapesOf(s, X, Y, base);
			const last = path.at(-1);
			return last && shown[i]
				? [
						{
							name,
							series: s.name ?? name,
							line: path,
							shapes,
							at: { x: last[0], y: last[1] },
							colour: colour(s, i),
							dash: dash(s, i),
						},
					]
				: [];
		});
		const shapes = drawn.map((d) => d.shapes).filter((list) => list.length);
		return spread(list, f, placed, shapes);
	}

	return { onMarks, named, room, marks };
};
