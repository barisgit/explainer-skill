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
		measureText,
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

	/** The ECharts theme for a chart on `el`, whose --under (the tone under it) changes by block: page, panel, band. */
	const theme = (el: HTMLElement) =>
		tokenTheme({
			under: resolve(getComputedStyle(el).getPropertyValue("--under")),
			font: getComputedStyle(document.body).fontFamily,
			animation: !matchMedia("(prefers-reduced-motion: reduce)").matches,
		});

	/**
	 * Merges a patch into the saved option the way ECharts' setOption merges: objects recursively;
	 * top-level component arrays (series, xAxis, ...) element by element, matched by id, else by
	 * position; nested arrays such as data replaced. Remounts replay the saved option, so it must
	 * match what the live chart shows.
	 */
	function merge(target: unknown, patch: unknown, topLevel = false): unknown {
		if (topLevel && Array.isArray(target) && Array.isArray(patch)) {
			patch.forEach((item, index) => {
				const id = idOf(item);
				const at = id == null ? index : target.findIndex((t) => idOf(t) === id);
				if (at < 0 || at >= target.length) {
					target.push(item);
				} else {
					target[at] = merge(target[at], item);
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

	const idOf = (item: unknown) => (isObject(item) ? item.id : undefined);

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
			// A chart on show (pack's drawing, or this one before the scheme changed) is replaced as it stands, not drawn in again.
			const drawn = el.querySelector(":scope > .chart-drawn");
			const shown = Boolean(chart || drawn);
			chart?.dispose();
			const look = theme(el);
			chart = echarts.init(el, look);
			chart.setOption(resolveOption(shown ? { ...option, animation: false } : option));
			if (shown) {
				chart.setOption({
					animation: Boolean("animation" in option ? option.animation : look.animation),
				});
			}
			drawn?.remove();
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
				mergeOption(option, patch, replace);
				// An open axis tooltip retains data from series replaceMerge can remove.
				if (replace.length) {
					chart?.dispatchAction({ type: "hideTip" });
				}
				chart?.setOption(
					resolveOption(patch),
					replace.length ? { replaceMerge: replace } : undefined,
				);
			},
		};
	}

	window.Charts = { make, color: (token) => `var(--${token})` };
})();
