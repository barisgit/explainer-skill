/* plot areas: the areas a plot fills and the notes it writes on itself, not referenced from pages: pack joins it in front of
   plot.js with draw.ts, which uses it. PlotAreas({ svgText, wrap, area }) gives draw(option, frame): the filled lines' areas
   and the regions between lines (`fills`), and the labels of points and regions (`notes`), placed together on the plot, clear
   of its lines, of each other and of its edges. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the function only scopes the part's names away from the page; the code in it is split into small functions
window.PlotAreas = ({ svgText, svgLine, wrap, area }) => {
	const GAP = 6; // px between a note and its point, or a region's edge
	const SAMPLES = 24; // places across a region where its label is tried
	const CLEAR = 10; // what a spot costs once it crosses a line or touches a label: less is clear
	const LEADER = 4; // what a spot away from its point, tied to it by a leader, costs over one beside it
	const AWAY = [2, 3, 5]; // lines of text between a point and the spots away from it

	/** The point of the segment from p to q at x. */
	const atX = (p: PlotPoint, q: PlotPoint, x: number): PlotPoint => [
		x,
		p[1] + ((q[1] - p[1]) * (x - p[0])) / (q[0] - p[0]),
	];

	/** The polyline's points between x = from and x = to, with its points at both ends interpolated in. */
	function clip(line: readonly PlotPoint[], from: number, to: number) {
		const out: PlotPoint[] = [];
		for (const [i, p] of line.entries()) {
			const q = line[i + 1] ?? p;
			if (p[0] >= from && p[0] <= to) {
				out.push(p);
			}
			// Where the segment to the next point passes the span's start or end, that end is a point of the edge.
			const passed = [from, to].filter((x) => (p[0] - x) * (q[0] - x) < 0);
			out.push(...passed.map((x) => atX(p, q, x)));
		}
		return out;
	}

	/** The span of x a polyline covers. */
	const reach = (line: readonly PlotPoint[]) => {
		const xs = line.map((p) => p[0]);
		return [Math.min(...xs), Math.max(...xs)] as const;
	};

	/**
	 * The edges of the region between polylines a and b from x = from to x = to, each left to right, over the part of the span
	 * both cover; a number stands for a level line. None when they share no part of it.
	 */
	function edges(
		a: readonly PlotPoint[] | number,
		b: readonly PlotPoint[] | number,
		[from, to]: readonly [number, number],
	) {
		const lines = [a, b].filter((l): l is readonly PlotPoint[] => typeof l !== "number");
		const lo = Math.max(Math.min(from, to), ...lines.map((l) => reach(l)[0]));
		const hi = Math.min(Math.max(from, to), ...lines.map((l) => reach(l)[1]));
		if (!(hi > lo)) {
			return undefined;
		}
		const edge = (l: readonly PlotPoint[] | number): PlotPoint[] =>
			typeof l === "number"
				? [
						[lo, l],
						[hi, l],
					]
				: clip(l, lo, hi);
		return [edge(a), edge(b)] as const;
	}

	type Box = PlotBox;
	type Spot = PlotSpot;

	/** Whether the segment from a to b passes through the box (Liang-Barsky). */
	function crosses(box: Box, [ax, ay]: PlotPx, [bx, by]: PlotPx) {
		let t0 = 0;
		let t1 = 1;
		const sides = [
			[ax - bx, ax - box.x0],
			[bx - ax, box.x1 - ax],
			[ay - by, ay - box.y0],
			[by - ay, box.y1 - ay],
		] as const;
		for (const [p, q] of sides) {
			if (p === 0 && q < 0) {
				return false;
			}
			if (p !== 0) {
				const t = q / p;
				[t0, t1] = p < 0 ? [Math.max(t0, t), t1] : [t0, Math.min(t1, t)];
			}
		}
		return t0 <= t1;
	}
	const crossings = (box: Box, line: readonly PlotPx[]) =>
		line.reduce((n, p, i) => n + (i > 0 && crosses(box, line[i - 1] ?? p, p) ? 1 : 0), 0);
	/** Whether a point lies inside a polygon (even-odd). */
	function within(polygon: readonly PlotPx[], [x, y]: PlotPx) {
		let odd = false;
		for (const [i, [x1, y1]] of polygon.entries()) {
			const [x2, y2] = polygon[(i + 1) % polygon.length] ?? [x1, y1];
			if (y1 > y !== y2 > y && x < x1 + ((x2 - x1) * (y - y1)) / (y2 - y1)) {
				odd = !odd;
			}
		}
		return odd;
	}
	const apart = (a: Box, b: Box) =>
		a.x1 + GAP <= b.x0 || b.x1 + GAP <= a.x0 || a.y1 + 2 <= b.y0 || b.y1 + 2 <= a.y0;

	/** The point of the box nearest p, where a leader from p ends. */
	const nearest = (box: Box, [x, y]: PlotPx): PlotPx => [
		Math.min(Math.max(x, box.x0), box.x1),
		Math.min(Math.max(y, box.y0), box.y1),
	];

	/** What a leader from a to b costs: a label it passes through most, then each line it crosses past its own point. */
	function leaderCost(a: PlotPx, b: PlotPx, f: PlotNoteFrame, placed: Box[]) {
		const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
		// Its first 4 px leave the point on its own line.
		const from: PlotPx = [a[0] + ((b[0] - a[0]) * 4) / length, a[1] + ((b[1] - a[1]) * 4) / length];
		const thin = (p: PlotPx, q: PlotPx) => (box: Box) => crosses(box, p, q);
		const lines = f.lines.reduce(
			(n, line) =>
				n + line.filter((p, i) => i > 0 && segmentsCross(from, b, line[i - 1] ?? p, p)).length,
			0,
		);
		return placed.filter(thin(from, b)).length * 100 + lines * CLEAR;
	}

	/** Whether segments ab and cd cross. */
	function segmentsCross(a: PlotPx, b: PlotPx, c: PlotPx, d: PlotPx) {
		const side = (p: PlotPx, q: PlotPx, r: PlotPx) =>
			Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
		return side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b);
	}

	/**
	 * What a spot costs: a label already placed under it or under its leader most, then each line it crosses (CLEAR), then a
	 * leader, then a filled region (not its own) under its middle. A box wider than the plot is never clear.
	 */
	function cost({ box, inside, leader }: Spot, f: PlotNoteFrame, placed: Box[]) {
		const middle: PlotPx = [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
		const lines = f.lines.reduce((n, line) => n + crossings(box, line), 0);
		const covered = f.fills.filter((fill) => fill !== inside?.polygon && within(fill, middle));
		const touched = placed.filter((other) => !apart(box, other)).length;
		const tied = leader ? LEADER + leaderCost(leader, nearest(box, leader), f, placed) : 0;
		const outside = box.x0 < f.L - 0.5 || box.x1 > f.R + 0.5 ? CLEAR : 0;
		return touched * 100 + lines * CLEAR + outside + tied + covered.length;
	}

	/**
	 * A spot for `label` wrapped to `room` px: its box from x (by anchor) and from y0 down, moved inside the plot, and across
	 * inside [lo, hi] where given, where it would leave them.
	 */
	function spot(
		label: string,
		room: number,
		x: number,
		y0: number,
		anchor: Spot["anchor"],
		f: PlotNoteFrame,
		[lo, hi] = [f.L, f.R],
	) {
		const lines = wrap(label, room, f.textWidth);
		const width = Math.max(0, ...lines.map(f.textWidth));
		const height = lines.length * f.line;
		const left = anchor === "start" ? x : anchor === "end" ? x - width : x - width / 2;
		const x0 = Math.max(Math.min(Math.max(left, lo), hi - width), f.L);
		const top = Math.min(Math.max(y0, f.T), f.B - height);
		return { box: { x0, x1: x0 + width, y0: top, y1: top + height }, lines, anchor };
	}

	/** px of a label's longest word. */
	const longest = (label: string, f: PlotNoteFrame) =>
		Math.max(...label.split(/\s+/).map(f.textWidth));
	/** px a note may run across: half the plot, or its longest word. */
	const widest = (label: string, f: PlotNoteFrame) => Math.max((f.R - f.L) / 2, longest(label, f));

	/**
	 * The spots `away` px beside a point, wrapped to at most `most` px, in the order they are preferred: above it on the right,
	 * then on the left, level with it on either side, below it on either side, and centred above and below.
	 */
	function besidePoint(label: string, [x, y]: PlotPx, f: PlotNoteFrame, most: number, away = GAP) {
		const right = Math.min(f.R - x - away, most);
		const left = Math.min(x - away - f.L, most);
		const h = (room: number) => wrap(label, room, f.textWidth).length * f.line;
		return [
			spot(label, right, x + away, y - away - h(right), "start", f),
			spot(label, left, x - away, y - away - h(left), "end", f),
			spot(label, right, x + away, y - h(right) / 2, "start", f),
			spot(label, left, x - away, y - h(left) / 2, "end", f),
			spot(label, right, x + away, y + away, "start", f),
			spot(label, left, x - away, y + away, "end", f),
			spot(label, most, x, y - away - h(most), "middle", f),
			spot(label, most, x, y + away, "middle", f),
		];
	}

	/**
	 * The spots for a point's label: beside it wrapped to half the plot, then to about half its width, then to its longest word,
	 * then further away (AWAY), tied to it by a leader.
	 */
	function pointSpots(label: string, at: PlotPx, f: PlotNoteFrame): Spot[] {
		const narrow = longest(label, f);
		const half = Math.max(f.textWidth(label) / 2, narrow);
		return [
			...besidePoint(label, at, f, widest(label, f)),
			...besidePoint(label, at, f, half),
			...besidePoint(label, at, f, narrow),
			...leaderSpots(label, at, f),
		];
	}

	/** The spots AWAY from a point, wrapped to the label's longest word, each tied to the point by a leader. */
	const leaderSpots = (label: string, at: PlotPx, f: PlotNoteFrame): Spot[] =>
		AWAY.flatMap((lines) =>
			besidePoint(label, at, f, longest(label, f), lines * f.line).map((s) => ({
				...s,
				leader: at,
			})),
		);

	/** The y of a polyline at x, by linear interpolation along its first segment that spans x. */
	function levelAt(line: readonly PlotPx[], x: number) {
		const k = line.findIndex((p, i) => i > 0 && (line[i - 1]?.[0] ?? p[0]) <= x && p[0] >= x);
		const [x1, y1] = line[k - 1] ?? line[0] ?? [x, 0];
		const [x2, y2] = line[k] ?? [x1, y1];
		return x2 === x1 ? y1 : y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
	}

	/**
	 * The spots for a region's label: inside it where its edges leave room for it, nearest its middle first, then where they are
	 * furthest apart; then above and below it at the widest.
	 */
	function regionSpots(
		label: string,
		region: NonNullable<PlotNote["region"]>,
		f: PlotNoteFrame,
	): Spot[] {
		const [a, b] = region.edges;
		const from = Math.min(a[0]?.[0] ?? 0, b[0]?.[0] ?? 0);
		const to = Math.max(a.at(-1)?.[0] ?? 0, b.at(-1)?.[0] ?? 0);
		const places = Array.from({ length: SAMPLES + 1 }, (_, k) => {
			const x = from + ((to - from) * k) / SAMPLES;
			const [ya, yb] = [levelAt(a, x), levelAt(b, x)];
			return { x, top: Math.min(ya, yb), bottom: Math.max(ya, yb) };
		}).sort((p, q) => q.bottom - q.top - (p.bottom - p.top));
		const wide = Math.min(Math.max(to - from - 2 * GAP, 0), widest(label, f));
		const middle = (from + to) / 2;
		const at = (room: number) => {
			const h = wrap(label, room, f.textWidth).length * f.line;
			const tall = places
				.filter((p) => p.bottom - p.top >= h + 2 * GAP)
				.sort((p, q) => Math.abs(p.x - middle) - Math.abs(q.x - middle));
			// Centred between its edges, then against its bottom edge, then against its top.
			const ys = ({ top, bottom }: { top: number; bottom: number }) => [
				(top + bottom - h) / 2,
				bottom - GAP - h,
				top + GAP,
			];
			const inside = [...tall, ...places.slice(0, 3)].flatMap((p) =>
				ys(p).map((y) => ({
					...spot(label, room, p.x, y, "middle", f, [from + GAP, to - GAP]),
					inside: region,
				})),
			);
			const outside = places
				.slice(0, 5)
				.flatMap(({ x, top, bottom }) => [
					spot(label, room, x, top - GAP - h, "middle", f),
					spot(label, room, x, bottom + GAP, "middle", f),
				]);
			return [...inside, ...outside];
		};
		// Wrapped to the region's width, then to the label's longest word, then away from its widest place, tied to it by a leader.
		const narrow = Math.min(wide, longest(label, f));
		const [roomiest = { x: from, top: f.T, bottom: f.B }] = places;
		const centre: PlotPx = [roomiest.x, (roomiest.top + roomiest.bottom) / 2];
		return [...at(wide), ...at(narrow), ...leaderSpots(label, centre, f)];
	}

	/** The spot that costs least, the first preferred on a tie. */
	function cheapest(spots: Spot[], f: PlotNoteFrame, placed: Box[]) {
		let best: Spot | undefined;
		let least = Number.POSITIVE_INFINITY;
		for (const s of spots) {
			const c = cost(s, f, placed);
			if (c < least) {
				[best, least] = [s, c];
			}
		}
		return best;
	}

	/**
	 * A placed note's text: one <text> a line, written against a solid region's colour when it sits inside one, after its leader
	 * when it sits away from its point.
	 */
	function noteText({ box, lines, anchor, inside, leader }: Spot, line: number) {
		const x = anchor === "start" ? box.x0 : anchor === "end" ? box.x1 : (box.x0 + box.x1) / 2;
		const solid = inside?.colour;
		const tie = leader ? tieLine(leader, nearest(box, leader)) : "";
		return (
			tie +
			lines
				.map((t, k) =>
					svgText(
						solid ? "note inside" : "note",
						x,
						box.y0 + line / 2 + k * line,
						anchor,
						t,
						solid ? `--c:${solid}` : "",
					),
				)
				.join("")
		);
	}

	/** The spots a note may take: in or by its region, or beside its point. */
	const spotsOf = ({ label, at, region }: PlotNote, f: PlotNoteFrame) =>
		region ? regionSpots(label, region, f) : at ? pointSpots(label, at, f) : [];

	/** A leader from a point to its note, stopping short of both. */
	function tieLine([ax, ay]: PlotPx, [bx, by]: PlotPx) {
		const length = Math.hypot(bx - ax, by - ay);
		const [ux, uy] = length ? [(bx - ax) / length, (by - ay) / length] : [0, 0];
		return svgLine(
			"leader",
			ax + ux * 3,
			bx - ux * 2,
			ay + uy * 3,
			by - uy * 2,
			"--c:var(--rule-strong)",
		);
	}

	/**
	 * The notes' labels, placed in order, each on the spot beside its point or in its region that keeps clearest of the labels
	 * placed before it, the plot's lines (f.lines) and the regions filled (f.fills), within the plot; `crowded` names those no
	 * spot was clear for, drawn on the least bad one.
	 */
	function notes(list: readonly PlotNote[], f: PlotNoteFrame, taken: readonly Box[]) {
		// Placed in order, a note can take the only clear place of one after it: those left crowded go first in another try, and the
		// try with fewest crowded wins.
		let order = [...list];
		let best = placeAll(order, f, taken, list);
		for (let k = 0; k < list.length && best.crowded.length; k++) {
			const crowded = new Set(best.crowded);
			order = [
				...order.filter((n) => crowded.has(n.label)),
				...order.filter((n) => !crowded.has(n.label)),
			];
			const next = placeAll(order, f, taken, list);
			best = next.crowded.length < best.crowded.length ? next : best;
		}
		return best;
	}

	/** The notes placed in the order given, each on its cheapest spot (`spots`, by the note's index in `list`). */
	function placeAll(
		order: readonly PlotNote[],
		f: PlotNoteFrame,
		taken: readonly Box[],
		list = order,
	) {
		const placed: Box[] = [...taken];
		const crowded: string[] = [];
		const spots: (Spot | undefined)[] = list.map(() => undefined);
		let markup = "";
		for (const note of order) {
			const label = note.label;
			const chosen = label ? cheapest(spotsOf(note, f), f, placed) : undefined;
			if (!chosen) {
				continue;
			}
			crowded.push(...(cost(chosen, f, placed) >= CLEAR ? [label] : []));
			placed.push(chosen.box);
			spots[list.indexOf(note)] = chosen;
			markup += noteText(chosen, f.line);
		}
		return { markup, crowded, spots };
	}

	const shifted = (box: Box, dx: number, dy: number): Box => ({
		x0: box.x0 + dx,
		x1: box.x1 + dx,
		y0: box.y0 + dy,
		y1: box.y1 + dy,
	});
	/** A region's span across, in px. */
	const spanOf = ([a, b]: readonly [readonly PlotPx[], readonly PlotPx[]]) =>
		[
			Math.min(a[0]?.[0] ?? 0, b[0]?.[0] ?? 0),
			Math.max(a.at(-1)?.[0] ?? 0, b.at(-1)?.[0] ?? 0),
		] as const;

	/**
	 * How far a note placed for `goal` moves to sit where `now` is: with its point, or in a region at the same share of its span,
	 * the same share of its height inside it and as far off its nearer edge outside it.
	 */
	function moved({ box }: Spot, goal: PlotNote, now: PlotNote): [number, number] {
		if (goal.at && now.at) {
			return [now.at[0] - goal.at[0], now.at[1] - goal.at[1]];
		}
		if (!(goal.region && now.region)) {
			return [0, 0];
		}
		const [g, n] = [goal.region.edges, now.region.edges];
		const [[g0, g1], [n0, n1]] = [spanOf(g), spanOf(n)];
		const cx = (box.x0 + box.x1) / 2;
		const x = n0 + ((cx - g0) / (g1 - g0 || 1)) * (n1 - n0);
		const levels = (edges: typeof g, at: number) => {
			const [ya, yb] = [levelAt(edges[0], at), levelAt(edges[1], at)];
			return [Math.min(ya, yb), Math.max(ya, yb)] as const;
		};
		const [[gt, gb], [nt, nb]] = [levels(g, cx), levels(n, x)];
		const cy = (box.y0 + box.y1) / 2;
		const y =
			cy < gt
				? nt + cy - gt
				: cy > gb
					? nb + cy - gb
					: nt + ((cy - gt) / (gb - gt || 1)) * (nb - nt);
		return [x - cx, y - cy];
	}

	/**
	 * The notes where a move's goal placed them (`goal`, the same notes), carried along with their points and regions, so a note
	 * keeps its side and its lines from step to step rather than being placed again.
	 */
	function carried(list: readonly PlotNote[], goal: PlotNotesPlaced, line: number) {
		return list
			.map((note, i) => {
				const [spot, was] = [goal.spots[i], goal.notes[i]];
				if (!(spot && was)) {
					return "";
				}
				const [dx, dy] = moved(spot, was, note);
				const leader = spot.leader && ([spot.leader[0] + dx, spot.leader[1] + dy] as const);
				return noteText(
					{
						...spot,
						box: shifted(spot.box, dx, dy),
						leader,
						inside: note.region && spot.inside && note.region,
					},
					line,
				);
			})
			.join("");
	}

	const finite = (p: number | PlotPoint): p is PlotPoint =>
		typeof p !== "number" && Number.isFinite(p[0]) && Number.isFinite(p[1]);
	const isLine = (s: PlotSeries) => (s.type ?? "line") === "line";

	/** A region's bound: the points of the line series of that name while the legend shows it, or a level. */
	function boundOf(option: PlotOption, bound: string | number, shown: readonly boolean[]) {
		if (typeof bound === "number") {
			return bound;
		}
		const series = option.series ?? [];
		const i = series.findIndex((s) => s.name === bound && isLine(s));
		return shown[i] ? series[i]?.data.filter(finite) : undefined;
	}

	/** A filled line's edges: the line and zero, over its points. */
	function lineEdges(s: PlotSeries) {
		const line = s.data.filter(finite);
		const [first, last] = [line[0], line.at(-1)];
		return first && last ? edges(line, 0, [first[0], last[0]]) : undefined;
	}

	/**
	 * The areas a plot fills and the regions its notes name, each with its fill (none for a region only labelled), its colour,
	 * its edges and polygon in px and its mark: a filled line's area down to zero, then each mark with between.
	 */
	function regions(option: PlotOption, f: PlotAreaFrame) {
		const toPx = (line: readonly PlotPoint[]) => line.map(([x, y]): PlotPx => [f.X(x), f.Y(y)]);
		const filled = (option.series ?? []).flatMap((s, i) => {
			const fill = Array.isArray(s.fill) ? undefined : (s.fill as PlotFill | true | undefined);
			const found = fill && f.shown[i] && isLine(s) ? lineEdges(s) : undefined;
			return found ? [{ fill, colour: f.colour(s, i), found, mark: undefined }] : [];
		});
		const between = (option.marks ?? []).flatMap((mark) => {
			const [a, b] = (mark.between ?? []).map((bound) => boundOf(option, bound, f.shown));
			const ok = Array.isArray(mark.x) && a !== undefined && b !== undefined;
			const found = ok ? edges(a, b, mark.x as readonly [number, number]) : undefined;
			return found ? [{ fill: mark.fill, colour: "var(--c1)", found, mark }] : [];
		});
		return [...filled, ...between].map(({ found: [a, b], ...region }) => {
			const sides = [toPx(a), toPx(b)] as const;
			return { ...region, edges: sides, polygon: [...sides[0], ...[...sides[1]].reverse()] };
		});
	}

	/** The lines notes keep clear of: every line series switched on, and the markers' lines. */
	function obstacles(option: PlotOption, { X, Y, L, R, T, B, shown }: PlotAreaFrame) {
		const series = (option.series ?? []).flatMap((s, i) =>
			shown[i] && isLine(s) ? [s.data.filter(finite).map(([x, y]): PlotPx => [X(x), Y(y)])] : [],
		);
		const markers = (option.marks ?? []).flatMap((m): PlotPx[][] => {
			const down: PlotPx[][] =
				typeof m.x === "number"
					? [
							[
								[X(m.x), T],
								[X(m.x), B],
							],
						]
					: [];
			const across: PlotPx[][] =
				typeof m.y === "number"
					? [
							[
								[L, Y(m.y)],
								[R, Y(m.y)],
							],
						]
					: [];
			return [...down, ...across];
		});
		return [...series, ...markers];
	}

	/**
	 * The areas filled (`fills`, drawn under the lines) and the notes' labels (`notes`, drawn over everything), placed clear of the
	 * lines, the markers and each other.
	 */
	function draw(
		option: PlotOption,
		f: PlotAreaFrame,
		taken: readonly PlotBox[],
		goal?: PlotNotesPlaced,
	) {
		const all = regions(option, f);
		const drawn = all.map((r) => (r.fill ? area(r.fill, r.colour, r.polygon) : undefined));
		const list = (option.marks ?? []).flatMap((mark): PlotNote[] => {
			const k = all.findIndex((r) => r.mark === mark);
			const region = all[k];
			const solid = drawn[k] && !drawn[k].open ? "var(--accent)" : undefined;
			const at: PlotPx | undefined = mark.at && [f.X(mark.at[0]), f.Y(mark.at[1])];
			return mark.label && (region || at)
				? [{ label: mark.label, at, region: region && { ...region, colour: solid } }]
				: [];
		});
		const fills = drawn.map((d) => d?.markup ?? "").join("");
		if (goal?.notes.length === list.length) {
			return { fills, notes: carried(list, goal, f.line), crowded: [], placed: goal };
		}
		const polygons = all.filter((_, k) => drawn[k]).map((r) => r.polygon);
		const placed = notes(list, { ...f, lines: obstacles(option, f), fills: polygons }, taken);
		return {
			fills,
			notes: placed.markup,
			crowded: placed.crowded,
			placed: { notes: list, spots: placed.spots },
		};
	}

	return { draw };
};
