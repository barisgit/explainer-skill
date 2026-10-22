/* plot: small line, stem and bar plots as SVG in the page theme, no ECharts. For zoom, drill-down, heatmaps or sankey use charts.js. Needs kit:theme.css.
   Plot.make(el, option) -> { set(patch) }
     el      element with a height (.chart); Plot fills it with a legend and an SVG drawn at its pixel size and redrawn on resize,
             so text stays 13 px from phone to desktop. Colours are CSS tokens: light and dark switch with no redraw.
     option  { series, categories, horizontal, stack, x, y, legend }
       series  [{ name, type, data, color, width, dash, label }]
         type "line"   data [[x, y], ...]; width in px (default 2), dash: true for dashed
         type "stem"   data [[x, y], ...]: a drop line from 0 with a dot, for spectra and samples
         type "bar"    data [v, ...], one per category
         color  any CSS colour, default var(--c1)..var(--c6) in turn; "var(--accent)" and color-mix(...) work
         name   shown in the legend, whose entries switch the series on and off; a series without a name toggles with the named one before it
         label  prints exact values on the marks: true, or a function: stem (x, y) => text, bar (v) => text
       categories  ["A", "B"] makes a bar plot (bars cannot mix with line or stem); horizontal: true runs them down the page,
                   stack: true piles the series (non-negative values) into one bar per category, else they sit side by side. Keep names short.
       x, y   { min, max, step, name, format }  screen axes: in a horizontal bar plot y holds the categories, x the values.
              Range and step are automatic and round; format(v) => text writes the tick labels and values (decimal comma, units).
       legend false hides the legend (by default it shows when two or more series have a name)
     set(patch)  shallow-merges the patch into the option (x and y one level deeper) and redraws at once; series is replaced whole.
   Exact values without hovering: label on stems and bars, a readout in the page for lines; each bar (zero ones too) also has a title.
   A bar label sits past the bar's end, or inside the end when the panel has no room past it. A label on a stacked segment is left out
   when it does not fit the segment: when every exact value must stay visible, add a readout or table next to the plot.
   Values outside min and max sit on the edge. A vertical marker is a two-point dashed line series. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the IIFE only scopes the kit file's names away from the page; the code in it is split into small functions
(() => {
	const FONT = 13; // px, as theme.css sets it for .plot text
	const PAD = 16;
	const TICK = 5;
	const SERIES_COLORS = [1, 2, 3, 4, 5, 6].map((i) => `var(--c${i})`);
	const measureCtx = document.createElement("canvas").getContext("2d");

	const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
	const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
	const px = (v) => +v.toFixed(1);
	const finite = ([x, y]) => Number.isFinite(x) && Number.isFinite(y);
	const svgLine = (cls, x1, x2, y1, y2, style = "") =>
		`<line class="${cls}" style="${style}" x1="${px(x1)}" x2="${px(x2)}" y1="${px(y1)}" y2="${px(y2)}"/>`;
	/** Text centred vertically on y; anchor is start, middle or end. */
	const svgText = (cls, x, y, anchor, s) =>
		`<text class="${cls}" x="${px(x)}" y="${px(y)}" dy="0.35em" text-anchor="${anchor}">${esc(s)}</text>`;
	/** The function that writes a mark's value text: `auto` for label: true, the series' own function, else none. */
	const labeller = (label, auto) => (label === true ? auto : label || undefined);
	const seriesColor = (s, i) => s.color ?? SERIES_COLORS[i % SERIES_COLORS.length];

	/** 1, 2, 5 times a power of ten giving about `count` steps over `span`. */
	function niceStep(span, count) {
		const raw = span / count;
		const p = 10 ** Math.floor(Math.log10(raw));
		const f = raw / p;
		return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
	}

	/** Numeric axis over the data extent: min and max round outwards to the step unless given. */
	function numericAxis(spec, [dataMin, dataMax], length, vertical) {
		let lo = spec.min ?? dataMin;
		let hi = spec.max ?? dataMax;
		if (!(hi > lo)) {
			lo -= 1;
			hi += 1;
		}
		const count = clamp(Math.round(length / (vertical ? 48 : 80)), 2, 10);
		const step = spec.step ?? niceStep(hi - lo, count);
		if (spec.min == null) {
			lo = Math.floor(lo / step + 1e-9) * step;
		}
		if (spec.max == null) {
			hi = Math.ceil(hi / step - 1e-9) * step;
		}
		const ticks = [];
		for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + step * 1e-9; k++) {
			ticks.push(+(k * step).toFixed(10));
		}
		const format = spec.format ?? ((v) => String(v));
		return {
			lo,
			hi,
			ticks,
			format,
			labels: ticks.map((v) => format(v)),
			name: spec.name,
			vertical,
		};
	}

	/** Category axis: one band per name, ticks at the band centres. */
	const categoryAxis = (spec, names, vertical) => ({
		names,
		ticks: names.map((_, i) => i),
		labels: names.map(String),
		name: spec.name,
		vertical,
	});

	/** Gives the axis its pixel interval [a, b] and at(value), which maps a number, or a category index to its band centre. */
	function place(axis, a, b) {
		const n = axis.names?.length;
		axis.at = n
			? (i) => a + ((i + 0.5) * (b - a)) / n
			: (v) => a + ((clamp(v, axis.lo, axis.hi) - axis.lo) / (axis.hi - axis.lo)) * (b - a);
		axis.band = n ? Math.abs(b - a) / n : 0;
	}

	/** [min, max] of one coordinate over the points of the series. */
	function extent(series, k) {
		const values = series.flatMap((s) => (s.data ?? []).filter(finite).map((p) => p[k]));
		return values.length ? [Math.min(...values), Math.max(...values)] : [0, 1];
	}

	function lineMark(s, i, { X, Y }) {
		const pts = s.data.filter(finite).map(([x, y]) => `${px(X(x))},${px(Y(y))}`);
		if (!pts.length) {
			return "";
		}
		const style = `--c:${seriesColor(s, i)};--w:${s.width ?? 2}`;
		return `<path class="line${s.dash ? " dash" : ""}" style="${style}" d="M${pts.join("L")}"/>`;
	}

	function stemMark(s, i, { X, Y, ya, W, textWidth }) {
		const base = Y(clamp(0, ya.lo, ya.hi));
		const style = `--c:${seriesColor(s, i)};--w:${s.width ?? 2.5}`;
		const format = labeller(s.label, (_, y) => ya.format(y));
		return s.data
			.filter(finite)
			.map(([x, y]) => {
				const cx = X(x);
				const cy = Y(y);
				const t = format?.(x, y);
				const dot = `<circle class="dot" style="${style}" cx="${px(cx)}" cy="${px(cy)}" r="4.5"/>`;
				const half = t ? textWidth(t) / 2 : 0;
				const ty = cy <= base ? Math.max(cy - 14, FONT) : cy + 14;
				const text = t ? svgText("value", clamp(cx, half + 4, W - half - 4), ty, "middle", t) : "";
				return svgLine("stem", cx, cx, base, cy, style) + dot + text;
			})
			.join("");
	}

	/** Layout shared by the bars of a plot: which axis holds the categories, the bar thickness, running stack ends. */
	function barLayout(series, option, { xa, ya, W, L, B }) {
		const horizontal = Boolean(option.horizontal);
		const cat = horizontal ? ya : xa;
		const thick = Math.min(cat.band * 0.62, 56);
		const each = option.stack ? thick : thick / series.length;
		return {
			horizontal,
			cat,
			val: horizontal ? xa : ya,
			thick,
			each,
			stacked: cat.names.map(() => 0),
			// Where a label past a bar's end may still go: the panel's right edge, the plot's left edge, the top edge, the axis.
			bounds: horizontal ? [L, W - 4] : [B, 0], // [for a negative value, for a positive one]
			grow: horizontal ? 1 : -1, // screen direction of a positive value
		};
	}

	/** Label of a stacked segment: centred when it fits, else none. */
	function segmentLabel(t, { horizontal, start, length, mid, each }, textWidth) {
		const tw = textWidth(t);
		const fits = horizontal
			? length >= tw + 10 && each >= FONT + 2
			: length >= FONT + 6 && each >= tw + 6;
		const centre = start + length / 2;
		return fits
			? svgText("value inside", horizontal ? centre : mid, horizontal ? mid : centre, "middle", t)
			: "";
	}

	/** Label of a side-by-side bar: past its end (`dir` is the screen direction it grows), or inside the end when the panel has no room past it. */
	function endLabel(t, { horizontal, length, end, mid, dir, bound }, textWidth) {
		const reach = horizontal ? textWidth(t) + 6 : FONT + 4;
		const fitsInside = length >= reach + 6;
		const inside = dir * (bound - end) < reach && fitsInside;
		const at = inside ? -dir : dir;
		const cls = inside ? "value inside" : "value";
		return horizontal
			? svgText(cls, end + at * 6, mid, at > 0 ? "start" : "end", t)
			: svgText(cls, mid, end + at * (FONT / 2 + 4), "middle", t);
	}

	/** A value label: inside a stacked segment when it fits, else at the end of a side-by-side bar. */
	const barLabel = (t, bar, stack, textWidth) =>
		stack ? segmentLabel(t, bar, textWidth) : endLabel(t, bar, textWidth);

	/** The rect (with its title) of bar series j, category i, and the geometry its label needs. */
	function barRect(s, j, i, v, layout, option) {
		const { horizontal, cat, val, thick, each, stacked, bounds, grow } = layout;
		const from = option.stack ? stacked[i] : 0;
		stacked[i] = from + v;
		const a = val.at(from);
		const b = val.at(from + v);
		const start = Math.min(a, b);
		const length = Math.abs(b - a);
		const offset = cat.at(i) - thick / 2 + (option.stack ? 0 : j * each);
		const [x, y, w, h] = horizontal ? [start, offset, length, each] : [offset, start, each, length];
		const title = `<title>${esc(`${cat.names[i]}${s.name ? ` · ${s.name}` : ""}: ${val.format(v)}`)}</title>`;
		return {
			rect: `<rect class="bar" style="--c:${seriesColor(s, j)}" x="${px(x)}" y="${px(y)}" width="${px(w)}" height="${px(h)}">${title}</rect>`,
			bar: {
				horizontal,
				start,
				length,
				end: b,
				mid: offset + each / 2,
				each,
				dir: v >= 0 ? grow : -grow,
				bound: bounds[+(v >= 0)],
			},
			format: labeller(s.label, val.format),
		};
	}

	/** One bar with its title and, when the series asks for labels, its value label. */
	function barMark(s, j, i, v, layout, option, textWidth) {
		const { rect, bar, format } = barRect(s, j, i, v, layout, option);
		const t = format?.(v);
		return t ? rect + barLabel(t, bar, option.stack, textWidth) : rect;
	}

	/** Bars of every series switched on, stacked or side by side. */
	function barMarks(series, option, ctx) {
		const layout = barLayout(series, option, ctx);
		return series
			.map((s, j) =>
				ctx.shown[j]
					? s.data
							.map((v, i) =>
								Number.isFinite(v) ? barMark(s, j, i, v, layout, option, ctx.textWidth) : "",
							)
							.join("")
					: "",
			)
			.join("");
	}

	/** Every nth tick label, so that neighbours do not touch. */
	function labelEvery(axis, textWidth) {
		if (axis.ticks.length < 2) {
			return 1;
		}
		const gap = Math.abs(axis.at(axis.ticks[1]) - axis.at(axis.ticks[0]));
		const size = axis.vertical ? FONT + 6 : Math.max(...axis.labels.map(textWidth)) + 12;
		return Math.ceil(size / gap);
	}

	/** Gridline, tick mark and label (null when thinned out) of one tick; category axes have labels only. */
	function tickMarks(axis, t, i, every, { L, R, T, B }) {
		const p = axis.at(t);
		const grid = t === 0 && axis.lo < 0 ? "zero" : "grid";
		const text = i % every === 0 ? axis.labels[i] : null;
		const v = axis.vertical;
		const marks = axis.names
			? ""
			: v
				? svgLine(grid, L, R, p, p) + svgLine("axis", L - TICK, L, p, p)
				: svgLine(grid, p, p, T, B) + svgLine("axis", p, p, B, B + TICK);
		const at = v ? [L - TICK - 4, p, "end"] : [p, B + TICK + 3 + FONT / 2, "middle"];
		return marks + (text === null ? "" : svgText("", ...at, text));
	}

	/** Gridlines, axis lines, ticks, tick labels and axis names. */
	function drawAxes(ctx) {
		const { xa, ya, L, R, T, B, H, textWidth } = ctx;
		let out = "";
		for (const axis of [xa, ya]) {
			const every = labelEvery(axis, textWidth);
			out += axis.ticks.map((t, i) => tickMarks(axis, t, i, every, ctx)).join("");
		}
		out += svgLine("axis", L, R, B, B) + svgLine("axis", L, L, T, B);
		out += xa.name ? svgText("name", R, H - FONT / 2 - 2, "end", xa.name) : "";
		out += ya.name ? svgText("name", PAD, FONT / 2 + 3, "start", ya.name) : "";
		return out;
	}

	/** Axes of a bar plot: the categories on one, the value range of all bars on the other. */
	function barAxes(option, W, H) {
		const series = option.series ?? [];
		const cols = option.categories.map((_, i) => series.map((s) => s.data[i] || 0));
		const tops = cols.map((c) => (option.stack ? c.reduce((a, b) => a + b, 0) : Math.max(...c)));
		const span = [Math.min(0, ...cols.flat()), Math.max(0, ...tops)];
		const x = option.x ?? {};
		const y = option.y ?? {};
		return option.horizontal
			? { xa: numericAxis(x, span, W, false), ya: categoryAxis(y, option.categories, true) }
			: { xa: categoryAxis(x, option.categories, false), ya: numericAxis(y, span, H, true) };
	}

	/** Axes of a line and stem plot, over the extent of the data. */
	function plotAxes(option, W, H) {
		const series = option.series ?? [];
		const [yMin, yMax] = extent(series, 1);
		const [xMin, xMax] = extent(series, 0);
		// Stems reach 0, and keep a dot and label inside the axes at either end.
		const room = series.some((s) => s.type === "stem") ? 0.06 : 0;
		const dx = (xMax - xMin) * room;
		const dy = (yMax - yMin) * room;
		const yRange = room ? [yMin < 0 ? yMin - dy : 0, yMax > 0 ? yMax + dy : 0] : [yMin, yMax];
		return {
			xa: numericAxis(option.x ?? {}, [xMin - dx, xMax + dx], W, false),
			ya: numericAxis(option.y ?? {}, yRange, H, true),
		};
	}

	/** The plot rectangle inside W x H: room left for the value labels and axis names, right and left for half a label. */
	function plotBox(xa, ya, W, H, textWidth) {
		const yLabelWidth = Math.max(0, ...ya.labels.map(textWidth));
		const firstHalf = textWidth(xa.labels[0] ?? "") / 2;
		const lastHalf = textWidth(xa.labels.at(-1) ?? "") / 2;
		return {
			L: Math.ceil(Math.max(PAD + yLabelWidth + TICK + 4, firstHalf + 4)),
			R: Math.floor(W - Math.max(PAD, lastHalf + 4)),
			T: ya.name ? FONT + 15 : 10,
			B: Math.floor(H - TICK - FONT - 8 - (xa.name ? 22 : 0)),
		};
	}

	/** SVG markup for the option at W x H pixels; `shown[i]` says whether series i is switched on in the legend. */
	function render(option, W, H, family, shown) {
		measureCtx.font = `500 ${FONT}px ${family}`;
		const textWidth = (s) => measureCtx.measureText(String(s)).width;
		const series = option.series ?? [];
		const { xa, ya } = option.categories ? barAxes(option, W, H) : plotAxes(option, W, H);
		const box = plotBox(xa, ya, W, H, textWidth);
		const { L, R, T, B } = box;
		if (R - L < 40 || B - T < 40) {
			return "";
		}
		place(xa, L, R);
		place(ya, ya.names ? T : B, ya.names ? B : T);
		const ctx = { xa, ya, ...box, W, H, textWidth, shown, X: xa.at, Y: ya.at };

		const marks = option.categories
			? barMarks(series, option, ctx)
			: series
					.map((s, i) => (shown[i] ? (s.type === "stem" ? stemMark : lineMark)(s, i, ctx) : ""))
					.join("");
		return drawAxes(ctx) + marks;
	}

	/** Legend buttons for the named series, or "" when the legend is off or has fewer than two entries. */
	function legendMarkup(option) {
		const named = (option.series ?? []).map((s, i) => [s, i]).filter(([s]) => s.name);
		if (option.legend === false || named.length < 2) {
			return "";
		}
		return named
			.map(([s, i]) => {
				const swatch = `<i class="${s.type ?? "line"}${s.dash ? " dash" : ""}" style="--c:${seriesColor(s, i)}"></i>`;
				return `<li><button type="button" data-i="${i}">${swatch}${esc(s.name)}</button></li>`;
			})
			.join("");
	}

	/** Per series: whether it is switched on. An unnamed series belongs to the named one before it. */
	function switchedOn(series, off) {
		let owner;
		return series.map((s) => {
			owner = s.name ?? owner;
			return !off.has(owner);
		});
	}

	const made = new WeakMap();

	function make(el, initial) {
		made.get(el)?.(); // a view handler that runs again replaces the plot instead of stacking observers
		let option = initial;
		el.classList.add("plot");
		el.innerHTML = '<ul class="plot-legend"></ul><div class="plot-area"><svg></svg></div>';
		const legend = el.firstElementChild;
		const area = legend.nextElementSibling;
		const svg = area.firstElementChild;
		let legendHtml = "";
		const off = new Set(); // names of the series the reader switched off in the legend

		function draw() {
			const series = option.series ?? [];
			const html = legendMarkup(option);
			if (html !== legendHtml) {
				legend.innerHTML = legendHtml = html;
			}
			for (const button of legend.querySelectorAll("button")) {
				button.setAttribute("aria-pressed", String(!off.has(series[button.dataset.i].name)));
			}
			const W = area.clientWidth;
			const H = area.clientHeight;
			if (!W || !H) {
				return; // hidden: drawn when it first gets a size
			}
			svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
			const family = getComputedStyle(el).fontFamily;
			svg.innerHTML = render(option, W, H, family, switchedOn(series, off));
		}

		legend.addEventListener("click", (event) => {
			const button = event.target.closest("button");
			if (button) {
				const { name } = option.series[button.dataset.i];
				if (!off.delete(name)) {
					off.add(name);
				}
				draw();
			}
		});
		const resizer = new ResizeObserver(draw);
		resizer.observe(area);
		void document.fonts.load(`500 ${FONT}px ${getComputedStyle(el).fontFamily}`).then(draw, draw);
		made.set(el, () => resizer.disconnect());
		draw();
		return {
			set(patch) {
				option = {
					...option,
					...patch,
					x: { ...option.x, ...patch.x },
					y: { ...option.y, ...patch.y },
				};
				draw();
			},
		};
	}

	window.Plot = { make };
})();
