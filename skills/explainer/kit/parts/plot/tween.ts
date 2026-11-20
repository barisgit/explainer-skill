/* plot tween: the steps plot.js draws between two options when a set() changes what a plot shows, so bars grow or shrink and
   lines morph from the state they are in. between(from, to, k) is `to` with its numbers k of the way from `from`'s: a bar's value,
   a point (a line of another length is read off the old one at the new x values), an axis's min and max, a marker's place, a span's, a note's point and an arrow's ends (moving as the line they sit on moves, if any). What
   has no counterpart in `from` (a series of a new name, an unnamed one where `from` has none unnamed at its place, another type, a
   different number of bars) is `to`'s at once; series are matched by name, unnamed ones by place. Not referenced from
   pages: pack joins it in front of plot.js. same(a, b) says whether two options draw alike, so setting one changes nothing. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the function only scopes the part's names away from the page; the code in it is split into small functions
window.PlotTween = () => {
	const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
	const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
	const isPoint = (p: unknown): p is PlotPoint => Array.isArray(p) && num(p[0]) && num(p[1]);
	/** A point within this share of a line's span of heights from it sits on the line, for riding. */
	const ON = 0.05;

	/** A line's y at x, read off its points (x ascending) between the two around x, or its end's beyond them. */
	function yAt(points: readonly PlotPoint[], x: number): number {
		const after = points.findIndex((p) => p[0] >= x);
		const right = points[after];
		const left = points[after - 1];
		if (!right) {
			return points.at(-1)?.[1] ?? 0;
		}
		if (!left || right[0] === x) {
			return right[1];
		}
		return lerp(left[1], right[1], (x - left[0]) / (right[0] - left[0]));
	}

	/** Points k of the way: pairwise when the lines match in length, else a line's new points over the old line at their x. */
	function points(a: PlotSeries, b: PlotSeries, k: number): PlotSeries["data"] {
		const old = a.data;
		if (old.length === b.data.length && b.data.every((p, i) => isPoint(p) && isPoint(old[i]))) {
			return b.data.map((p, i) => {
				const [x, y] = p as PlotPoint;
				const [ox, oy] = old[i] as PlotPoint;
				return [lerp(ox, x, k), lerp(oy, y, k)];
			});
		}
		const line = old.filter(isPoint);
		const ascending = line.every((p, i) => i === 0 || (line[i - 1] as PlotPoint)[0] <= p[0]);
		if ((b.type ?? "line") !== "line" || !line.length || !ascending) {
			return b.data;
		}
		return b.data.map((p) => (isPoint(p) ? [p[0], lerp(yAt(line, p[0]), p[1], k)] : p));
	}

	/** A series' data k of the way from a's, where the two are of one type. */
	function data(a: PlotSeries, b: PlotSeries, k: number): PlotSeries["data"] {
		const type = b.type ?? "line";
		if ((a.type ?? "line") !== type) {
			return b.data;
		}
		if (type !== "bar") {
			return points(a, b, k);
		}
		return a.data.length === b.data.length
			? b.data.map((v, i) => {
					const o = a.data[i];
					return num(v) && num(o) ? lerp(o, v, k) : v;
				})
			: b.data;
	}

	/** An axis with its min and max k of the way, where both options set them. */
	function axis(a: AxisSpec | undefined, b: AxisSpec, k: number): AxisSpec {
		const at = (key: "min" | "max") => {
			const [from, to] = [a?.[key], b[key]];
			return num(from) && num(to) ? { [key]: lerp(from, to, k) } : {};
		};
		return { ...b, ...at("min"), ...at("max") };
	}

	/** A number, or each of a pair, k of the way from `from`; `to` where their shapes differ. */
	function step(from: unknown, to: unknown, k: number): unknown {
		if (num(from) && num(to)) {
			return lerp(from, to, k);
		}
		const pair = (v: unknown): v is readonly [number, number] =>
			Array.isArray(v) && v.length === 2 && v.every(num);
		return pair(from) && pair(to) ? [lerp(from[0], to[0], k), lerp(from[1], to[1], k)] : to;
	}

	/** A line's points that are points, when they run left to right, so yAt can read it; none otherwise. */
	function readable(s: PlotSeries | undefined): PlotPoint[] {
		const line = (s?.type ?? "line") === "line" ? (s?.data ?? []).filter(isPoint) : [];
		const ascending = line.every((p, i) => i === 0 || (line[i - 1] as PlotPoint)[0] <= p[0]);
		return ascending ? line : [];
	}
	/** A point's height over a line at its x, or undefined where the line does not reach that x. */
	function over([x, y]: PlotPoint, line: readonly PlotPoint[]) {
		const [first, last] = [line[0], line.at(-1)];
		return first && last && x >= first[0] && x <= last[0] ? y - yAt(line, x) : undefined;
	}

	/**
	 * How far a point is from lying on a line, as a share of the line's span of heights (exactly on a flat line is 0, near it
	 * Infinity), or undefined where the line does not reach the point's x or it lies further than ON.
	 */
	function off(point: PlotPoint, line: readonly PlotPoint[]) {
		const d = over(point, line);
		const heights = line.map((pt) => pt[1]);
		const span = Math.max(...heights) - Math.min(...heights);
		const share = d === undefined ? undefined : Math.abs(d) <= 1e-9 ? 0 : Math.abs(d) / span;
		return share !== undefined && share <= ON ? share : undefined;
	}
	/**
	 * How a line moves from `a` to `b`, as data() and points() move it: point by point ("pair"), at the new x values with heights
	 * read off the old line ("resample"), or at once ("jump": no counterpart, another type, an old line yAt cannot read).
	 */
	function motion(a: PlotSeries | undefined, b: PlotSeries) {
		if (
			!a ||
			(a.type ?? "line") !== "line" ||
			(b.type ?? "line") !== "line" ||
			!readable(a).length
		) {
			return "jump";
		}
		const paired =
			a.data.length === b.data.length && b.data.every((pt, i) => isPoint(pt) && isPoint(a.data[i]));
		return paired ? "pair" : "resample";
	}

	/** The line p and q both sit on that goes on and that they sit on most closely, and whether a line they sit on at q jumps. */
	function rider(p: PlotPoint, q: PlotPoint, from: PlotOption, to: PlotOption) {
		let best: { j: number; share: number; how: "pair" | "resample" } | undefined;
		let jumps = false;
		for (const [j, s] of (to.series ?? []).entries()) {
			const old = counterpart(from, s, j);
			const how = motion(old, s);
			const atQ = off(q, readable(s));
			if (atQ === undefined) {
				continue;
			}
			if (how === "jump") {
				jumps = true;
				continue;
			}
			const atP = off(p, readable(old));
			if (atP !== undefined && (!best || atP + atQ < best.share)) {
				best = { j, share: atP + atQ, how };
			}
		}
		return { best, jumps };
	}
	/**
	 * A note's point or an arrow's end k of the way from p to q, moving as the line it sits on in `to` moves, as the rest of the
	 * plot does. Of the lines it sits on at q, the one that goes on (it sat on it at p too) and that it sits on most closely
	 * wins: its height over that line goes k of the way, read off the line as drawn at k (`now`), at the x the line's points take
	 * (k of the way when they move point by point, the new x when the line is resampled), since a point going straight would
	 * leave its line and trail it. Else, on a line that is `to`'s at once, it is at q at once; else it goes straight.
	 */
	function riding(
		p: PlotPoint,
		q: PlotPoint,
		k: number,
		from: PlotOption,
		to: PlotOption,
		now: PlotSeries[],
	) {
		const { best, jumps } = rider(p, q, from, to);
		const s = best && to.series?.[best.j];
		if (best && s) {
			const [a, b, line] = [
				readable(counterpart(from, s, best.j)),
				readable(s),
				readable(now[best.j]),
			];
			const x = best.how === "pair" ? lerp(p[0], q[0], k) : q[0];
			const [d0 = 0, d1 = 0] = [over(p, a), over(q, b)];
			return [x, yAt(line, x) + lerp(d0, d1, k)] as const;
		}
		return jumps ? q : ([lerp(p[0], q[0], k), lerp(p[1], q[1], k)] as const);
	}

	/** Markers, spans, notes' points and arrows' ends k of the way, when there are as many; points on a line move with it. */
	function marks(from: PlotOption, to: PlotOption, k: number, now: PlotSeries[]) {
		const [a, b] = [from.marks, to.marks ?? []];
		if (a?.length !== b.length) {
			return [...b];
		}
		return b.map((m, i) => {
			const o = a[i];
			const at = (key: "x" | "y") =>
				m[key] === undefined ? {} : { [key]: step(o?.[key], m[key], k) };
			const point = (key: "at" | "from" | "to") => {
				const [p, q] = [o?.[key], m[key]];
				return q === undefined
					? {}
					: { [key]: isPoint(p) && isPoint(q) ? riding(p, q, k, from, to, now) : q };
			};
			return {
				...m,
				...at("x"),
				...at("y"),
				...point("at"),
				...point("from"),
				...point("to"),
			} as PlotMark;
		});
	}

	/** The series of `from` that `b`, series j of the new option, moves from: the one of its name, or an unnamed one at j. */
	const counterpart = (from: PlotOption, b: PlotSeries, j: number) =>
		b.name === undefined
			? from.series?.[j]?.name === undefined
				? from.series?.[j]
				: undefined
			: from.series?.find((a) => a.name === b.name);

	function between(from: PlotOption, to: PlotOption, k: number): PlotOption {
		const series = (to.series ?? []).map((s, j) => {
			const a = counterpart(from, s, j);
			return a ? { ...s, data: data(a, s, k) } : s;
		});
		return {
			...to,
			...(to.series && { series }),
			...(to.x && { x: axis(from.x, to.x, k) }),
			...(to.y && { y: axis(from.y, to.y, k) }),
			...(to.marks && { marks: marks(from, to, k, series) }),
		};
	}

	/** Whether two options are the same, value for value (functions by identity), so a plot set to what it shows need not move. */
	function same(a: unknown, b: unknown): boolean {
		if (a === b) {
			return true;
		}
		if (!(a && b && typeof a === "object" && typeof b === "object")) {
			return false;
		}
		const [ka, kb] = [Object.keys(a), Object.keys(b)];
		return (
			Array.isArray(a) === Array.isArray(b) &&
			ka.length === kb.length &&
			ka.every((key) => same(a[key as keyof typeof a], b[key as keyof typeof b]))
		);
	}

	return { between, same };
};
