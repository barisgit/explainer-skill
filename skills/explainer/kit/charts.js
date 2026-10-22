/* charts: rich interactive charts (zoom, drill-down, heatmap, sankey, ...) with ECharts, themed from the page's CSS tokens and following light/dark. Load after kit:echarts.js.
   Charts.make(el, option, setup?)  -> { chart, set(patch) }
     el      element with a height (.chart); a hidden or zero-width element mounts when it first gets width
     option  any ECharts option; colours default to --c1..--c6, text to the page font
     setup   (chart) => void, run after every (re)mount: attach chart.on("click", ...), chart.group, echarts.connect(...)
     chart   the live instance (null until mounted)
     set(patch)            merges into the instance and into the option remounts reuse: objects merge, series/axes match by id else position
     set(patch, ["series"]) ReplaceMerge: the listed components become exactly the patch's list (same id merges, others are removed;
                           set({ series: [] }, ["series"]) clears them). Use it to remove or swap series; set(patch) alone cannot.
   Colours: write "var(--accent)", "color-mix(in srgb, var(--accent) 20%, transparent)" or Charts.color("accent") (the same var string)
     in any colour option (color, borderColor, fill, colorStops[].color, ...). They are resolved when the chart mounts, so they follow
     light/dark. Charts.color(token) is not a resolved rgb: do not use it in canvas code or alpha maths.
   Layout: write grid: { top, left, right, bottom } as padding. Axis labels stay inside it (the theme sets outerBoundsMode "same" and
     outerBoundsContain "axisLabel", ECharts 6's form of containLabel), so margins of 8 to 24 px are enough and labels never clip.
     Do not write grid.containLabel: ECharts 6 logs a warning for it on every chart; check reports it.
   The page's colour scheme changing (system setting, or color-scheme / class / style on <html>) remounts the chart: zoom and legend
   state reset. Reduced motion turns animation off. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the IIFE only scopes the kit file's names away from the page; the code in it is split into small functions
(() => {
	if (!window.echarts) {
		throw new Error('kit:charts.js needs <script src="kit:echarts.js"></script> before it');
	}
	const probe = document.createElement("i");
	probe.hidden = true;
	document.documentElement.append(probe);

	/** Resolves `var(--name)` to the colour for the current scheme (light-dark() included). */
	function color(name) {
		probe.style.color = `var(--${name})`;
		return getComputedStyle(probe).color;
	}

	// ECharts' canvas only parses rgb/hex, while computed color-mix() is color(srgb ...): such values are read back through a pixel.
	const pixel = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
	const COLOR_KEY = /(olor|^fill|^stroke)$/;
	const COLOR_EXPR = /^(var|color-mix|light-dark)\(/;

	/** Concrete rgb(a) for a CSS colour expression in the current scheme. */
	function resolve(expr) {
		probe.style.color = expr;
		const computed = getComputedStyle(probe).color;
		if (computed.startsWith("rgb")) {
			return computed;
		}
		pixel.clearRect(0, 0, 1, 1);
		pixel.fillStyle = computed;
		pixel.fillRect(0, 0, 1, 1);
		const [r, g, b, a] = pixel.getImageData(0, 0, 1, 1).data;
		return `rgba(${r}, ${g}, ${b}, ${+(a / 255).toFixed(3)})`;
	}

	/**
	 * Copy of an option with every colour expression under a colour key resolved for the current scheme. Plain objects and arrays are
	 * copied, everything else (functions, class instances, number arrays) is shared. Run at every mount so saved options stay token-based.
	 */
	function resolveColors(value, key = "") {
		if (typeof value === "string") {
			return COLOR_KEY.test(key) && COLOR_EXPR.test(value) ? resolve(value) : value;
		}
		if (Array.isArray(value)) {
			return typeof value[0] === "number" ? value : value.map((item) => resolveColors(item, key));
		}
		if (!isObject(value) || Object.getPrototypeOf(value) !== Object.prototype) {
			return value;
		}
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveColors(v, k)]));
	}

	/** ECharts theme object built from the tokens, so every component starts in the page's look. */
	function theme() {
		// Resolved to rgb: --accent-soft and other derived tokens are color-mix(), which ECharts cannot parse.
		const token = (name) => resolve(`var(--${name})`);
		const [ink, muted, rule, ruleStrong, surface, accent, accentSoft] = [
			"ink",
			"muted",
			"rule",
			"rule-strong",
			"surface",
			"accent",
			"accent-soft",
		].map(token);
		const axis = {
			axisLine: { lineStyle: { color: ruleStrong } },
			axisTick: { lineStyle: { color: ruleStrong } },
			axisLabel: { color: muted },
			nameTextStyle: { color: muted },
			splitLine: { lineStyle: { color: rule } },
		};
		// ECharts picks label colours itself (#333 with a white outline), which fails in dark mode: give series labels ink with a surface halo.
		const label = { label: { color: ink, textBorderColor: surface, textBorderWidth: 2 } };
		const labelled = Object.fromEntries(
			[
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
			].map((type) => [type, label]),
		);
		return {
			...labelled,
			grid: { outerBoundsMode: "same", outerBoundsContain: "axisLabel" },
			color: [1, 2, 3, 4, 5, 6].map((i) => token(`c${i}`)),
			backgroundColor: "transparent",
			animation: !matchMedia("(prefers-reduced-motion: reduce)").matches,
			animationDuration: 700,
			animationDurationUpdate: 500,
			animationEasing: "cubicOut",
			textStyle: { fontFamily: getComputedStyle(document.body).fontFamily, color: ink },
			title: { textStyle: { color: ink }, subtextStyle: { color: muted } },
			categoryAxis: axis,
			valueAxis: axis,
			timeAxis: axis,
			logAxis: axis,
			legend: {
				textStyle: { color: ink },
				inactiveColor: ruleStrong,
				pageTextStyle: { color: muted },
				pageIconColor: accent,
			},
			tooltip: {
				backgroundColor: surface,
				borderColor: ruleStrong,
				textStyle: { color: ink },
				axisPointer: {
					lineStyle: { color: muted },
					crossStyle: { color: muted },
					label: { backgroundColor: ink, color: surface },
				},
			},
			dataZoom: {
				// Quiet until touched: neutral track and handles, the accent only on hover and drag.
				borderColor: rule,
				backgroundColor: "transparent",
				fillerColor: accentSoft,
				textStyle: { color: muted },
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
			visualMap: { textStyle: { color: muted } },
			markLine: { lineStyle: { color: muted }, label: { color: muted } },
		};
	}

	/**
	 * Merges a patch into the saved option the way ECharts' setOption merges: objects recursively;
	 * top-level component arrays (series, xAxis, ...) element by element, matched by id, else by
	 * position; nested arrays such as data replaced. Remounts replay the saved option, so it must
	 * match what the live chart shows.
	 */
	function merge(target, patch, topLevel = false) {
		if (topLevel && Array.isArray(target) && Array.isArray(patch)) {
			patch.forEach((item, index) => {
				const at = item?.id == null ? index : target.findIndex((t) => t?.id === item.id);
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
	function mergeOption(option, patch, replace) {
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

	function isObject(value) {
		return value !== null && typeof value === "object" && !Array.isArray(value);
	}

	// Remount callbacks of the live charts. One shared check, because the scheme can change by media query or by the page itself.
	const remounts = new Set();
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

	const made = new WeakMap();

	function make(el, option, setup) {
		made.get(el)?.(); // a view handler that runs again replaces the chart instead of stacking observers
		let chart = null;
		const mount = () => {
			chart?.dispose();
			chart = echarts.init(el, theme());
			chart.setOption(resolveColors(option));
			setup?.(chart);
		};
		// Canvas text needs the web font loaded before the first draw.
		const fontReady = document.fonts
			.load(`500 12px ${getComputedStyle(document.body).fontFamily}`)
			.catch(() => []);
		const resizer = new ResizeObserver(() => {
			if (!el.clientWidth) {
				return;
			}
			if (chart) {
				chart.resize();
			} else {
				void fontReady.then(() => !chart && el.clientWidth && mount());
			}
		});
		const remount = () => chart && mount();
		resizer.observe(el);
		remounts.add(remount);
		made.set(el, () => {
			resizer.disconnect();
			remounts.delete(remount);
			chart?.dispose();
		});
		return {
			get chart() {
				return chart;
			},
			set(patch, replace = []) {
				mergeOption(option, patch, replace);
				chart?.setOption(
					resolveColors(patch),
					replace.length ? { replaceMerge: replace } : undefined,
				);
			},
		};
	}

	window.Charts = { make, color: (token) => `var(--${token})` };
})();
