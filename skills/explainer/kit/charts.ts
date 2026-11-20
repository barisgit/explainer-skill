/* charts: Chart runtime; see kit Chart for the imperative API. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the IIFE only scopes the kit file's names away from the page; the code in it is split into small functions
(() => {
	// pack sends ECharts compressed: echarts is defined once window.echartsReady resolves, and a chart mounts only then.
	if (!(window.echarts || window.echartsReady)) {
		throw new Error('kit:charts.js needs <script src="kit:echarts.js"></script> before it');
	}
	const probe = document.createElement("i");
	probe.hidden = true;

	// The chart whose text and colours are being resolved: its element inherits the label and text sizes, which a band or page may set.
	let sizing: HTMLElement = document.documentElement;
	/** px: a size token (--size-label, --size-text) as `el` inherits it, read from a probe placed in it for the moment. */
	function tokenSize(token: string, el: HTMLElement = sizing) {
		const sizer = document.createElement("i");
		sizer.hidden = true;
		sizer.style.fontSize = `var(${token})`;
		el.append(sizer);
		const px = parseFloat(getComputedStyle(sizer).fontSize);
		sizer.remove();
		return px;
	}
	const labelSize = (el?: HTMLElement) => tokenSize("--size-label", el);

	/**
	 * Puts the colour probe in the chart being drawn (`sizing`), so a token a block sets for itself, such as its own --accent,
	 * resolves as it does there, as pack's drawing does.
	 */
	function placeProbe() {
		const host = sizing.isConnected ? sizing : document.documentElement;
		if (probe.parentElement !== host) {
			host.append(probe);
		}
	}

	/** Resolves `var(--name)` on the page's root, for the current scheme (light-dark() included): what the scheme check reads. */
	function color(name: string) {
		document.documentElement.append(probe);
		probe.style.color = `var(--${name})`;
		return getComputedStyle(probe).color;
	}

	// ECharts' canvas only parses rgb/hex, while computed color-mix() is color(srgb ...): such values are read back through a pixel.
	const pixel = document.createElement("canvas").getContext("2d", { willReadFrequently: true });

	/** Concrete rgb(a) for a CSS colour expression in the current scheme. */
	function resolve(expr: string) {
		placeProbe();
		probe.style.color = expr;
		const computed = getComputedStyle(probe).color;
		if (computed.startsWith("rgb") || !pixel) {
			return computed;
		}
		pixel.clearRect(0, 0, 1, 1);
		pixel.fillStyle = computed;
		pixel.fillRect(0, 0, 1, 1);
		const [r = 0, g = 0, b = 0, a = 0] = pixel.getImageData(0, 0, 1, 1).data;
		return `rgba(${r}, ${g}, ${b}, ${+(a / 255).toFixed(3)})`;
	}

	const {
		resolveOption,
		theme: tokenTheme,
		layout,
		measureText,
		still,
		settings,
		endNames,
		crowded,
		defaults,
		styling,
		markSides,
	} = window.ChartsOption({
		color: resolve,
		lang: () => document.documentElement.lang || "en",
		size: () => labelSize(),
		text: () => tokenSize("--size-text"),
	});

	// Install before consumers await ECharts: zrender caches its font metrics globally on first use.
	window.echartsReady = Promise.resolve(window.echartsReady).then(() => {
		if (pixel) {
			echarts.setPlatformAPI({
				measureText: measureText((text, font) => {
					pixel.font = font ?? "12px sans-serif";
					return pixel.measureText(text);
				}),
			});
		}
	});

	/**
	 * The option with its lines' names at their ends, and with a legend in their place, when the kit names them so; see endNames.
	 * Names are measured at the label size of the chart being drawn (`sizing`).
	 */
	const ends = (option: ChartOption) =>
		endNames(option, (text) => {
			if (!pixel) {
				return 0;
			}
			pixel.font = `${labelSize()}px ${getComputedStyle(document.body).fontFamily}`;
			return pixel.measureText(text).width;
		});

	/**
	 * Draws the saved option on the chart (`prepare` resolves it for setOption) with the kit's defaults, its marker labels on
	 * the side with room (drawn again once the axes say where that is), and its names at the line ends unless they crowd at the
	 * chart's size, when the legend names them, with the series the reader hid in it (`selected`) still hidden; pack draws each
	 * copy by the same rule (src/mdx/draw.ts). Returns whether that legend shows.
	 */
	function show(
		chart: ECharts,
		option: ChartOption,
		prepare: (option: ChartOption) => ChartOption,
		selected: unknown,
		how?: { notMerge: true },
	) {
		const draw = (sides?: ReturnType<typeof markSides>) => {
			const kept = defaults(option, sides);
			const named = ends(kept);
			chart.setOption(prepare(named ? named.named : kept), how);
			return named;
		};
		let both = draw();
		const sides = markSides(chart);
		if (sides.size) {
			both = draw(sides);
		}
		if (!(both && crowded(chart))) {
			return false;
		}
		const legend = { ...both.legend, legend: selected ? { selected } : {} };
		chart.setOption(prepare(legend), { notMerge: true });
		return true;
	}

	/** The ECharts theme for a chart on `el`, whose --under (the tone under it) changes by block: page, band, popover. */
	const theme = (el: HTMLElement) =>
		tokenTheme({
			under: resolve(getComputedStyle(el).getPropertyValue("--under")),
			font: getComputedStyle(document.body).fontFamily,
			animation: !matchMedia("(prefers-reduced-motion: reduce)").matches,
		});

	/**
	 * Merges a patch into the saved option the way ECharts' setOption merges: objects recursively;
	 * top-level component arrays (series, xAxis, ...) element by element (see places); nested arrays
	 * such as data replaced. Redraws and remounts replay the saved option, so it must match what the
	 * live chart shows.
	 */
	function merge(target: unknown, patch: unknown, topLevel = false): unknown {
		if (topLevel && Array.isArray(target) && Array.isArray(patch)) {
			const at = window.ChartsDefaults.places(target, patch);
			patch.forEach((item, index) => {
				if (item == null) {
					return;
				}
				const place = at[index];
				if (place === undefined) {
					target.push(item);
				} else {
					target[place] = merge(target[place], item);
				}
			});
			return target;
		}
		if (!isObject(target) || !isObject(patch)) {
			return patch;
		}
		for (const [key, value] of Object.entries(patch)) {
			target[key] = key in target ? merge(target[key], value) : value;
		}
		return target;
	}

	/** Applies a top-level option patch to the saved option; see merge. Components named in `replace` are swapped for the patch's list. */
	function mergeOption(option: ChartOption, patch: ChartOption, replace: string[]) {
		if (isObject(option.baseOption)) {
			mergeBase(option, patch, replace);
			return;
		}
		for (const key of replace) {
			if (!(key in patch)) {
				delete option[key];
			}
		}
		for (const [key, value] of Object.entries(patch)) {
			option[key] =
				key in option && !replace.includes(key)
					? merge(option[key], value, Array.isArray(value))
					: value;
		}
	}

	/** Fold root patches into an existing baseOption as ECharts does, so a replay draws the same data as an update. */
	function mergeBase(option: ChartOption, patch: ChartOption, replace: string[]) {
		const { baseOption, media, options, ...root } = patch;
		mergeOption(
			settings(option),
			{ ...root, ...(isObject(baseOption) ? baseOption : {}) },
			replace,
		);
		if (media !== undefined) {
			option.media = media;
		}
		if (options !== undefined) {
			option.options = options;
		}
	}

	function isObject(value: unknown): value is Record<string, unknown> {
		return value !== null && typeof value === "object" && !Array.isArray(value);
	}

	/** A copy of the objects and arrays merge changes in place, including a baseOption's component lists. */
	const copyObjects = (value: unknown): unknown =>
		Array.isArray(value)
			? value.map(copyObjects)
			: isObject(value)
				? Object.fromEntries(Object.entries(value).map(([key, v]) => [key, copyObjects(v)]))
				: value;

	/** The saved option as mergeOption would leave it, without changing it. */
	function merged(option: ChartOption, patch: ChartOption, replace: string[]) {
		const copy: ChartOption = Object.fromEntries(
			Object.entries(option).map(([key, v]) => [key, copyObjects(v)]),
		);
		mergeOption(copy, patch, replace);
		return copy;
	}

	/** The live model of a component; ECharts declares no public type for it. */
	type LiveModel = { getRangePropMode?(): unknown } | undefined;
	const modelOf = (chart: ECharts, mainType: string, index: number): LiveModel =>
		(chart as unknown as { getModel(): { getComponent(type: string, i: number): LiveModel } })
			.getModel()
			.getComponent(mainType, index);

	/**
	 * What the reader set on a live component that the saved option does not hold, by main type. A zoom window keeps the range
	 * mode in effect (an untouched startValue/endValue stays in values; a reader's zoom is in percent), and a continuous
	 * visualMap's range only once it is narrower than min to max, so an untouched one follows a new extent.
	 */
	const READER_STATE: Record<
		string,
		(shown: Record<string, unknown>, model: LiveModel) => ChartOption
	> = {
		legend: ({ selected, scrollDataIndex }) => ({ selected, scrollDataIndex }),
		dataZoom: ({ start, end, startValue, endValue }, model) => ({
			rangeMode: model?.getRangePropMode?.(),
			start,
			end,
			startValue,
			endValue,
		}),
		visualMap: ({ range, min, max }) =>
			Array.isArray(range) && (range[0] !== min || range[1] !== max) ? { range } : {},
	};

	/**
	 * Writes what the reader set on the live chart into the saved option, component by position, so a redraw of the saved option
	 * keeps it; the patch merged after it wins. Only components the saved option declares (in its baseOption when it has one)
	 * take it.
	 */
	function keepReaderState(option: ChartOption, chart: ECharts) {
		const live: ChartOption = chart.getOption();
		const target = settings(option);
		for (const [key, read] of Object.entries(READER_STATE)) {
			const shown = live[key];
			const saved = target[key];
			if (!(Array.isArray(shown) && (Array.isArray(saved) || isObject(saved)))) {
				continue;
			}
			const states = shown.map((item: unknown, index) =>
				isObject(item)
					? Object.fromEntries(
							Object.entries(read(item, modelOf(chart, key, index))).filter(
								([, v]) => v !== undefined,
							),
						)
					: {},
			);
			target[key] = Array.isArray(saved)
				? saved.map((item, index) => merge(item, states[index] ?? {}))
				: merge(saved, states[0] ?? {});
		}
	}

	// Remount callbacks of the live charts. One shared check, because the scheme can change by media query or by the page itself.
	const remounts = new Set<() => void>();
	let scheme = color("ink");
	const checkScheme = () => {
		const now = color("ink");
		if (now === scheme) {
			return;
		}
		scheme = now;
		for (const remount of remounts) {
			remount();
		}
	};
	matchMedia("(prefers-color-scheme: dark)").addEventListener("change", checkScheme);
	for (const el of [document.documentElement, document.body]) {
		if (el) {
			new MutationObserver(checkScheme).observe(el, { attributes: true });
		}
	}

	const made = new WeakMap<HTMLElement, () => void>();

	function make(
		el: HTMLElement,
		option: ChartOption,
		setup?: (chart: ECharts) => void,
	): ChartHandle {
		made.get(el)?.(); // a view handler that runs again replaces the chart instead of stacking observers
		let chart: ECharts | null = null;
		// False once disposed: a font load still pending must not mount it again.
		let live = true;
		// The height names at the line ends were last fitted at: they crowd or not by the plot's height alone.
		let drawnHeight = 0;
		// Whether the legend that stands in for crowded names shows, and which series the reader switched in it: the saved option
		// has no legend to keep them in. With no legend, nothing could switch a series back on, so they are forgotten.
		let standIn = false;
		let selected: unknown;
		const keepStandIn = (on: ECharts) => {
			const [shown] = standIn
				? ((on.getOption() as { legend?: { selected?: unknown }[] }).legend ?? [])
				: [];
			selected = shown?.selected;
		};
		const mount = () => {
			// Nothing animates on arrival: the first draw takes the place of pack's drawing, or of this chart before the scheme
			// changed, as it stands, and only the updates after it animate.
			if (chart) {
				keepStandIn(chart);
				chart.dispose();
			}
			sizing = el;
			const look = theme(el);
			chart = echarts.init(el, look);
			layout(chart);
			standIn = show(chart, option, (o) => resolveOption(still(o)), selected);
			drawnHeight = el.clientHeight;
			chart.setOption({ animation: Boolean(settings(option).animation ?? look.animation) });
			el.querySelector(":scope > .chart-drawn")?.remove();
			setup?.(chart);
		};
		/**
		 * Draws the saved option afresh (notMerge), after writing what the reader toggled or zoomed into it: notMerge makes the
		 * components anew, as a mount does, and ECharts keeps the view of each id (given, else from name and position), so marks
		 * tween from the state on show.
		 */
		const redraw = (on: ECharts, patch?: () => void) => {
			keepReaderState(option, on);
			keepStandIn(on);
			patch?.();
			// An open axis tooltip retains data from series the redraw can remove.
			on.dispatchAction({ type: "hideTip" });
			sizing = el;
			standIn = show(on, option, resolveOption, selected, { notMerge: true });
			drawnHeight = el.clientHeight;
		};
		// Canvas text needs the web font loaded before the first draw, and ECharts to exist.
		const fontReady = Promise.all([
			document.fonts
				.load(`500 ${labelSize(el)}px ${getComputedStyle(document.body).fontFamily}`)
				.catch(() => []),
			window.echartsReady,
		]);
		const resizer = new ResizeObserver(() => {
			if (!el.clientWidth) {
				return;
			}
			if (chart) {
				chart.resize();
				sizing = el;
				if (el.clientHeight !== drawnHeight && ends(option)) {
					redraw(chart);
				}
			} else {
				void fontReady.then(() => live && !chart && el.clientWidth && mount());
			}
		});
		const remount = () => chart && mount();
		resizer.observe(el);
		remounts.add(remount);
		const dispose = () => {
			live = false;
			resizer.disconnect();
			remounts.delete(remount);
			chart?.dispose();
			chart = null;
			if (made.get(el) === dispose) {
				made.delete(el);
			}
		};
		made.set(el, dispose);
		return {
			dispose,
			get chart() {
				return chart;
			},
			set(patch, replace = []) {
				// A replaced list redraws the saved option whole: replaceMerge would merge a new item into the old one of its id,
				// keeping what the new one leaves out, or make a new view that draws in from nothing. So do names at the line ends
				// before or after the patch, which a merge can neither take away nor decide by the chart's size, and so does a change
				// to what the kit generates (a dash a colour drops, a line added, a marker), which a merge would keep or miss.
				sizing = el;
				const next = merged(option, patch, replace);
				if (
					chart &&
					(replace.length || ends(option) || ends(next) || styling(option) !== styling(next))
				) {
					redraw(chart, () => mergeOption(option, patch, replace));
					return;
				}
				mergeOption(option, patch, replace);
				chart?.setOption(resolveOption(defaults(patch, undefined, option)));
			},
		};
	}

	window.Charts = { make, color: (token) => `var(--${token})` };
})();
