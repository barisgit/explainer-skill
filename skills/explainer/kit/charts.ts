/* charts: Chart runtime; see kit Chart for the imperative API. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the IIFE only scopes the kit file's names away from the page; the code in it is split into small functions
(() => {
	// pack sends ECharts compressed: echarts is defined once window.echartsReady resolves, and a chart mounts only then.
	if (!(window.echarts || window.echartsReady)) {
		throw new Error('kit:charts.js needs <script src="kit:echarts.js"></script> before it');
	}
	const probe = document.createElement("i");
	probe.hidden = true;
	document.documentElement.append(probe);

	/** Resolves `var(--name)` to the colour for the current scheme (light-dark() included). */
	function color(name: string) {
		probe.style.color = `var(--${name})`;
		return getComputedStyle(probe).color;
	}

	// ECharts' canvas only parses rgb/hex, while computed color-mix() is color(srgb ...): such values are read back through a pixel.
	const pixel = document.createElement("canvas").getContext("2d", { willReadFrequently: true });

	/** Concrete rgb(a) for a CSS colour expression in the current scheme. */
	function resolve(expr: string) {
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
	} = window.ChartsOption({
		color: resolve,
		lang: () => document.documentElement.lang || "en",
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
			const at = places(target, patch);
			patch.forEach((item, index) => {
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

	function isObject(value: unknown): value is Record<string, unknown> {
		return value !== null && typeof value === "object" && !Array.isArray(value);
	}

	/** An item's id or name as ECharts compares them: numbers equal to their text. */
	const keyOf = (item: unknown, key: "id" | "name") =>
		isObject(item) && item[key] != null ? String(item[key]) : undefined;

	/**
	 * Where each patch item lands in the saved list, as ECharts' normal merge maps them: by id, then an id-less item by name,
	 * then an id-less item into the first place still free. An item with an id no place has is added (undefined).
	 */
	function places(target: unknown[], patch: unknown[]): (number | undefined)[] {
		const taken = new Set<number>();
		const take = (find: (saved: unknown, index: number) => boolean) => {
			const index = target.findIndex((saved, i) => !taken.has(i) && find(saved, i));
			if (index >= 0) {
				taken.add(index);
			}
			return index >= 0 ? index : undefined;
		};
		const at = patch.map((item) => {
			const id = keyOf(item, "id");
			return id === undefined ? undefined : take((saved) => keyOf(saved, "id") === id);
		});
		patch.forEach((item, index) => {
			const name = keyOf(item, "name");
			if (at[index] === undefined && keyOf(item, "id") === undefined && name !== undefined) {
				at[index] = take((saved) => keyOf(saved, "name") === name);
			}
		});
		patch.forEach((item, index) => {
			if (at[index] === undefined && keyOf(item, "id") === undefined) {
				at[index] = take(() => true);
			}
		});
		return at;
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
		const mount = () => {
			// Nothing animates on arrival: the first draw takes the place of pack's drawing, or of this chart before the scheme
			// changed, as it stands, and only the updates after it animate.
			chart?.dispose();
			const look = theme(el);
			chart = echarts.init(el, look);
			layout(chart);
			chart.setOption(resolveOption(still(option)));
			chart.setOption({ animation: Boolean(settings(option).animation ?? look.animation) });
			el.querySelector(":scope > .chart-drawn")?.remove();
			setup?.(chart);
		};
		// Canvas text needs the web font loaded before the first draw, and ECharts to exist.
		const fontReady = Promise.all([
			document.fonts.load(`500 12px ${getComputedStyle(document.body).fontFamily}`).catch(() => []),
			window.echartsReady,
		]);
		const resizer = new ResizeObserver(() => {
			if (!el.clientWidth) {
				return;
			}
			if (chart) {
				chart.resize();
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
				if (!(replace.length && chart)) {
					mergeOption(option, patch, replace);
					chart?.setOption(resolveOption(patch));
					return;
				}
				// A replaced list redraws the saved option whole (notMerge): replaceMerge would merge a new item into the old one
				// of its id, keeping what the new one leaves out, or make a new view that draws in from nothing. notMerge makes the
				// components afresh, as a mount does, and ECharts keeps the view of each id (given, else from name and position),
				// so marks tween from the state on show. What the reader toggled or zoomed is written into the option first.
				keepReaderState(option, chart);
				mergeOption(option, patch, replace);
				// An open axis tooltip retains data from series the redraw can remove.
				chart.dispatchAction({ type: "hideTip" });
				chart.setOption(resolveOption(option), { notMerge: true });
			},
		};
	}

	window.Charts = { make, color: (token) => `var(--${token})` };
})();
