/* Chart ends: the names a Chart's lines carry at their ends (a Chart never falls back to a legend for them), not referenced from
   pages: pack joins it in front of charts.js with option.ts, which hands it on as ChartsOption's endNames, unnamed and spreadEnds.
   ChartsEnds({ isObject, size }) gives endNames(option, width), the option with its names at the ends; unnamed(option), why
   pack cannot name an option's lines there; and spreadEnds(chart), names that crowd moved apart about their ends. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the function only scopes the part's names away from the page; the code in it is split into small functions
window.ChartsEnds = ({ isObject, size }) => {
	/** px: ECharts' gap between a line's end and its end label, and the room kept past the label. */
	const END_DISTANCE = 8;
	const END_MARGIN = 8;
	/** px: a label's line with its halo. */
	const endLine = () => size() + 2;
	// What the kit cannot see the names' size or place through: a text style of the author's, zoom, and anything but one plain grid.
	const ROOT_ONLY = ["baseOption", "options", "media", "textStyle", "dataZoom", "dataset"];
	const SERIES_ONLY = ["labelLayout", "coordinateSystem", "xAxisIndex", "yAxisIndex", "encode"];

	type Categories = unknown[] | undefined;
	/** ECharts reads the category's value, not the object that styles it. */
	const categories = (axis: Record<string, unknown>): Categories =>
		Array.isArray(axis.data)
			? axis.data.map((v) => (isObject(v) ? v.value : String(v)))
			: undefined;

	const empty = (v: unknown, names: Categories) =>
		v == null || Number.isNaN(v) || ((v === "-" || v === "") && !names?.includes(v));

	/** A number as it is, a category's name as its index (as in ECharts' ordinal map), or undefined if unreadable. */
	function onAxis(v: unknown, names: Categories): number | undefined {
		if (typeof v === "number" && Number.isFinite(v)) {
			return v;
		}
		const k = names?.lastIndexOf(v) ?? -1;
		return k < 0 ? undefined : k;
	}

	/** A tuple supplies both coordinates; a scalar is y at the item's index. */
	function point(item: unknown, i: number): readonly [unknown, unknown] {
		if (isObject(item)) {
			return point(item.value, i);
		}
		return Array.isArray(item) ? [item[0], item[1]] : [i, item];
	}

	/** An axis min or max: unset, data-bound, numeric, or NaN when the kit cannot read it. */
	const bound = (at: unknown, names: Categories) =>
		at === undefined || at === "dataMin" || at === "dataMax"
			? at
			: (onAxis(at, names) ?? Number.NaN);

	/** Whether a drawable point lies past numeric bounds: "cuts", "" for one inside, "unknown" for an unreadable coordinate. */
	function past(v: number | undefined, min: unknown, max: unknown) {
		if (v === undefined) {
			return "unknown";
		}
		return (typeof min === "number" && v < min) || (typeof max === "number" && v > max)
			? "cuts"
			: "";
	}
	/**
	 * Whether the axis on dimension `dim` may clip a line, which puts its end label where the line meets the edge: "cuts" for an
	 * author's min or max a point lies past, "unknown" for one the kit cannot compare (a function, a value it cannot read, a
	 * stacked line's y, which is a sum ECharts makes), "" for none.
	 */
	function clips(
		axis: Record<string, unknown>,
		dim: 0 | 1,
		series: Record<string, unknown>[],
		names: readonly [Categories, Categories],
	) {
		const [min, max] = [bound(axis.min, names[dim]), bound(axis.max, names[dim])];
		if (min === undefined && max === undefined) {
			return "";
		}
		const summed = dim === 1 && series.some((s) => s.stack);
		if (Number.isNaN(min) || Number.isNaN(max) || (summed && [min, max].some(Number.isFinite))) {
			return "unknown";
		}
		const found = series.flatMap((s) =>
			Array.isArray(s.data)
				? s.data.map((item, i) => {
						const xy = point(item, i);
						return empty(xy[0], names[0]) || empty(xy[1], names[1])
							? ""
							: past(onAxis(xy[dim], names[dim]), min, max);
					})
				: [],
		);
		return found.includes("cuts") ? "cuts" : found.includes("unknown") ? "unknown" : "";
	}

	/** Why the option's axes keep names from the line ends, or "": one x axis left to right and one value or log y axis. */
	function axesBar({ xAxis, yAxis }: ChartOption, series: Record<string, unknown>[]) {
		if (!(isObject(xAxis) && isObject(yAxis))) {
			return "a second axis";
		}
		if (xAxis.inverse) {
			return "a reversed x axis";
		}
		if (yAxis.type === "category" || yAxis.type === "time") {
			return `a ${yAxis.type} y axis`;
		}
		if ([xAxis.min, xAxis.max, yAxis.min, yAxis.max].every((at) => at === undefined)) {
			return "";
		}
		const names = [categories(xAxis), categories(yAxis)] as const;
		const x = clips(xAxis, 0, series, names);
		const which = x ? "an x" : "a y";
		switch (x || clips(yAxis, 1, series, names)) {
			case "cuts":
				return `${which} axis min or max that cuts a line short`;
			case "unknown":
				return `${which} axis min or max the kit cannot compare with the lines`;
			default:
				return "";
		}
	}

	/** Whether the option's two or more named series are all lines, with no legend or end labels of the author's to name them. */
	function namedLines(option: ChartOption, list: Record<string, unknown>[]) {
		const named = list.filter((s) => typeof s.name === "string" && s.name);
		return (
			named.length > 1 &&
			named.every((s) => s.type === "line") &&
			!list.some((s) => "endLabel" in s) &&
			!("legend" in option)
		);
	}

	/**
	 * Why the option's two or more named lines cannot carry their names at their ends, or "" when they can; undefined for an
	 * option this rule is not about: a legend, an end label of the author's, fewer than two named series, or a named series
	 * that is not a line. A text style of the author's sizes the names where the kit cannot measure them; zoom and a dataset
	 * move the ends; the rest place them where an end label cannot follow.
	 */
	function endsBar(given: ChartOption): string | undefined {
		// The series of a baseOption are the chart's too, and the baseOption is what keeps their names off.
		const option = isObject(given.baseOption) ? { ...given.baseOption, ...given } : given;
		const { series, grid = {} } = option;
		const list = Array.isArray(series) ? series.filter(isObject) : [];
		if (!namedLines(option, list)) {
			return undefined;
		}
		return unseen(option, list) || gridBar(grid) || axesBar(option, list);
	}
	/** The setting of the option's or a series' own that the kit cannot see the names through, as a reason; "" for none. */
	function unseen(option: ChartOption, list: Record<string, unknown>[]) {
		const root = ROOT_ONLY.find((key) => key in option);
		const own = SERIES_ONLY.find((key) => list.some((s) => key in s));
		return root ? `its ${root}` : own ? `a series' ${own}` : "";
	}
	/** Why the kit cannot reserve name room by increasing grid.right, or "". An explicit width can take precedence over right. */
	function gridBar(grid: unknown) {
		if (!isObject(grid)) {
			return "a second grid";
		}
		if (grid.width !== undefined) {
			return "an explicit grid width";
		}
		return grid.right !== undefined && typeof grid.right !== "number"
			? "a grid right that is not in px"
			: "";
	}

	/**
	 * Why pack cannot name an option's named lines at their ends and nothing else names them: a reason, or undefined when they
	 * carry names (at their ends, in a legend, or in end labels of the author's).
	 */
	const unnamed = (option: ChartOption) => endsBar(option) || undefined;

	/**
	 * For an option whose named lines carry their names at their ends, the option so, else undefined; names that crowd are moved
	 * apart at their ends (spreadEnds), never into a legend. It applies
	 * when the option has no legend, its series are two or more named lines with no end label or label layout of their own, on
	 * one grid with a left-to-right x axis (not reversed) and a value or log y axis, neither with a min or max that cuts a line
	 * short, and nothing sets the names' text (a textStyle) or moves their ends (dataZoom, a dataset, encode); see endsBar. The grid keeps room on its right for the longest name, measured by `width` at the label size.
	 */
	function endNames(option: ChartOption, width: (text: string) => number): ChartOption | undefined {
		const { series, grid = {} } = option;
		if (endsBar(option) !== "" || !(Array.isArray(series) && isObject(grid))) {
			return undefined;
		}
		const names = series.flatMap((s) => (isObject(s) && s.name ? [String(s.name)] : []));
		const room = Math.max(...names.map(width)) + END_DISTANCE + END_MARGIN;
		const end = {
			endLabel: { __kitEndName: true, show: true, formatter: "{a}", valueAnimation: false },
		};
		return {
			...option,
			grid: { ...grid, right: Math.max(Number(grid.right ?? 0), Math.ceil(room)) },
			series: series.map((s) => (isObject(s) && s.name ? { ...s, ...end } : s)),
		};
	}

	/** The live model of a line series, as far as spreadEnds reads it; ECharts declares no public type for it. */
	interface EndSeries {
		name: string;
		id: string;
		get(path: string[]): unknown;
		getData(): { getLayout(key: "points"): ArrayLike<number> | undefined };
	}
	/** The live model, as far as spreadEnds reads it: the series and the grid's rectangle in px. */
	interface EndModel {
		eachSeries(fn: (s: EndSeries) => void): void;
		getComponent(
			type: "grid",
			index: number,
		): { coordinateSystem?: { getRect(): { y: number; height: number } } } | undefined;
	}
	/** Each kit-named line's id, name and end: the y of its last point that is not empty, where ECharts anchors it. */
	function endsOf(model: EndModel) {
		const ends: { id: string; name: string; y: number }[] = [];
		model.eachSeries((s) => {
			const points =
				s.get(["endLabel", "__kitEndName"]) && s.get(["endLabel", "show"])
					? s.getData().getLayout("points")
					: undefined;
			for (let i = (points?.length ?? 0) - 2; points && i >= 0; i -= 2) {
				const [x, y] = [points[i], points[i + 1]];
				if (Number.isFinite(x) && Number.isFinite(y)) {
					ends.push({ id: s.id, name: s.name, y: y as number });
					break;
				}
			}
		});
		return ends.sort((a, b) => a.y - b.y);
	}

	/**
	 * Where names at ends `ys` (ascending) go, `step` apart at least: each group of names that would sit closer is centred on its
	 * ends' mean, a step apart in their order, and kept inside [lo, hi] where it fits; groups that then meet are joined.
	 */
	function spread(ys: readonly number[], step: number, [lo, hi]: readonly [number, number]) {
		const groups: { n: number; sum: number }[] = [];
		const first = ({ n, sum }: { n: number; sum: number }) =>
			Math.min(Math.max(sum / n - ((n - 1) * step) / 2, lo), hi - (n - 1) * step);
		for (const y of ys) {
			groups.push({ n: 1, sum: y });
			for (let k = groups.length - 1; k > 0; k--) {
				const [g, h] = [groups[k - 1], groups[k]] as [(typeof groups)[0], (typeof groups)[0]];
				if (first(g) + g.n * step <= first(h)) {
					break;
				}
				groups.splice(k - 1, 2, { n: g.n + h.n, sum: g.sum + h.sum });
			}
		}
		return groups.flatMap((g) => Array.from({ length: g.n }, (_, k) => first(g) + k * step));
	}

	/**
	 * Move kit-named lines' labels apart inside the grid. On resize, `every` also resets offsets that no longer need a spread.
	 * Names that cannot fit a line apart or must move over half a line from their ends remain unclear.
	 */
	function spreadEnds(chart: unknown, every = false) {
		const model = (chart as { getModel(): EndModel }).getModel();
		const ends = endsOf(model);
		if (!ends.length) {
			return { patch: undefined, unclear: [] };
		}
		const rect = model.getComponent("grid", 0)?.coordinateSystem?.getRect();
		const [lo, hi] = rect ? [rect.y, rect.y + Math.max(0, rect.height)] : [-Infinity, Infinity];
		const line = endLine();
		const step = Math.min(line, (hi - lo) / Math.max(1, ends.length - 1));
		const at = spread(
			ends.map((e) => e.y),
			step,
			[lo, hi],
		);
		const moves = ends.map((end, k) => ({ ...end, dy: (at[k] ?? end.y) - end.y }));
		const unclear = moves
			.filter(({ dy }) => (ends.length > 1 && step < line) || Math.abs(dy) > line / 2 + 0.5)
			.map((m) => m.name);
		const series = moves
			.filter((m) => every || m.dy !== 0)
			.map(({ id, dy }) => ({ id, endLabel: { offset: [0, dy] } }));
		return { patch: series.length ? { series } : undefined, unclear };
	}

	return { endNames, unnamed, spreadEnds };
};
