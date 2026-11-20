/* plot bar names: the names a bar plot's series carry on their bars (a plot never falls back to a legend for them), not
   referenced from pages: pack joins it in front of plot.js with draw.ts, which uses it. PlotBarNames({ svgLine, svgText, place,
   wrap }) gives names(...) and room(...). Bars side by side name their series on one group (the last column group, the first
   row group), the names stacked in series order above it, each tied to its bar by a leader that crosses no other bar or name;
   room says what the drawing must keep free for them above the plot and on its right. A stack's series are named inside one of
   their segments, else past the stack's end, else beside a segment, placed as the end names and notes are (place.ts). names
   also gives the series whose name found no readable place. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the function only scopes the part's names away from the page; the code in it is split into small functions
window.PlotBarNames = ({ svgLine, svgText, place, wrap }) => {
	const GAP = 7; // px between a bar or a value and the name beside it, past the 6 px place.ts keeps labels apart by
	const CAP = 0.35; // half a name's capitals' height, of the text size: what a name on a bar's row covers of the rows beside it

	const LEAD = 8; // px of leader at least between a group's names and its column tops

	/** A spot for a name: `own` the bar it is on or beside, `on` that bar when it is inside it, `core` what its letters cover. */
	type Spot = PlotSpot & { own: PlotBox; on?: PlotBarGeometry; core?: PlotBox };

	/** A box w x h px with its middle at x, y. */
	const centred = (x: number, y: number, w: number, h: number): PlotBox => ({
		x0: x - w / 2,
		x1: x + w / 2,
		y0: y - h / 2,
		y1: y + h / 2,
	});

	/** The name inside its bar, centred, when it fits there with a margin; none on an open bar, whose pattern it would sit on. */
	function inside(name: string, { bar, box }: PlotBarDrawn, f: PlotNoteFrame): Spot[] {
		const w = f.textWidth(name);
		const fits = bar.horizontal
			? bar.length >= w + 10 && bar.each >= f.line
			: bar.length >= f.line + 6 && bar.each >= w + 6;
		const [x, y] = [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
		return fits && !bar.open
			? [{ box: centred(x, y, w, f.line), lines: [name], anchor: "middle", own: box, on: bar }]
			: [];
	}

	/** Where text past a bar's end starts on the value axis: past the end, and past the bar's value there (one of `values`). */
	function pastEnd({ bar, box }: PlotBarDrawn, values: readonly PlotBox[]) {
		const row = (b: PlotBox) =>
			bar.horizontal ? b.y0 < box.y1 && box.y0 < b.y1 : b.x0 < box.x1 && box.x0 < b.x1;
		const along = (b: PlotBox, far: boolean) => {
			const [lo, hi] = bar.horizontal ? [b.x0, b.x1] : [b.y0, b.y1];
			return bar.dir > 0 === far ? hi : lo;
		};
		// A value starting within a few px past the end is the bar's own; the name goes past it.
		const own = values.filter((b) => {
			const gap = bar.dir * (along(b, false) - bar.end);
			return row(b) && gap >= -1 && gap <= 8;
		});
		const end = own.reduce(
			(at, b) => (bar.dir * (along(b, true) - at) > 0 ? along(b, true) : at),
			bar.end,
		);
		return end + bar.dir * GAP;
	}

	/** The name on a bar's row past its end and value, its letters covering only as much of the rows beside it as a value's do. */
	function pastRow(name: string, { bar, box }: PlotBarDrawn, from: number, f: PlotNoteFrame): Spot {
		const w = f.textWidth(name);
		const x0 = bar.dir > 0 ? from : from - w;
		const [half, cap] = [f.line / 2, (f.line - 4) * CAP];
		const spot = { x0, x1: x0 + w, y0: bar.mid - half, y1: bar.mid + half };
		const core = { ...spot, y0: bar.mid - cap, y1: bar.mid + cap };
		return { box: spot, core, lines: [name], anchor: bar.dir > 0 ? "start" : "end", own: box };
	}

	/**
	 * The name past a bar's end: on a row's after its value; over (under) a column past its value, wrapped to its longest word
	 * too, else beside the column's end or away from it, tied by a leader.
	 */
	function past(
		name: string,
		drawn: PlotBarDrawn,
		f: PlotNoteFrame,
		values: readonly PlotBox[],
	): Spot[] {
		const { bar, box } = drawn;
		const from = pastEnd(drawn, values);
		if (bar.horizontal) {
			return [pastRow(name, drawn, from, f)];
		}
		const layouts = [[name], wrap(name, place.longest(name, f), f.textWidth)];
		const over = layouts.map((lines): Spot => {
			const w = Math.max(...lines.map(f.textWidth));
			const h = lines.length * f.line;
			const y0 = bar.dir < 0 ? from - h : from;
			return {
				box: { x0: bar.mid - w / 2, x1: bar.mid + w / 2, y0, y1: y0 + h },
				lines,
				anchor: "middle",
				own: box,
			};
		});
		const at: PlotPx = [bar.mid, bar.end];
		return [...over, ...place.pointSpots(name, at, f).map((spot) => ({ ...spot, own: box }))];
	}

	/** The name beside a stacked segment, level with its middle: right and left of a column, over and under a bar in a row. */
	function beside(name: string, { bar, box }: PlotBarDrawn, f: PlotNoteFrame): Spot[] {
		const [x, y] = [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
		if (bar.horizontal) {
			const w = f.textWidth(name);
			const h = f.line;
			return [centred(x, box.y0 - GAP - h / 2, w, h), centred(x, box.y1 + GAP + h / 2, w, h)].map(
				(b) => ({ box: b, lines: [name], anchor: "middle", own: box }),
			);
		}
		const wrapped = wrap(name, place.longest(name, f), f.textWidth);
		return (wrapped.length > 1 ? [[name], wrapped] : [[name]]).flatMap((lines): Spot[] => {
			const w = Math.max(...lines.map(f.textWidth));
			const h = f.line * lines.length;
			const mid = Math.min(Math.max(y, h / 2), f.B - h / 2);
			return [
				{ box: centred(box.x1 + GAP + w / 2, mid, w, h), lines, anchor: "start", own: box },
				{ box: centred(box.x0 - GAP - w / 2, mid, w, h), lines, anchor: "end", own: box },
			];
		});
	}

	/** px from a point to a box, 0 inside it. */
	const toBox = ([x, y]: PlotPx, b: PlotBox) =>
		Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.y0 - y, 0, y - b.y1));
	/** Whether a spot's middle lies nearer its own series' bars than any other series', so the name reads as that series'. */
	function owns({ box }: PlotSpot, mine: readonly PlotBox[], others: readonly PlotBox[]) {
		const middle: PlotPx = [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
		const own = Math.min(...mine.map((b) => toBox(middle, b)));
		return others.every((b) => toBox(middle, b) > own);
	}

	/**
	 * What a spot costs as a note's does, by what its letters cover, its own bar left out of what a name inside it may not touch;
	 * past the drawing's edges (R is the drawing's right edge less a margin) or the plot's bottom most, so a name with no clear
	 * spot is still drawn whole.
	 */
	function cost(spot: Spot, f: PlotNoteFrame, placed: readonly PlotBox[]) {
		const { x0, x1, y0, y1 } = spot.box;
		const off = x0 < 0 || x1 > f.R + 0.5 || y0 < 0 || y1 > f.B + 0.5 ? 1000 : 0;
		const near = spot.on ? placed.filter((b) => b !== spot.own) : placed;
		return off + place.cost({ ...spot, box: spot.core ?? spot.box }, f, near);
	}
	/** The spot that costs least, the first preferred on a tie, and what it costs. */
	function cheapest(spots: readonly Spot[], f: PlotNoteFrame, placed: readonly PlotBox[]) {
		let best: Spot | undefined;
		let least = Number.POSITIVE_INFINITY;
		for (const s of spots) {
			const c = cost(s, f, placed);
			if (c < least) {
				[best, least] = [s, c];
			}
		}
		return { best, least };
	}

	/**
	 * Where a series' name goes: inside one of its bars, else past a bar's end, else beside a stacked segment, the later spots
	 * tried only when no earlier one is clear, and past or beside only where the name reads as its own series' (nearer its bars
	 * than any other's, or tied to its bar by a leader). Columns are tried from the last category back, bars in a row from the
	 * first down. With no clear spot it takes its least bad one.
	 */
	function choose(
		name: string,
		[mine, others]: readonly [readonly PlotBarDrawn[], readonly PlotBox[]],
		f: PlotNoteFrame,
		[placed, values]: readonly [readonly PlotBox[], readonly PlotBox[]],
	) {
		const order = mine[0]?.bar.horizontal ? mine : [...mine].reverse();
		const boxes = mine.map((d) => d.box);
		const readable = (spots: Spot[]) => spots.filter((s) => s.leader || owns(s, boxes, others));
		const stages = [
			() => order.flatMap((d) => inside(name, d, f)),
			() => readable(order.flatMap((d) => past(name, d, f, values))),
			() => readable(order.flatMap((d) => beside(name, d, f))),
		];
		const tried: Spot[] = [];
		for (const stage of stages) {
			tried.push(...stage());
			const { best, least } = cheapest(tried, f, placed);
			if (best && least < place.CLEAR) {
				return { chosen: best, clear: true };
			}
		}
		const fallback = [...tried, ...order.flatMap((d) => past(name, d, f, values))];
		return { chosen: cheapest(fallback, f, placed).best, clear: false };
	}

	/** A leader from a bar's end to its name, stopping short of both. */
	function tie([ax, ay]: PlotPx, box: PlotBox) {
		const [bx, by] = place.nearest(box, [ax, ay]);
		const length = Math.hypot(bx - ax, by - ay) || 1;
		const [ux, uy] = [(bx - ax) / length, (by - ay) / length];
		const style = "--c:var(--rule-strong)";
		return svgLine("leader", ax + ux * 2, bx - ux * 2, ay + uy * 2, by - uy * 2, style);
	}
	/** A spot's lines of text, one <text> a line, written on its bar's colour when it is inside one, after its leader. */
	function spotText({ box, lines, anchor, on, leader }: Spot, line: number) {
		const x = anchor === "start" ? box.x0 : anchor === "end" ? box.x1 : (box.x0 + box.x1) / 2;
		const [cls, style] = on ? ["end inside", `--c:${on.colour}`] : ["end", ""];
		const text = lines.map((t, k) =>
			svgText(cls, x, box.y0 + line / 2 + k * line, anchor, t, style),
		);
		return (leader ? tie(leader, box) : "") + text.join("");
	}

	/**
	 * The names of the bar series, in series order: those of `texts`, where a move is going. One with no bar drawn finds no spot
	 * and is reported crowded.
	 */
	function namedSeries(option: PlotOption, texts: PlotOption) {
		return (option.series ?? []).flatMap((s, j) => {
			const name = texts.series?.[j]?.name ?? s.name;
			return name && s.type === "bar" ? [{ name, j }] : [];
		});
	}

	/** The category bars side by side are named on: the last column group, or the first row group. */
	const groupAt = (option: PlotOption) =>
		option.horizontal ? 0 : (option.categories?.length ?? 1) - 1;

	/** A group name: its text box, its leader's points from under the name to its bar, and whether it was moved in (`squeezed`). */
	type GroupName = { name: string; box: PlotBox; leader: PlotPx[]; squeezed?: boolean };
	/** A named series' bar in the group. */
	type GroupRow = { name: string; d: PlotBarDrawn };
	/** Where a group's names go: their frame, and `ceiling`, the highest px their top may reach (none while room is measured). */
	type GroupFrame = PlotNoteFrame & { ceiling?: number | undefined };

	/** px of the boxes, by side. */
	const extent = (boxes: readonly PlotBox[]) => ({
		x0: Math.min(...boxes.map((b) => b.x0)),
		x1: Math.max(...boxes.map((b) => b.x1)),
		y0: Math.min(...boxes.map((b) => b.y0)),
		y1: Math.max(...boxes.map((b) => b.y1)),
	});

	/**
	 * Where the bottom of `lines` names stacked above a group goes: `at`, or lower where their top would pass the ceiling (while
	 * a plot moves to where its room was kept for, or when the room it needs is more than it may take), and is reported crowded.
	 */
	const below = (at: number, lines: number, f: GroupFrame) =>
		Math.max(at, (f.ceiling ?? Number.NEGATIVE_INFINITY) + lines * f.line);
	/**
	 * A name's box from x0, moved left to end at the frame's right where it would pass it while drawn (a ceiling is set); past a px,
	 * the room the plot may give up was not enough, so it is reported crowded. While room is measured it stays, so the overflow counts.
	 */
	function boxFrom(x0: number, y0: number, name: string, f: GroupFrame) {
		const w = f.textWidth(name);
		const left = f.ceiling === undefined ? x0 : Math.min(x0, f.R - w);
		return { box: { x0: left, x1: left + w, y0, y1: y0 + f.line }, squeezed: left < x0 - 1 };
	}

	/**
	 * The names stacked above a column group in series order, each starting at its column's middle, where its leader drops to the
	 * column's top or value: the names start left to right as the columns do, so no leader crosses a name below its own.
	 */
	function overColumns(rows: readonly GroupRow[], near: PlotBox[], f: GroupFrame) {
		const top = below(extent(near).y0 - LEAD, rows.length, f);
		let last = Number.NEGATIVE_INFINITY;
		return rows.map(({ name, d }, k): GroupName => {
			const c = d.bar.mid;
			const x0 = Math.max(c - Math.min(3, d.bar.each / 2), last + 4);
			last = c;
			const y0 = top - (rows.length - k) * f.line;
			const { box, squeezed } = boxFrom(x0, y0, name, f);
			return {
				name,
				box,
				squeezed,
				leader: [
					[c, box.y1 - 1],
					// To the value above its column, else the column's top (a negative column's value is under it).
					[c, (d.value && d.value.y1 <= d.box.y0 + 1 ? d.value : d.box).y0 - 2],
				],
			};
		});
	}

	/**
	 * The names stacked above a row group in series order, each starting past every bar and value above its own bar's middle and
	 * right of the name above it; its leader drops there to its bar's middle and runs back to the bar's end or value.
	 */
	function overRows(rows: readonly GroupRow[], near: PlotBox[], f: GroupFrame) {
		const top = below(extent(near).y0 - GAP, rows.length, f);
		let last = Number.NEGATIVE_INFINITY;
		return rows.map(({ name, d }, k): GroupName => {
			const mid = d.bar.mid;
			const x0 = Math.max(last + 8, ...near.filter((b) => b.y0 < mid).map((b) => b.x1 + GAP));
			last = x0;
			const y0 = top - (rows.length - k) * f.line;
			const { box, squeezed } = boxFrom(x0, y0, name, f);
			const [lx, at] = [x0 + 3, Math.max(d.box.x1, d.value?.x1 ?? 0) + 2];
			const leader: PlotPx[] = [
				[lx, box.y1 - 1],
				[lx, mid],
			];
			return { name, box, squeezed, leader: lx - at > 2 ? [...leader, [at, mid]] : leader };
		});
	}

	/**
	 * The names of bars side by side on their group, with the values (`values`) near it, and the series with no bar there
	 * (`missing`), which are named on their own bars elsewhere and reported crowded.
	 */
	function onGroup(
		option: PlotOption,
		named: readonly { name: string; j: number }[],
		drawn: readonly PlotBarDrawn[],
		[values, f]: readonly [readonly PlotBox[], GroupFrame],
	) {
		const group = drawn.filter((d) => d.category === groupAt(option));
		const rows = named.flatMap(({ name, j }) => {
			const d = group.find((g) => g.series === j);
			return d ? [{ name, d }] : [];
		});
		const missing = named.filter(({ j }) => !group.some((g) => g.series === j));
		if (!rows.length) {
			return { spots: [], missing };
		}
		const span = extent(group.map((d) => d.box));
		const horizontal = rows[0]?.d.bar.horizontal;
		const across = (b: PlotBox) =>
			horizontal ? b.y0 < span.y1 && span.y0 < b.y1 : b.x0 < span.x1 && span.x0 < b.x1;
		const near = [...group.map((d) => d.box), ...values.filter(across)];
		return { spots: (horizontal ? overRows : overColumns)(rows, near, f), missing };
	}

	/** Whether bars side by side name their series on a group: two named series or more, not stacked. */
	const grouped = (option: PlotOption, named: readonly unknown[]) =>
		!option.stack && named.length > 1;

	/**
	 * px the drawing must keep free for a group's names: above the plot, past `top` (where the room left by the labels on top
	 * ends), and on the right, past the frame's R.
	 */
	function room(
		option: PlotOption,
		drawn: readonly PlotBarDrawn[],
		f: PlotNoteFrame & { texts: PlotOption },
		top: number,
	) {
		const named = namedSeries(option, f.texts);
		const values = drawn.flatMap((d) => (d.value ? [d.value] : []));
		const { spots } = grouped(option, named)
			? onGroup(option, named, drawn, [values, f])
			: { spots: [] };
		if (!spots.length) {
			return { top: 0, right: 0 };
		}
		const { x1, y0 } = extent(spots.map((s) => s.box));
		return { top: Math.max(0, top - y0), right: Math.max(0, x1 - f.R) };
	}

	/** Try small gutters first and keep one only if it places more names without crowding one that already fit. */
	function sideRoom(limit: number, crowdedAt: (right: number) => string[] | undefined) {
		const plain = limit ? crowdedAt(0) : undefined;
		if (!plain?.length) {
			return 0;
		}
		let best = 0;
		let remaining = plain.length;
		for (let trial = 8; ; trial *= 2) {
			const right = Math.min(limit, trial);
			const crowded = crowdedAt(right);
			if (crowded && crowded.length < remaining && crowded.every((name) => plain.includes(name))) {
				best = right;
				remaining = crowded.length;
			}
			if (remaining === 0 || right === limit) {
				return best;
			}
		}
	}

	/**
	 * The pieces of a level or upright segment from a to b left once it breaks 2 px around each of `labels` it passes, as text
	 * written over the leader would hide it.
	 */
	function broken(a: PlotPx, b: PlotPx, labels: readonly PlotBox[]): [PlotPx, PlotPx][] {
		const upright = a[0] === b[0];
		const [p0, p1] = upright ? [a[1], b[1]] : [a[0], b[0]];
		const [lo, hi] = [Math.min(p0, p1), Math.max(p0, p1)];
		const cuts = labels
			.filter((l) => (upright ? l.x0 <= a[0] && a[0] <= l.x1 : l.y0 <= a[1] && a[1] <= l.y1))
			.map((l) => (upright ? [l.y0 - 2, l.y1 + 2] : [l.x0 - 2, l.x1 + 2]))
			.sort(([p = 0], [q = 0]) => p - q);
		const pieces: [number, number][] = [];
		let from = lo;
		for (const [p = 0, q = 0] of cuts) {
			pieces.push([from, Math.min(p, hi)]);
			from = Math.max(from, q);
		}
		pieces.push([from, hi]);
		const at = (v: number): PlotPx => (upright ? [a[0], v] : [v, a[1]]);
		return pieces.filter(([p, q]) => q - p > 1).map(([p, q]) => [at(p), at(q)]);
	}

	/** A group name's text and its leader, broken where it passes another bar's value. */
	function groupText({ name, box, leader }: GroupName, line: number, labels: readonly PlotBox[]) {
		const style = "--c:var(--rule-strong)";
		const segments = leader
			.slice(1)
			.flatMap((b, i) =>
				broken(leader[i] ?? b, b, labels).map(([p, q]) =>
					svgLine("leader", p[0], q[0], p[1], q[1], style),
				),
			);
		return segments.join("") + svgText("end", box.x0, box.y0 + line / 2, "start", name);
	}

	/** Each named series' name on its own bars, tried one spot after another (choose), and the names with no clear spot. */
	function eachOnBars(
		named: readonly { name: string; j: number }[],
		drawn: readonly PlotBarDrawn[],
		f: PlotNoteFrame,
		[placed, values]: readonly [PlotBox[], readonly PlotBox[]],
	) {
		const crowded: string[] = [];
		let markup = "";
		for (const { name, j } of named) {
			const mine = drawn.filter((d) => d.series === j);
			const others = drawn.filter((d) => d.series !== j).map((d) => d.box);
			const { chosen, clear } = choose(name, [mine, others], f, [placed, values]);
			if (!clear) {
				crowded.push(name);
			}
			if (chosen) {
				placed.push(chosen.box);
				markup += spotText(chosen, f.line);
			}
		}
		return { markup, crowded };
	}

	/**
	 * Each named series' name on its bars (`drawn`), in series order, clear of `placed`, which each joins; bars side by side on
	 * their group, under `ceiling`. A series with no bar in the group is named on its own bars and reported crowded, as a name
	 * pushed off the drawing or onto the bars is. The names are those of `texts`, where a move is going, so they never change
	 * while the bars do.
	 */
	function names(
		option: PlotOption,
		drawn: readonly PlotBarDrawn[],
		f: GroupFrame & { texts: PlotOption },
		placed: PlotBox[],
	) {
		// What is not a bar is a value or a label, which a name past a bar's end goes past when it is that bar's.
		const bars = new Set(drawn.map((d) => d.box));
		const values = placed.filter((b) => !bars.has(b));
		const named = namedSeries(option, f.texts);
		if (!grouped(option, named)) {
			return eachOnBars(named, drawn, f, [placed, values]);
		}
		const { spots, missing } = onGroup(option, named, drawn, [values, f]);
		const crowded = spots.filter(
			({ box, squeezed }) =>
				squeezed ||
				box.y0 < 0 ||
				place.cost({ box, lines: [], anchor: "start" }, f, placed) >= place.CLEAR,
		);
		placed.push(...spots.map((g) => g.box));
		const rest = eachOnBars(missing, drawn, f, [placed, values]);
		return {
			markup: spots.map((g) => groupText(g, f.line, values)).join("") + rest.markup,
			crowded: [...crowded.map((g) => g.name), ...missing.map((m) => m.name)],
		};
	}

	return { names, room, sideRoom };
};
