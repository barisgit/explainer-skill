/* plot tween: the steps plot.js draws between two options when a set() changes what a plot shows, so bars grow or shrink and
   lines morph from the state they are in. between(from, to, k) is `to` with its numbers k of the way from `from`'s: a bar's value,
   a point (a line of another length is read off the old one at the new x values), an axis's min and max, a marker's place. What
   has no counterpart in `from` (a series of a new name, an unnamed one where `from` has none unnamed at its place, another type, a
   different number of bars) is `to`'s at once; series are matched by name, unnamed ones by place. Not referenced from
   pages: pack joins it in front of plot.js. same(a, b) says whether two options draw alike, so setting one changes nothing. */
window.PlotTween = () => {
	const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
	const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
	const isPoint = (p: unknown): p is PlotPoint => Array.isArray(p) && num(p[0]) && num(p[1]);

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

	/** Markers k of the way, when there are as many. */
	function marks(a: readonly PlotMark[] | undefined, b: readonly PlotMark[], k: number) {
		if (a?.length !== b.length) {
			return [...b];
		}
		return b.map((m, i) => {
			const o = a[i];
			const at = (key: "x" | "y") => {
				const [from, to] = [o?.[key], m[key]];
				return num(from) && num(to) ? { [key]: lerp(from, to, k) } : {};
			};
			return { ...m, ...at("x"), ...at("y") };
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
		return {
			...to,
			...(to.series && {
				series: to.series.map((s, j) => {
					const a = counterpart(from, s, j);
					return a ? { ...s, data: data(a, s, k) } : s;
				}),
			}),
			...(to.x && { x: axis(from.x, to.x, k) }),
			...(to.y && { y: axis(from.y, to.y, k) }),
			...(to.marks && { marks: marks(from.marks, to.marks, k) }),
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
