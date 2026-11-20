/* plot place: where a label on the plot goes, not referenced from pages: pack joins it in front of plot.js with draw.ts, which
   uses it. PlotPlace({ wrap }) gives what the end names (ends.ts) and notes (areas.ts) are placed by, together and in that order
   after the markers' labels: the lines and arrows they keep clear of (obstacles), what a spot costs where it lies (cost; under CLEAR is
   clear), the cheapest of some spots (cheapest), a wrapped label's spot (spot), the spots beside a point and away from it tied
   by a leader (pointSpots, leaderSpots) and polygon tests (within). */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the function only scopes the part's names away from the page; the code in it is split into small functions
window.PlotPlace = ({ wrap }) => {
	const GAP = 6; // px between a label and its point
	const CLEAR = 10; // what a spot costs once it crosses a line or touches a label: less is clear
	const LEADER = 4; // what a spot away from its point, tied to it by a leader, costs over one beside it
	const AWAY = [2, 3, 5]; // lines of text between a point and the spots away from it

	/** Whether the segment from a to b passes through the box (Liang-Barsky). */
	function crosses(box: PlotBox, [ax, ay]: PlotPx, [bx, by]: PlotPx) {
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
	const crossings = (box: PlotBox, line: readonly PlotPx[]) =>
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
	/** Whether two boxes keep GAP apart across, or 2 px down. */
	const apart = (a: PlotBox, b: PlotBox) =>
		a.x1 + GAP <= b.x0 || b.x1 + GAP <= a.x0 || a.y1 + 2 <= b.y0 || b.y1 + 2 <= a.y0;

	/** The point of the box nearest p, where a leader from p ends. */
	const nearest = (box: PlotBox, [x, y]: PlotPx): PlotPx => [
		Math.min(Math.max(x, box.x0), box.x1),
		Math.min(Math.max(y, box.y0), box.y1),
	];

	/** What a leader from a to b costs: a label it passes through most, then each line it crosses past its own point. */
	function leaderCost(a: PlotPx, b: PlotPx, f: PlotNoteFrame, placed: readonly PlotBox[]) {
		const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
		// Its first 4 px leave the point on its own line.
		const from: PlotPx = [a[0] + ((b[0] - a[0]) * 4) / length, a[1] + ((b[1] - a[1]) * 4) / length];
		const thin = (p: PlotPx, q: PlotPx) => (box: PlotBox) => crosses(box, p, q);
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
	 * leader, then a filled region (not its own) under its middle. A box past the plot's sides is never clear.
	 */
	function cost({ box, inside, leader }: PlotSpot, f: PlotNoteFrame, placed: readonly PlotBox[]) {
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
		anchor: PlotSpot["anchor"],
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
	function pointSpots(label: string, at: PlotPx, f: PlotNoteFrame): PlotSpot[] {
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
	const leaderSpots = (label: string, at: PlotPx, f: PlotNoteFrame): PlotSpot[] =>
		AWAY.flatMap((lines) =>
			besidePoint(label, at, f, longest(label, f), lines * f.line).map((s) => ({
				...s,
				leader: at,
			})),
		);

	/** The spot that costs least, the first preferred on a tie. */
	function cheapest<S extends PlotSpot>(
		spots: readonly S[],
		f: PlotNoteFrame,
		placed: readonly PlotBox[],
	) {
		let best: S | undefined;
		let least = Number.POSITIVE_INFINITY;
		for (const s of spots) {
			const c = cost(s, f, placed);
			if (c < least) {
				[best, least] = [s, c];
			}
		}
		return best;
	}

	const finite = (p: number | PlotPoint): p is PlotPoint =>
		typeof p !== "number" && Number.isFinite(p[0]) && Number.isFinite(p[1]);

	/** The lines labels keep clear of: every line and stem (with its dot) switched on, the markers' lines and the arrows' shafts. */
	function obstacles(option: PlotOption, { X, Y, L, R, T, B, shown }: PlotAreaFrame) {
		const base = Math.min(Math.max(Y(0), T), B);
		const series = (option.series ?? []).flatMap((s, i) => {
			const points = shown[i] ? s.data.filter(finite).map(([x, y]): PlotPx => [X(x), Y(y)]) : [];
			const type = s.type ?? "line";
			return type === "line"
				? [points]
				: type === "stem"
					? // A stem runs on through its dot (r 4.5), which a label keeps off as well.
						points.map(([x, y]) => [[x, base] as const, [x, y < base ? y - 5 : y + 5] as const])
					: [];
		});
		const markers = (option.marks ?? []).flatMap((m): PlotPx[][] => [
			...(typeof m.x === "number" ? [[[X(m.x), T] as const, [X(m.x), B] as const]] : []),
			...(typeof m.y === "number" ? [[[L, Y(m.y)] as const, [R, Y(m.y)] as const]] : []),
			...(m.from && m.to
				? [[[X(m.from[0]), Y(m.from[1])] as const, [X(m.to[0]), Y(m.to[1])] as const]]
				: []),
		]);
		return [...series, ...markers];
	}

	return {
		CLEAR,
		apart,
		cost,
		cheapest,
		spot,
		longest,
		widest,
		pointSpots,
		leaderSpots,
		nearest,
		within,
		obstacles,
	};
};
