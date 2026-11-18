/* What the kit sets on a Chart's series by their place, which an ECharts theme cannot: a dash per palette slot on a line, a
   line in the tone under the chart between touching fills (stacked bars and areas, a pie's slices), and where a marker line's
   label goes. ChartsOption hands it on;
   live and pack draw the option defaults() returns, built afresh from the author's option at every draw, so what the kit
   generated never mixes into what the author wrote. styling() says what it generated, so a change to it redraws the chart. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the function only scopes the part's names away from the page; the code in it is split into small functions
window.ChartsDefaults = (() => {
	/** Dashes by palette slot, the slot's colour's companion (Plot's, kit/parts/plot/draw.ts): the first solid. */
	const DASHES: (number[] | undefined)[] = [
		undefined,
		[6, 4],
		[1, 4],
		[12, 4],
		[6, 4, 1, 4],
		[12, 4, 1, 4],
	];
	/** px: a marker label's distance from its line. */
	const BESIDE = 8;

	type Item = Record<string, unknown>;
	const isObject = (value: unknown): value is Item =>
		value !== null && typeof value === "object" && !Array.isArray(value);
	const objectAt = (value: unknown, key: string): Item =>
		isObject(value) && isObject(value[key]) ? value[key] : {};

	/** Whether the author set a series' colour, which then needs no dash to stand apart: the finding in the accent, say. */
	const coloured = (s: Item) =>
		"color" in s ||
		"color" in objectAt(s, "lineStyle") ||
		"type" in objectAt(s, "lineStyle") ||
		"color" in objectAt(s, "itemStyle");

	/** The line in the tone under the chart that parts touching fills: stacked bars and areas, a pie's slices. */
	const PARTING = { color: "var(--under)", width: 1 };

	/**
	 * What the kit sets on a series in slot i: its line's dash, or the line that parts touching fills, which a stacked area draws
	 * as its own line. What the author set on that style is left alone: their colour or dash on a line, their border on a fill.
	 */
	function generated(s: Item, i: number): Item {
		if (s.type !== "line") {
			return parted(s);
		}
		if (s.stack != null && "areaStyle" in s) {
			const line = objectAt(s, "lineStyle");
			// The line is the parting line, so its points are filled in the series' colour, which its legend entry shows.
			return "color" in line || "width" in line
				? {}
				: { lineStyle: { ...PARTING, type: "solid" }, symbol: "circle" };
		}
		const dash = DASHES[i % DASHES.length];
		return dash && !coloured(s) ? { lineStyle: { type: dash, cap: "round" } } : {};
	}

	/** A fill's border in the parting line, when it touches the next (a stacked bar, a pie's slice) and the author set none. */
	function parted(s: Item): Item {
		const item = objectAt(s, "itemStyle");
		const touches = (s.type === "bar" && s.stack != null) || s.type === "pie";
		return touches && !("borderColor" in item || "borderWidth" in item)
			? { itemStyle: { borderColor: PARTING.color, borderWidth: PARTING.width } }
			: {};
	}

	/**
	 * A treemap's tiles the author coloured with the accent, and the tiles inside them that take its colour, get the accent's ink
	 * for their label, since the ink the theme sets is only legible on the muted fill the other tiles take. Their own label colour wins.
	 */
	function accentLabels(nodes: unknown, inherited = false): unknown {
		if (!Array.isArray(nodes)) {
			return nodes;
		}
		return nodes.map((node) => {
			if (!isObject(node)) {
				return node;
			}
			const own = objectAt(node, "itemStyle").color;
			const accent = own === undefined ? inherited : own === "var(--accent)";
			const tinted = accent && !("color" in objectAt(node, "label"));
			return {
				...node,
				...(tinted && { label: { ...objectAt(node, "label"), color: "var(--accent-ink)" } }),
				...("children" in node && { children: accentLabels(node.children, accent) }),
			};
		});
	}

	const labelled = (s: Item, type = s.type): Item =>
		type === "treemap" && "data" in s ? { ...s, data: accentLabels(s.data) } : s;

	/** `s` with what the kit generated (`extra`) under it: style objects merged key by key, other keys only where `s` has none. */
	const styled = (s: Item, extra: Item): Item => ({
		...extra,
		...s,
		...Object.fromEntries(
			Object.entries(extra)
				.filter(([, value]) => isObject(value))
				.map(([key]) => [key, { ...objectAt(extra, key), ...objectAt(s, key) }]),
		),
	});

	/** An axis of the option by index, from a single axis or a list. */
	const axisAt = (axes: unknown, index: unknown) =>
		Array.isArray(axes) ? axes[Number(index ?? 0)] : axes;

	/**
	 * A marker's label keys the kit sets, where neither the marker's label (`own`) nor the series' markers' label (`all`) sets
	 * them: a line down the plot ({ xAxis }) carries its label above its top end (`top`), beside the line on its right, or on its
	 * left when `left` (past the axis' middle); a line across it ({ yAxis }) carries its label above its far end. Align and offset
	 * go together: an author who set either placed the label.
	 */
	function markLabel(item: Item, own: Item, all: Item, top: string, left: boolean): Item {
		const set = (key: string) => key in own || key in all;
		const label: Item = {};
		if (!set("position")) {
			label.position = "xAxis" in item ? top : "insideEndTop";
		}
		if ("xAxis" in item && !(set("align") || set("offset"))) {
			Object.assign(
				label,
				left ? { align: "right", offset: [-BESIDE, 0] } : { align: "left", offset: [BESIDE, 0] },
			);
		}
		return label;
	}

	/**
	 * A series' marker lines with their labels on top, whichever way the y axis runs, on the side with more of the plot: `left`
	 * names the markers, by index, past the x axis' middle. What the author set stays (see markLabel).
	 */
	function marked(s: Item, option: Item, left: ReadonlySet<number>) {
		const { markLine } = s;
		if (!(isObject(markLine) && Array.isArray(markLine.data))) {
			return s;
		}
		const yAxis = axisAt(option.yAxis, s.yAxisIndex);
		const top = isObject(yAxis) && yAxis.inverse ? "start" : "end";
		const all = objectAt(markLine, "label");
		const data = markLine.data.map((item: unknown, k: number) => {
			if (!(isObject(item) && ("xAxis" in item || "yAxis" in item))) {
				return item;
			}
			const own = objectAt(item, "label");
			const label = markLabel(item, own, all, top, left.has(k));
			return Object.keys(label).length ? { ...item, label: { ...label, ...own } } : item;
		});
		return { ...s, markLine: { ...markLine, data } };
	}

	type SeriesEntry = { s: unknown; base: Item; index: number };
	const sameKey = (a: Item, b: Item, key: string) =>
		a[key] != null && b[key] != null && String(a[key]) === String(b[key]);

	/** Match overrides against the base in ECharts' normal-merge order: id, name, then the first free slot. */
	function paired(list: unknown[], over: unknown[]): SeriesEntry[] {
		const slots = over.filter(isObject);
		const entries: SeriesEntry[] = list.map((s) => ({ s, base: {}, index: -1 }));
		const used = new Set<number>();
		const match = (accept: (s: Item, base: Item) => boolean) => {
			for (const entry of entries) {
				if (!isObject(entry.s) || entry.index >= 0) {
					continue;
				}
				const s = entry.s;
				const found = [...slots.entries()].find(
					([index, base]) => !used.has(index) && accept(s, base),
				);
				if (found) {
					const [index, base] = found;
					Object.assign(entry, { index, base });
					used.add(index);
				}
			}
		};
		match((s, base) => sameKey(s, base, "id"));
		// Even an unnamed base series has an ECharts-generated id: a new explicit id cannot overwrite it by name or index.
		match((s, base) => s.id == null && sameKey(s, base, "name"));
		match((s) => s.id == null);
		for (const entry of entries) {
			if (isObject(entry.s) && entry.index < 0) {
				entry.index = slots.length;
				slots.push({});
			}
		}
		return entries;
	}

	/** A list of series with the kit's defaults; `over` is the base series list for a media or timeline override. */
	function series(list: unknown[], option: Item, sides: Sides, over?: unknown[]) {
		const entries = over ? paired(list, over) : list.map((s, index) => ({ s, base: {}, index }));
		return entries.map(({ s, base, index }) => {
			if (!isObject(s)) {
				return s;
			}
			if (!over) {
				return marked(
					styled(labelled(s), generated(s, index)),
					option,
					sides.get(index) ?? new Set(),
				);
			}
			return overridden(s, base, index);
		});
	}

	/** Only the styling an override changes, including solid where the base had a generated dash. */
	function overridden(s: Item, base: Item, index: number) {
		const was = generated(base, index);
		const now = generated(
			{
				...base,
				...s,
				lineStyle: { ...objectAt(base, "lineStyle"), ...objectAt(s, "lineStyle") },
			},
			index,
		);
		const dropped =
			"lineStyle" in was && !("lineStyle" in now) && !("type" in objectAt(s, "lineStyle"));
		return styled(
			labelled(s, s.type ?? base.type),
			dropped ? { lineStyle: { type: "solid" } } : now,
		);
	}

	type Sides = ReadonlyMap<number, ReadonlySet<number>>;
	const listOf = (value: unknown) =>
		Array.isArray(value) ? value : isObject(value) ? [value] : undefined;
	/** A component's series with the defaults, as a list or the one series it was. */
	function withSeries(component: Item, root: Item, sides: Sides, over?: unknown[]): Item {
		const list = listOf(component.series);
		if (!list) {
			return component;
		}
		const done = series(list, root, sides, over);
		return { ...component, series: Array.isArray(component.series) ? done : done[0] };
	}

	/**
	 * The option with the kit's defaults on its series: at its root, or in its baseOption and, over that, each of its timeline
	 * options and media options. `sides` names, by series index, the markers whose labels go left of their line (see place).
	 */
	function defaults(option: ChartOption, sides: Sides = new Map()): ChartOption {
		const explicit = isObject(option.baseOption);
		const base = isObject(option.baseOption) ? option.baseOption : option;
		const baseSeries = listOf(base.series) ?? [];
		const over = (o: unknown) => (isObject(o) ? withSeries(o, base, sides, baseSeries) : o);
		return {
			...(explicit
				? { ...option, baseOption: withSeries(base, base, sides) }
				: withSeries(option, option, sides)),
			...(Array.isArray(option.options) ? { options: option.options.map(over) } : {}),
			...(Array.isArray(option.media)
				? {
						media: option.media.map((m: unknown) =>
							isObject(m) && isObject(m.option) ? { ...m, option: over(m.option) } : m,
						),
					}
				: {}),
		};
	}

	/**
	 * What defaults() generates for an option, with the markers it places, as text: when it changes, the chart is drawn afresh
	 * rather than patched.
	 */
	const styling = (option: ChartOption) => {
		const listed = (o: unknown) => (isObject(o) ? (listOf(o.series) ?? []) : []);
		const root = isObject(option.baseOption) ? option.baseOption : option;
		return JSON.stringify(
			listed(root).map((s, i) => (isObject(s) ? [generated(s, i), s.markLine ?? null] : null)),
		);
	};

	/** The private model of a drawn chart, as far as place reads it; ECharts declares no public type for it. */
	interface MarkAxis {
		dim: string;
		scale: { parse(value: unknown): number };
		dataToCoord(value: number): number;
		getExtent(): [number, number];
	}
	interface MarkSeries {
		seriesIndex: number;
		get(key: string): unknown;
		coordinateSystem?: { getAxis?(dim: string): MarkAxis | undefined };
	}

	/**
	 * Which of a drawn chart's vertical markers stand past the middle of their x axis, by series index and marker index: their
	 * labels go on the line's left, where the plot has more room (see marked). Read from the axis as ECharts laid it out, so
	 * it holds at every width.
	 */
	function place(chart: unknown): Sides {
		const sides = new Map<number, Set<number>>();
		(chart as { getModel(): { eachSeries(fn: (s: MarkSeries) => void): void } })
			.getModel()
			.eachSeries((s) => {
				const past = pastMiddle(s);
				if (past.size) {
					sides.set(s.seriesIndex, past);
				}
			});
		return sides;
	}

	/** The indices of a drawn series' vertical markers past the middle of its x axis, as ECharts laid the axis out. */
	function pastMiddle(s: MarkSeries): Set<number> {
		const past = new Set<number>();
		const { data } = objectAt({ markLine: s.get("markLine") }, "markLine");
		const axis = s.coordinateSystem?.getAxis?.("x");
		if (!(axis && Array.isArray(data))) {
			return past;
		}
		const [a, b] = axis.getExtent();
		for (const [k, item] of data.entries()) {
			if (isObject(item) && "xAxis" in item) {
				const at = axis.dataToCoord(axis.scale.parse(item.xAxis));
				if ((at - Math.min(a, b)) / Math.abs(b - a) > 0.5) {
					past.add(k);
				}
			}
		}
		return past;
	}

	return { defaults, styling, place };
})();
