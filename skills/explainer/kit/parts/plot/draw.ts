/* plot draw: what kit:plot.js draws, not referenced from pages: pack joins it in front of plot.js, and runs it itself to draw each
   plot into the page (src/mdx/draw.ts). PlotDraw({ lang }) gives render(option, W, H, textWidth, shown), the SVG content,
   legendMarkup(option), the legend's buttons, and switchedOn(series, off), which series the legend leaves on; numbers are
   written in lang(), and textWidth measures a label at the plot's 13 px. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the function only scopes the part's names away from the page; the code in it is split into small functions
window.PlotDraw = ({ lang }) => {
	const FONT = 13; // px, as theme.css sets it for .plot text
	const PAD = 16;
	const TICK = 5;

	type TextWidth = (s: unknown) => number;
	/** What every axis has; a numeric axis also has its range, a category axis its names. at() and band are set by place(). */
	interface AxisBase {
		ticks: number[];
		labels: string[];
		name: string | undefined;
		vertical: boolean;
		at: (v: number) => number;
		band: number;
	}
	interface NumericAxis extends AxisBase {
		lo: number;
		hi: number;
		format: (v: number) => string;
		names?: undefined;
	}
	interface CategoryAxis extends AxisBase {
		names: string[];
	}
	type Axis = NumericAxis | CategoryAxis;
	/** The plot rectangle and the measuring shared by everything drawn. */
	interface Frame {
		W: number;
		H: number;
		L: number;
		R: number;
		T: number;
		B: number;
		textWidth: TextWidth;
	}
	interface Ctx extends Frame {
		xa: Axis;
		ya: Axis;
		shown: boolean[];
	}
	interface PointCtx extends Ctx {
		xa: NumericAxis;
		ya: NumericAxis;
		X: (v: number) => number;
		Y: (v: number) => number;
	}
	interface BarCtx extends Ctx {
		cat: CategoryAxis;
		val: NumericAxis;
	}
	/** What a bar's label needs: where the bar lies on the screen. */
	interface BarGeometry {
		horizontal: boolean;
		start: number;
		length: number;
		end: number;
		mid: number;
		each: number;
		dir: number;
		bound: number;
	}
	type Anchor = "start" | "middle" | "end";

	const unplaced = { at: (v: number) => v, band: 0 };
	const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
	const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
	const px = (v: number) => +v.toFixed(1);
	const finite = (p: number | PlotPoint): p is PlotPoint =>
		typeof p !== "number" && Number.isFinite(p[0]) && Number.isFinite(p[1]);
	/** ` name="value"`, or nothing for an empty value. */
	const attr = (name: string, value: string) => (value ? ` ${name}="${value}"` : "");
	const svgLine = (cls: string, x1: number, x2: number, y1: number, y2: number, style = "") =>
		`<line class="${cls}"${attr("style", style)} x1="${px(x1)}" x2="${px(x2)}" y1="${px(y1)}" y2="${px(y2)}"/>`;
	/** Text centred vertically on y. */
	const svgText = (cls: string, x: number, y: number, anchor: Anchor, s: unknown) =>
		`<text${attr("class", cls)} x="${px(x)}" y="${px(y)}" dy="0.35em" text-anchor="${anchor}">${esc(s)}</text>`;
	/** The Intl options of a JSON number format (NumberFormat in kit-types/globals.d.ts). */
	const intlOptions = ({
		digits,
		percent,
		currency,
		compact,
	}: NumberFormat): Intl.NumberFormatOptions => ({
		style: percent ? "percent" : currency ? "currency" : "decimal",
		useGrouping: "min2", // 12 345, but a year stays 2024
		...(currency ? { currency } : {}),
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
	/** Without a format, numbers are written in full, as String writes them, with the page's decimal mark, minus and grouping. */
	function inFull() {
		const intl = new Intl.NumberFormat(lang(), {
			useGrouping: "min2",
			maximumFractionDigits: 20,
		});
		return (v: number) => intl.format(v);
	}
	const formatter = (format: AxisSpec["format"]): ((v: number) => string) =>
		typeof format === "function" ? format : format ? numberText(format) : inFull();
	/** A mark's value text from its value, its index in the series and, for a stem, its x. */
	type Labeller = (value: number, i: number, x: number) => string;
	/** The series' label as a Labeller (`format` writes the value for label: true), or none when it asks for no labels. */
	function labeller(label: PlotSeries["label"], format: (v: number) => string, stem: boolean) {
		if (!label) {
			return undefined;
		}
		if (typeof label === "function") {
			return stem
				? (v: number, i: number, x: number) => label(x, v, i)
				: (v: number, i: number) => label(v, i);
		}
		if (isTexts(label)) {
			return (_: number, i: number) => label[i] ?? "";
		}
		return label === true ? format : numberText(label);
	}
	const isTexts = (label: PlotSeries["label"]): label is readonly string[] => Array.isArray(label);
	const seriesColor = (s: PlotSeries, i: number) => s.color ?? `var(--c${(i % 6) + 1})`;

	/** 1, 2, 5 times a power of ten giving about `count` steps over `span`. */
	function niceStep(span: number, count: number) {
		const raw = span / count;
		const p = 10 ** Math.floor(Math.log10(raw));
		const f = raw / p;
		return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
	}

	/** Numeric axis over the data extent: min and max round outwards to the step unless given. */
	function numericAxis(
		spec: AxisSpec,
		[dataMin, dataMax]: readonly [number, number],
		length: number,
		vertical: boolean,
	): NumericAxis {
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
		const ticks: number[] = [];
		for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + step * 1e-9; k++) {
			ticks.push(+(k * step).toFixed(10));
		}
		const format = formatter(spec.format);
		return {
			lo,
			hi,
			ticks,
			format,
			labels: ticks.map((v) => format(v)),
			name: spec.name,
			vertical,
			...unplaced,
		};
	}

	/** Category axis: one band per name, ticks at the band centres. */
	const categoryAxis = (spec: AxisSpec, names: string[], vertical: boolean): CategoryAxis => ({
		names,
		ticks: names.map((_, i) => i),
		labels: names.map(String),
		name: spec.name,
		vertical,
		...unplaced,
	});

	/** Gives the axis its pixel interval [a, b] and at(value), which maps a number, or a category index to its band centre. */
	function place(axis: Axis, a: number, b: number) {
		if (axis.names) {
			const n = axis.names.length;
			axis.at = (i) => a + ((i + 0.5) * (b - a)) / n;
			axis.band = Math.abs(b - a) / n;
		} else {
			const { lo, hi } = axis;
			axis.at = (v) => a + ((clamp(v, lo, hi) - lo) / (hi - lo)) * (b - a);
		}
	}

	/** [min, max] of one coordinate over the points of the series. */
	function extent(series: PlotSeries[], k: 0 | 1): [number, number] {
		const values = series.flatMap((s) => s.data.filter(finite).map((p) => p[k]));
		return values.length ? [Math.min(...values), Math.max(...values)] : [0, 1];
	}

	function lineMark(s: PlotSeries, i: number, { X, Y }: PointCtx) {
		const pts = s.data.filter(finite).map(([x, y]) => `${px(X(x))},${px(Y(y))}`);
		if (!pts.length) {
			return "";
		}
		const style = `--c:${seriesColor(s, i)};--w:${s.width ?? 2}`;
		return `<path class="line${s.dash ? " dash" : ""}" style="${style}" d="M${pts.join("L")}"/>`;
	}

	function stemMark(s: PlotSeries, i: number, { X, Y, ya, W, textWidth }: PointCtx) {
		const base = Y(clamp(0, ya.lo, ya.hi));
		const style = `--c:${seriesColor(s, i)};--w:${s.width ?? 2.5}`;
		const format: Labeller | undefined = labeller(s.label, ya.format, true);
		return s.data
			.map((p, i) => {
				if (!finite(p)) {
					return "";
				}
				const [x, y] = p;
				const cx = X(x);
				const cy = Y(y);
				const t = format?.(y, i, x);
				const dot = `<circle class="dot" style="${style}" cx="${px(cx)}" cy="${px(cy)}" r="4.5"/>`;
				const half = t ? textWidth(t) / 2 : 0;
				const ty = cy <= base ? Math.max(cy - 14, FONT) : cy + 14;
				const text = t ? svgText("value", clamp(cx, half + 4, W - half - 4), ty, "middle", t) : "";
				return svgLine("stem", cx, cx, base, cy, style) + dot + text;
			})
			.join("");
	}

	/** Layout shared by the bars of a plot: which axis holds the categories, the bar thickness, running stack ends. */
	function barLayout(series: PlotSeries[], option: PlotOption, { cat, val, W, L, B }: BarCtx) {
		const horizontal = Boolean(option.horizontal);
		const thick = Math.min(cat.band * 0.62, 56);
		const each = option.stack ? thick : thick / series.length;
		// Where a label past a bar's end may still go: the panel's right edge, the plot's left edge, the top edge, the axis.
		const bounds: [number, number] = horizontal ? [L, W - 4] : [B, 0]; // [for a negative value, for a positive one]
		return {
			horizontal,
			cat,
			val,
			thick,
			each,
			stacked: cat.names.map(() => 0),
			bounds,
			grow: horizontal ? 1 : -1, // screen direction of a positive value
		};
	}

	/** Label of a stacked segment: centred when it fits, else none. */
	function segmentLabel(
		t: string,
		{ horizontal, start, length, mid, each }: BarGeometry,
		textWidth: TextWidth,
	) {
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
	function endLabel(
		t: string,
		{ horizontal, length, end, mid, dir, bound }: BarGeometry,
		textWidth: TextWidth,
	) {
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
	const barLabel = (t: string, bar: BarGeometry, stack: boolean, textWidth: TextWidth) =>
		stack ? segmentLabel(t, bar, textWidth) : endLabel(t, bar, textWidth);

	/** The rect (with its title) of bar series j, category i, and the geometry its label needs. */
	function barRect(
		s: PlotSeries,
		j: number,
		i: number,
		v: number,
		layout: ReturnType<typeof barLayout>,
		option: PlotOption,
	) {
		const { horizontal, cat, val, thick, each, stacked, bounds, grow } = layout;
		const from = option.stack ? (stacked[i] ?? 0) : 0;
		stacked[i] = from + v;
		const a = val.at(from);
		const b = val.at(from + v);
		const start = Math.min(a, b);
		const length = Math.abs(b - a);
		const offset = cat.at(i) - thick / 2 + (option.stack ? 0 : j * each);
		const [x, y, w, h] = horizontal ? [start, offset, length, each] : [offset, start, each, length];
		const title = `<title>${esc(`${cat.names[i]}${s.name ? ` · ${s.name}` : ""}: ${val.format(v)}`)}</title>`;
		const bar: BarGeometry = {
			horizontal,
			start,
			length,
			end: b,
			mid: offset + each / 2,
			each,
			dir: v >= 0 ? grow : -grow,
			bound: bounds[v >= 0 ? 1 : 0],
		};
		return {
			rect: `<rect class="bar" style="--c:${seriesColor(s, j)}" x="${px(x)}" y="${px(y)}" width="${px(w)}" height="${px(h)}">${title}</rect>`,
			bar,
			format: labeller(s.label, val.format, false),
		};
	}

	/** One bar with its title and, when the series asks for labels, its value label. */
	function barMark(
		s: PlotSeries,
		j: number,
		i: number,
		v: number,
		layout: ReturnType<typeof barLayout>,
		option: PlotOption,
		textWidth: TextWidth,
	) {
		const { rect, bar, format } = barRect(s, j, i, v, layout, option);
		const t = format?.(v, i, 0);
		return t ? rect + barLabel(t, bar, Boolean(option.stack), textWidth) : rect;
	}

	/** Bars of every series switched on, stacked or side by side. */
	function barMarks(series: PlotSeries[], option: PlotOption, ctx: BarCtx) {
		const layout = barLayout(series, option, ctx);
		return series
			.map((s, j) =>
				ctx.shown[j]
					? s.data
							.map((v, i) =>
								typeof v === "number" && Number.isFinite(v)
									? barMark(s, j, i, v, layout, option, ctx.textWidth)
									: "",
							)
							.join("")
					: "",
			)
			.join("");
	}

	/** Every nth tick label, so that neighbours do not touch. */
	function labelEvery(axis: Axis, textWidth: TextWidth) {
		const [first, second] = axis.ticks;
		if (first === undefined || second === undefined) {
			return 1;
		}
		const gap = Math.abs(axis.at(second) - axis.at(first));
		const size = axis.vertical ? FONT + 6 : Math.max(...axis.labels.map(textWidth)) + 12;
		return Math.ceil(size / gap);
	}

	/** Gridline, tick mark and label (none when thinned out) of one tick; category axes have labels only. */
	function tickMarks(axis: Axis, t: number, i: number, every: number, { L, R, T, B }: Frame) {
		const p = axis.at(t);
		const v = axis.vertical;
		const grid = t === 0 && !axis.names && axis.lo < 0 ? "zero" : "grid";
		const marks = axis.names
			? ""
			: v
				? svgLine(grid, L, R, p, p) + svgLine("axis", L - TICK, L, p, p)
				: svgLine(grid, p, p, T, B) + svgLine("axis", p, p, B, B + TICK);
		const text = i % every === 0 ? axis.labels[i] : undefined;
		if (text === undefined) {
			return marks;
		}
		return (
			marks +
			(v
				? svgText("", L - TICK - 4, p, "end", text)
				: svgText("", p, B + TICK + 3 + FONT / 2, "middle", text))
		);
	}

	/** Gridlines, axis lines, ticks, tick labels and axis names. */
	function drawAxes(ctx: Ctx) {
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
	function barAxes(option: PlotOption, categories: string[], W: number, H: number) {
		const series = option.series ?? [];
		const cols = categories.map((_, i) =>
			series.map((s) => {
				const v = s.data[i];
				return (typeof v === "number" && v) || 0;
			}),
		);
		const tops = cols.map((c) => (option.stack ? c.reduce((a, b) => a + b, 0) : Math.max(...c)));
		const span: [number, number] = [Math.min(0, ...cols.flat()), Math.max(0, ...tops)];
		const x = option.x ?? {};
		const y = option.y ?? {};
		const cat = categoryAxis(option.horizontal ? y : x, categories, Boolean(option.horizontal));
		const val = numericAxis(
			option.horizontal ? x : y,
			span,
			option.horizontal ? W : H,
			!option.horizontal,
		);
		return option.horizontal ? { xa: val, ya: cat, cat, val } : { xa: cat, ya: val, cat, val };
	}

	/** Axes of a line and stem plot, over the extent of the data. */
	function plotAxes(option: PlotOption, W: number, H: number) {
		const series = option.series ?? [];
		const [yMin, yMax] = extent(series, 1);
		const [xMin, xMax] = extent(series, 0);
		// Stems reach 0, and keep a dot and label inside the axes at either end.
		const room = series.some((s) => s.type === "stem") ? 0.06 : 0;
		const dx = (xMax - xMin) * room;
		const dy = (yMax - yMin) * room;
		const yRange: [number, number] = room
			? [yMin < 0 ? yMin - dy : 0, yMax > 0 ? yMax + dy : 0]
			: [yMin, yMax];
		return {
			xa: numericAxis(option.x ?? {}, [xMin - dx, xMax + dx], W, false),
			ya: numericAxis(option.y ?? {}, yRange, H, true),
		};
	}

	/** The plot rectangle inside W x H: room left for the value labels and axis names, right and left for half a label. */
	function plotBox(xa: Axis, ya: Axis, W: number, H: number, textWidth: TextWidth) {
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

	/** Lines and stems of every series switched on. */
	function pointMarks(series: PlotSeries[], ctx: PointCtx) {
		return series
			.map((s, i) => (ctx.shown[i] ? (s.type === "stem" ? stemMark : lineMark)(s, i, ctx) : ""))
			.join("");
	}

	/** SVG markup for the option at W x H pixels; `shown[i]` says whether series i is switched on in the legend. */
	function render(
		option: PlotOption,
		W: number,
		H: number,
		textWidth: TextWidth,
		shown: boolean[],
	) {
		const series = option.series ?? [];
		const axes = option.categories
			? barAxes(option, option.categories, W, H)
			: plotAxes(option, W, H);
		const { xa, ya } = axes;
		const box = plotBox(xa, ya, W, H, textWidth);
		const { L, R, T, B } = box;
		if (R - L < 40 || B - T < 40) {
			return "";
		}
		place(xa, L, R);
		place(ya, ya.names ? T : B, ya.names ? B : T);
		const ctx = { xa, ya, ...box, W, H, textWidth, shown };

		const marks =
			"cat" in axes
				? barMarks(series, option, { ...ctx, cat: axes.cat, val: axes.val })
				: pointMarks(series, { ...ctx, xa: axes.xa, ya: axes.ya, X: axes.xa.at, Y: axes.ya.at });
		return drawAxes(ctx) + marks;
	}

	/** Legend buttons for the named series, or "" when the legend is off or has fewer than two entries. */
	function legendMarkup(option: PlotOption) {
		const named = (option.series ?? []).map((s, i) => [s, i] as const).filter(([s]) => s.name);
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
	function switchedOn(series: PlotSeries[], off: Set<string | undefined>) {
		let owner: string | undefined;
		return series.map((s) => {
			owner = s.name ?? owner;
			return !off.has(owner);
		});
	}

	return { render, legendMarkup, switchedOn };
};
