/* Shared ECharts theme, layout and metrics. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the function only scopes the part's names away from the page; the code in it is split into small functions
window.ChartsOption = ({ color, lang, size, text }) => {
	const COLOR_KEY = /(olor|^fill|^stroke)$/;
	const COLOR_EXPR = /^(var|color-mix|light-dark)\(/;

	const isObject = (value: unknown): value is Record<string, unknown> =>
		value !== null && typeof value === "object" && !Array.isArray(value);

	/**
	 * The Intl options of a JSON number format (NumberFormat in kit-types/globals.d.ts), built as kit/components/parts/format.ts
	 * builds them: a plain number groups from five digits, so a year stays 2024; money always groups, so 4,200 stands beside 11,200,
	 * and a whole amount has no cents unless `digits` asks for them; percent wins over a currency.
	 */
	/** A percent stays one beside a currency, as Table writes it; money groups thousands always and drops whole cents. */
	const money = (currency: string | undefined, digits: number | undefined) => ({
		useGrouping: currency ? ("always" as const) : ("min2" as const),
		...(currency ? { currency } : {}),
		...(currency && digits === undefined ? { trailingZeroDisplay: "stripIfInteger" as const } : {}),
	});
	const intlOptions = ({
		digits,
		percent,
		currency,
		compact,
	}: NumberFormat): Intl.NumberFormatOptions => ({
		style: percent ? "percent" : currency ? "currency" : "decimal",
		...money(currency, digits),
		...(compact ? { notation: "compact" } : {}),
		...(digits === undefined
			? {}
			: { minimumFractionDigits: digits, maximumFractionDigits: digits }),
	});
	/** Writes a number in a JSON format as the page's lang does. A word unit stands apart (18 min), a symbol joins it (90%). */
	function numberText(format: NumberFormat) {
		const intl = new Intl.NumberFormat(lang(), intlOptions(format));
		const { unit = "" } = format;
		const after = /^\p{L}/u.test(unit) ? `\u00a0${unit}` : unit;
		return (v: number) => intl.format(v) + after;
	}

	const FORMAT_KEY = /^(formatter|valueFormatter|labelFormatter)$/;
	const FORMAT_NAMES = new Set(["digits", "unit", "percent", "currency", "compact"]);

	/** The number in what ECharts hands a formatter: a tick's value, the last of an [x, y] value, or a mark's params.value. */
	function numberIn(arg: unknown): unknown {
		if (Array.isArray(arg)) {
			return numberIn(arg.at(-1));
		}
		return isObject(arg) && "value" in arg ? numberIn(arg.value) : arg;
	}

	/** The texts as a formatter: a series label takes the one of its dataIndex, an axis label the one of its index. */
	const textsFormatter = (texts: string[]) => (arg: unknown, index: unknown) =>
		texts[isObject(arg) && typeof arg.dataIndex === "number" ? arg.dataIndex : Number(index)] ?? "";

	/** A NumberFormat as a formatter; text that is not a number, such as a category name, stays as it is. */
	function numberFormatter(format: NumberFormat) {
		const text = numberText(format);
		return (arg: unknown) => {
			const value = numberIn(arg);
			return typeof value === "number" ? text(value) : String(value ?? "");
		};
	}

	/** The function ECharts calls for a formatter written as JSON under a formatter key (texts, or a NumberFormat), else undefined. */
	function jsonFormatter(key: string, value: unknown) {
		if (!FORMAT_KEY.test(key)) {
			return undefined;
		}
		if (Array.isArray(value)) {
			const texts = value.filter((item): item is string => typeof item === "string");
			return texts.length === value.length ? textsFormatter(texts) : undefined;
		}
		return isObject(value) && Object.keys(value).every((name) => FORMAT_NAMES.has(name))
			? numberFormatter(value)
			: undefined;
	}

	/** Items of an array resolved, or the array itself when it holds numbers only. */
	const resolveItems = (items: unknown[], key: string) =>
		items.every((item) => typeof item === "number")
			? items
			: items.map((item) => resolveOption(item, key));

	/**
	 * Copy of an option with every colour expression under a colour key resolved, and every JSON formatter made a function. Plain
	 * objects and arrays are copied, everything else (functions, class instances, arrays of numbers only) is shared, so an item in
	 * a data array that also holds numbers is resolved. Run at every mount so saved options stay token-based.
	 */
	function resolveOption<T>(value: T, key?: string): T;
	function resolveOption(value: unknown, key = ""): unknown {
		if (typeof value === "string") {
			return COLOR_KEY.test(key) && COLOR_EXPR.test(value) ? color(value) : value;
		}
		const formatter = jsonFormatter(key, value);
		if (formatter) {
			return formatter;
		}
		if (Array.isArray(value)) {
			return resolveItems(value, key);
		}
		if (!isObject(value) || Object.getPrototypeOf(value) !== Object.prototype) {
			return value;
		}
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveOption(v, k)]));
	}

	/** Where ECharts reads an option's root settings, such as animation: its baseOption when it has one, which hides the root's. */
	const settings = (option: ChartOption): ChartOption =>
		isObject(option.baseOption) ? option.baseOption : option;

	/**
	 * The option drawn still. Nothing animates on arrival, and ECharts animates a first frame whatever the duration (a line's
	 * symbols pop in), so a chart's first draw, live or packed, has animation off where the option would set it.
	 */
	const still = (option: ChartOption): ChartOption =>
		isObject(option.baseOption)
			? { ...option, baseOption: { ...option.baseOption, animation: false } }
			: { ...option, animation: false };

	const ends = window.ChartsEnds({ isObject, size });

	type TextMeasure = (text: string, font?: string) => { width: number };
	/**
	 * zrender uses this square-glyph width as line height. Native fallback fonts vary by platform, so use
	 * its one-em SSR metric on both sides. Ordinary widths and explicit lineHeight options still belong to the renderer.
	 */
	const measureText =
		(base: TextMeasure): TextMeasure =>
		(text, font) =>
			text === "国"
				? { width: Number(/(\d+(?:\.\d+)?)px/.exec(font ?? "")?.[1] ?? 12) }
				: base(text, font);

	/**
	 * Layout provenance travels through ECharts' own component merges, including media/baseOption and singleton arrays. Defaults
	 * alone cannot distinguish authored top: 65 from ECharts' top: 65. Never mark generated grid patches as authored. An author's
	 * top or bottom leaves the legend its room (the larger bottom wins, as a smaller one only puts the legend over the axis
	 * labels: #257); a height fixes the grid's box, and the author's legend position places the legend. Grid bounds in a media
	 * query's option stay the author's: ECharts applies them again over a generated bottom.
	 */
	function authoredLayout(option: ChartOption, gridKeys = ["height"]): ChartOption {
		const component = (value: unknown, keys: string[]): unknown => {
			if (Array.isArray(value)) {
				return value.map((item) => component(item, keys));
			}
			// A key set to null clears that bound, so the component is the kit's again once none is left.
			return isObject(value) && keys.some((key) => key in value)
				? { ...value, __kitLegendRoom: !keys.some((key) => value[key] != null) }
				: value;
		};
		const result = { ...option };
		if ("grid" in result) {
			result.grid = component(result.grid, gridKeys);
		}
		if ("legend" in result) {
			result.legend = component(result.legend, [
				"top",
				"bottom",
				"left",
				"right",
				"width",
				"height",
				"x",
				"x2",
				"y",
				"y2",
			]);
		}
		if (isObject(result.baseOption)) {
			result.baseOption = authoredLayout(result.baseOption);
		}
		if (Array.isArray(result.options)) {
			result.options = result.options.map((item: unknown) =>
				isObject(item) ? authoredLayout(item) : item,
			);
		}
		if (Array.isArray(result.media)) {
			result.media = result.media.map((item: unknown) =>
				isObject(item) && isObject(item.option)
					? { ...item, option: authoredLayout(item.option, ["top", "bottom", "height", "y", "y2"]) }
					: item,
			);
		}
		return result;
	}

	interface LayoutComponent {
		get(key: string): unknown;
		coordinateSystem?: object;
	}
	interface LayoutRect {
		y: number;
		height: number;
		clone(): LayoutRect;
		applyTransform(matrix: number[]): void;
	}
	/** ECharts 6.1's model/view API is private in its public declarations; keep the assertion and the contract here. */
	interface LayoutChart {
		setOption(option: ChartOption, ...args: unknown[]): void;
		resize(...args: unknown[]): void;
		getHeight(): number;
		isDisposed(): boolean;
		getZr(): {
			animation: {
				on(event: "frame", fn: () => void): void;
				off(event: "frame", fn: () => void): void;
			};
		};
		getModel(): { queryComponents(query: { mainType: string }): LayoutComponent[] };
		getViewOfComponentModel(model: LayoutComponent): {
			group: { getBoundingRect(): LayoutRect; getComputedTransform(): number[] | null };
		};
	}

	/** A component only when it is the sole one of its kind; ECharts has already normalized object and array options. */
	function single(chart: LayoutChart, mainType: string): LayoutComponent | undefined {
		const items = chart.getModel().queryComponents({ mainType });
		return items.length === 1 ? items[0] : undefined;
	}

	/** The rendered box in chart coordinates, padding included; group bounds alone are local. */
	function legendBox(chart: LayoutChart, legend: LayoutComponent): LayoutRect {
		const group = chart.getViewOfComponentModel(legend).group;
		const box = group.getBoundingRect().clone();
		const transform = group.getComputedTransform();
		if (transform) {
			box.applyTransform(transform);
		}
		return box;
	}

	/** ECharts registered its deferred render first. Measure once after that frame, including silent lazy updates. */
	function afterFrame(chart: LayoutChart, apply: () => void) {
		const animation = chart.getZr().animation;
		const done = () => {
			animation.off("frame", done);
			apply();
		};
		animation.on("frame", done);
	}

	/** A grid bound in pixels as ECharts reads it (a number, digits or a percentage of the chart's height), else undefined. */
	function pixels(value: unknown, height: number): number | undefined {
		const text = String(value).trim();
		const amount = Number.parseFloat(text);
		if (typeof value === "number" || /^-?[\d.]+(px)?$/.test(text)) {
			return Number.isFinite(amount) ? amount : undefined;
		}
		return /^-?[\d.]+%$/.test(text) ? (amount * height) / 100 : undefined;
	}

	/** Install once before the first option. Restore only our bottom before author updates, never over an authored height. */
	function layout(instance: unknown): void {
		const chart = instance as LayoutChart;
		const setOption = chart.setOption.bind(chart);
		const resize = chart.resize.bind(chart);
		// The bottom the grid had before the kit's, as written (30% stays a percentage across resizes).
		let saved: unknown;
		let revision = 0;
		const restore = (lazy = false) => {
			if (saved !== undefined && !chart.isDisposed()) {
				setOption({ grid: { bottom: saved } }, { silent: true, lazyUpdate: lazy });
			}
			saved = undefined;
		};
		const reserve = (version: number) => {
			// An updated handler can queue another lazy option during this frame; its view is not ready yet.
			if (version !== revision || chart.isDisposed()) {
				return;
			}
			const grid = single(chart, "grid");
			const legend = single(chart, "legend");
			if (
				!grid?.coordinateSystem ||
				!legend ||
				!grid.get("__kitLegendRoom") ||
				!legend.get("__kitLegendRoom") ||
				!legend.get("show") ||
				legend.get("orient") !== "horizontal"
			) {
				return;
			}
			const box = legendBox(chart, legend);
			if (!box.height) {
				return;
			}
			const written = grid.get("bottom");
			const original = pixels(written, chart.getHeight());
			const bottom = chart.getHeight() - box.y + 12;
			if (original !== undefined && bottom > original) {
				saved = written;
				setOption({ grid: { bottom } }, { silent: true });
			}
		};
		chart.setOption = (option, ...args) => {
			const version = ++revision;
			const lazy = Boolean(isObject(args[0]) ? args[0].lazyUpdate : args[1]);
			// Merge our restoration into the same deferred frame, never flush the unreserved grid first.
			restore(lazy);
			setOption(authoredLayout(option), ...args);
			if (lazy && !chart.isDisposed()) {
				afterFrame(chart, () => reserve(version));
			} else {
				reserve(version);
			}
		};
		chart.resize = (...args) => {
			const version = ++revision;
			restore();
			resize(...args);
			reserve(version);
		};
	}

	/** The series types whose labels the theme writes in ink. */
	const LABELLED = [
		"line",
		"bar",
		"scatter",
		"pie",
		"heatmap",
		"treemap",
		"sankey",
		"sunburst",
		"radar",
		"boxplot",
	];

	/** ECharts theme object built from the tokens, so every component starts in the page's look, its text at the label size. */
	function theme({ under, font, animation }: { under: string; font: string; animation: boolean }) {
		const token = (name: string) => color(`var(--${name})`);
		const ink = token("ink");
		const muted = token("muted");
		const rule = token("rule");
		const ruleStrong = token("rule-strong");
		const surface = token("surface");
		const accent = token("accent");
		const accentSoft = token("accent-soft");
		// ECharts sets 12 px on its axis labels, legend and others itself, which the root text style does not reach.
		const fontSize = size();
		// No chrome: the labels say where values are, gridlines and ticks are off, and an axis line (on by ECharts' default only
		// for category and time axes, as the baseline marks start from) is quiet. What an option turns back on keeps these colours.
		const axis = {
			// Rescaling places ticks at once: moving old ticks through the new labels reads as a glitch, not a change in the data.
			animationDurationUpdate: 0,
			axisLine: { lineStyle: { color: rule } },
			axisTick: { show: false, lineStyle: { color: rule } },
			axisLabel: { color: muted, fontSize },
			nameTextStyle: { color: muted, fontSize },
			splitLine: { show: false, lineStyle: { color: rule } },
		};
		// A value's labels are as wide as its unit makes them ("60 years"): where two would overlap, one is left out.
		const values = { ...axis, axisLabel: { ...axis.axisLabel, hideOverlap: true } };
		// ECharts picks label colours itself (#333 with a white outline), which fails in dark mode: give series labels ink with a halo in the tone under the chart.
		const label = { label: { color: ink, textBorderColor: under, textBorderWidth: 2 } };
		// A treemap is plain: every tile one muted fill that ink text passes AA on, told apart by a page-toned border (so dark has no
		// light seams), no text halo, no breadcrumb or roaming, and a click that does not zoom, which has no way back without them.
		// What an author sets on the series or an item wins, as for any series.
		const tile = { color: ink, textBorderWidth: 0, fontSize };
		return {
			...Object.fromEntries(LABELLED.map((type) => [type, label])),
			line: { ...label, endLabel: label.label },
			grid: { __kitLegendRoom: true, outerBoundsMode: "same", outerBoundsContain: "axisLabel" },
			color: [1, 2, 3, 4, 5, 6].map((i) => token(`c${i}`)),
			backgroundColor: "transparent",
			animation,
			// Nothing animates on arrival (pack's drawing is already there); an update tweens from the state on show.
			animationDuration: 0,
			animationDurationUpdate: 500,
			animationEasing: "cubicOut",
			textStyle: { fontFamily: font, fontSize, color: ink },
			// The title in the text role (the page's body size, set apart by weight), its subtext as a label.
			title: {
				textStyle: { color: ink, fontSize: text(), fontWeight: 600 },
				subtextStyle: { color: muted, fontSize },
			},
			categoryAxis: axis,
			valueAxis: values,
			timeAxis: axis,
			logAxis: values,
			legend: {
				__kitLegendRoom: true,
				textStyle: { color: ink, fontSize },
				inactiveColor: ruleStrong,
				pageTextStyle: { color: muted, fontSize },
				pageIconColor: accent,
			},
			tooltip: {
				backgroundColor: surface,
				borderColor: ruleStrong,
				textStyle: { color: ink, fontSize },
				axisPointer: {
					lineStyle: { color: muted },
					crossStyle: { color: muted },
					label: { backgroundColor: ink, color: surface, fontSize },
				},
			},
			dataZoom: {
				// Quiet until touched: neutral track and handles, the accent only on hover and drag.
				borderColor: rule,
				backgroundColor: "transparent",
				fillerColor: accentSoft,
				textStyle: { color: muted, fontSize },
				handleStyle: { color: surface, borderColor: ruleStrong },
				moveHandleStyle: { color: rule },
				emphasis: { handleStyle: { borderColor: accent }, moveHandleStyle: { color: accent } },
				dataBackground: { lineStyle: { color: ruleStrong }, areaStyle: { color: rule } },
				selectedDataBackground: {
					lineStyle: { color: muted },
					areaStyle: { color: ruleStrong, opacity: 0.35 },
				},
			},
			brush: { brushStyle: { color: accentSoft, borderColor: accent } },
			toolbox: {
				iconStyle: { borderColor: muted },
				emphasis: { iconStyle: { borderColor: accent } },
			},
			visualMap: { textStyle: { color: muted, fontSize } },
			// A reference marker: a dashed ink line with no arrows, its label in ink on the halo (where: ChartsDefaults).
			markLine: {
				symbol: ["none", "none"],
				lineStyle: { color: ink, type: [3, 3], width: 1 },
				label: { ...label.label, fontWeight: 500 },
			},
			treemap: {
				label: tile,
				upperLabel: tile,
				breadcrumb: { show: false },
				roam: false,
				nodeClick: false,
				color: [token("sunken")],
				itemStyle: { borderColor: token("bg"), borderWidth: 1, gapWidth: 0 },
			},
		};
	}

	return {
		resolveOption,
		theme,
		layout,
		measureText,
		still,
		settings,
		endNames: ends.endNames,
		unnamed: ends.unnamed,
		spreadEnds: ends.spreadEnds,
		defaults: window.ChartsDefaults.defaults,
		styling: window.ChartsDefaults.styling,
		markSides: window.ChartsDefaults.place,
	};
};
