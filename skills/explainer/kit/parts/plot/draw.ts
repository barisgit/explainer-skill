/* plot draw: what kit:plot.js draws, not referenced from pages: pack joins it in front of plot.js, and runs it itself to draw each
   plot into the page (src/mdx/draw.ts). PlotDraw({ lang, size }) gives render(option, W, H, textWidth, shown), the SVG content,
   legendMarkup(option, textWidth, H), the legend's buttons (none when names sit at the line ends of an H px high area), and
   switchedOn(series, off), which series the legend leaves on; numbers are written in lang(), text is set at size() px (the
   theme's --size-label), and textWidth measures a label at that size. Bars' and areas' states and markers are marks.ts's
   (PlotMarks), regions and notes areas.ts's (PlotAreas), bars and their value labels bars.ts's (PlotBars), a picked category's
   frame and key pick.ts's (PlotPick). bands(option, W, H, textWidth) is where a bar plot's categories lie
   along their axis, for code that maps a click to one. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the function only scopes the part's names away from the page; the code in it is split into small functions
window.PlotDraw = ({ lang, size }) => {
	// px: the label size, as theme.css sets it for .plot text (--size-label); read again at each render and legend.
	let FONT = size();
	const PAD = 16;
	const GAP = 5; // px between the plot and its tick labels
	const lineHeight = () => FONT + 4; // px a line of a label takes: a category's note, a marker's wrapped label
	// The dash of each palette slot's line, so default lines stay apart without hue: solid, dashed, dotted, long, dash-dot, long-dot.
	const DASHES = ["", "6 4", "1 4", "12 4", "6 4 1 4", "12 4 1 4"];
	const AUTHOR_DASH = "6 4"; // dash: true

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
		notes?: undefined;
	}
	interface CategoryAxis extends AxisBase {
		names: string[];
		/** The categories' second lines, when one has one. */
		notes: string[] | undefined;
		/** The picked category's index (option.pick), whose name is in ink. */
		picked: number | undefined;
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
		/** The option whose values the texts give: the option drawn, or where a move is going. */
		texts: PlotOption;
	}
	interface PointCtx extends Ctx {
		xa: NumericAxis;
		ya: NumericAxis;
		X: (v: number) => number;
		Y: (v: number) => number;
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
		`<line class="${cls}" x1="${px(x1)}" x2="${px(x2)}" y1="${px(y1)}" y2="${px(y2)}"${attr("style", style)}/>`;
	/** Text centred vertically on y. */
	const svgText = (cls: string, x: number, y: number, anchor: Anchor, s: unknown, style = "") =>
		`<text${attr("class", cls)} x="${px(x)}" y="${px(y)}" dy="0.35em" text-anchor="${anchor}"${attr("style", style)}>${esc(s)}</text>`;
	const marks = window.PlotMarks({ svgLine, svgText });
	const areas = window.PlotAreas({ svgText, svgLine, wrap: marks.wrap, area: marks.area });
	/** The notes the last render found no clear place for. */
	let crowded: string[] = [];
	const ends = window.PlotEnds({ svgLine, svgText, size });
	const { formatter, labeller } = window.PlotFormat({ lang });
	const pick = window.PlotPick({ esc, formatter, labeller });
	const seriesColor = (s: PlotSeries, i: number) => s.color ?? `var(--c${(i % 6) + 1})`;
	/** A line's dash: the author's (dash: true or false), none for a colour of the author's, else its palette slot's. */
	const dashOf = (s: PlotSeries, i: number) =>
		s.dash !== undefined ? (s.dash ? AUTHOR_DASH : "") : s.color ? "" : (DASHES[i % 6] ?? "");
	/** A bar's state: its own entry in the series' fill, else the series' fill; undefined is solid in the series' colour. */
	const fillOf = (s: PlotSeries, i: number) =>
		(Array.isArray(s.fill) ? s.fill[i] : (s.fill as PlotFill | undefined)) || undefined;
	const bars = window.PlotBars({
		svgLine,
		svgText,
		size: () => FONT,
		marks,
		esc,
		fill: fillOf,
		colour: seriesColor,
		labeller,
		pick,
	});
	/**
	 * px from the top of a W x H drawing to the plot's bottom edge, under which sit the x labels (with a line more for categories'
	 * notes) unless they are left out, and the x axis's name.
	 */
	const bottomAt = (H: number, xName: unknown, notes = false, labelled = true) =>
		Math.floor(H - (labelled ? GAP + FONT + 8 : 4) - (xName ? 22 : 0) - (notes ? lineHeight() : 0));
	/** Whether the series carry their names at their line ends in place of a legend, in a drawing H px high; see PlotEnds' fit. */
	const namesAtEnds = (option: PlotOption, textWidth: TextWidth, H: number) =>
		ends.fit(option, textWidth, bottomAt(H, option.x?.name, false, option.x?.labels !== false));
	/** The series whose names sit at their line ends, with their index. */
	const endNamed = (option: PlotOption, textWidth: TextWidth, H: number) =>
		namesAtEnds(option, textWidth, H)
			? (option.series ?? []).flatMap((s, i) => (s.name ? [{ s, i, name: s.name }] : []))
			: [];

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
			labels: ticks.map((v) => (spec.labels === false ? "" : format(v))),
			name: spec.name,
			vertical,
			...unplaced,
		};
	}

	/** Category axis: one band per name, ticks at the band centres; notes when a category has a second line. */
	function categoryAxis(
		spec: AxisSpec,
		categories: PlotCategory[],
		vertical: boolean,
		picked: number | undefined,
	): CategoryAxis {
		const names = categories.map((c) => (typeof c === "string" ? c : c.name));
		const notes = categories.map((c) => (typeof c === "string" ? "" : (c.note ?? "")));
		const labelled = spec.labels !== false;
		return {
			names,
			notes: labelled && notes.some(Boolean) ? notes : undefined,
			picked,
			ticks: names.map((_, i) => i),
			labels: names.map((name) => (labelled ? String(name) : "")),
			name: spec.name,
			vertical,
			...unplaced,
		};
	}
	/** The values the option's markers stand at on one axis, which its range covers. */
	const markedAt = (option: PlotOption, key: "x" | "y") =>
		(option.marks ?? []).flatMap((m) => [
			...[m[key] ?? []].flat(),
			...(m.at ? [m.at[key === "x" ? 0 : 1]] : []),
		]);

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

	/** [min, max] of one coordinate over the points of the series and the `marked` values. */
	function extent(series: PlotSeries[], k: 0 | 1, marked: number[]): [number, number] {
		const values = [...series.flatMap((s) => s.data.filter(finite).map((p) => p[k])), ...marked];
		return values.length ? [Math.min(...values), Math.max(...values)] : [0, 1];
	}

	function lineMark(s: PlotSeries, i: number, { X, Y }: PointCtx) {
		const pts = s.data.filter(finite).map(([x, y]) => `${px(X(x))},${px(Y(y))}`);
		if (!pts.length) {
			return "";
		}
		const style = `--c:${seriesColor(s, i)};--w:${s.width ?? 2}`;
		return `<path class="line" style="${style}"${attr("stroke-dasharray", dashOf(s, i))} d="M${pts.join("L")}"/>`;
	}

	function stemMark(s: PlotSeries, i: number, { X, Y, ya, W, textWidth, texts }: PointCtx) {
		const said = texts.series?.[i]?.data;
		const base = Y(clamp(0, ya.lo, ya.hi));
		const style = `--c:${seriesColor(s, i)};--w:${s.width ?? 2.5}`;
		const format: PlotLabeller | undefined = labeller(s.label, ya.format, true);
		return s.data
			.map((p, i) => {
				if (!finite(p)) {
					return "";
				}
				const [x, y] = p;
				const cx = X(x);
				const cy = Y(y);
				const [tx, ty] = (said?.[i] ?? p) as PlotPoint;
				const t = format?.(ty, i, tx);
				const dot = `<circle class="dot" style="${style}" cx="${px(cx)}" cy="${px(cy)}" r="4.5"/>`;
				const half = t ? textWidth(t) / 2 : 0;
				const at = cy <= base ? Math.max(cy - 14, FONT) : cy + 14;
				const text = t ? svgText("value", clamp(cx, half + 4, W - half - 4), at, "middle", t) : "";
				return svgLine("stem", cx, cx, base, cy, style) + dot + text;
			})
			.join("");
	}

	/** Every nth tick label, so that neighbours do not touch. */
	function labelEvery(axis: Axis, textWidth: TextWidth) {
		const [first, second] = axis.ticks;
		if (first === undefined || second === undefined) {
			return 1;
		}
		const gap = Math.abs(axis.at(second) - axis.at(first));
		const room = axis.vertical
			? FONT + 6
			: Math.max(...axis.labels.map(textWidth), ...(axis.notes ?? []).map(textWidth)) + 12;
		return Math.ceil(room / gap);
	}

	/** A tick label's class: the picked category's name in ink, a name over its note in ink, else none (muted). */
	const tickClass = (axis: Axis, i: number) =>
		axis.names && axis.picked === i ? "picked" : axis.notes ? "cat" : "";

	/**
	 * The label of one tick, or none when thinned out. Where categories have notes, each name is in ink with its note under it,
	 * the two centred on the band together on a vertical axis.
	 */
	function tickLabel(axis: Axis, t: number, i: number, every: number, { L, B }: Frame) {
		const p = axis.at(t);
		const text = i % every === 0 ? axis.labels[i] : undefined;
		if (!text) {
			return "";
		}
		const note = axis.notes?.[i] ?? "";
		const cls = tickClass(axis, i);
		const line = axis.notes ? lineHeight() : 0;
		const [x, y, anchor] = axis.vertical
			? [L - GAP - 4, p - line / 2, "end" as const]
			: [p, B + GAP + 3 + FONT / 2, "middle" as const];
		return (
			svgText(cls, x, y, anchor, text) + (note ? svgText("note", x, y + line, anchor, note) : "")
		);
	}

	/**
	 * Tick labels, axis names and one quiet baseline, without gridlines or tick marks, as Chart draws its axes: the baseline runs
	 * along the category axis (across the plot for lines and stems) at value 0, or the edge nearest 0.
	 */
	function drawAxes(ctx: Ctx) {
		const { xa, ya, L, R, T, B, H, textWidth } = ctx;
		let out = "";
		for (const axis of [xa, ya]) {
			const every = labelEvery(axis, textWidth);
			out += axis.ticks.map((t, i) => tickLabel(axis, t, i, every, ctx)).join("");
		}
		out += ya.names
			? svgLine("axis", xa.at(0), xa.at(0), T, B)
			: svgLine("axis", L, R, ya.at(0), ya.at(0));
		out += xa.name ? svgText("name", R, H - FONT / 2 - 2, "end", xa.name) : "";
		out += ya.name ? svgText("name", PAD, FONT / 2 + 3, "start", ya.name) : "";
		return out;
	}

	/** Axes of a bar plot: the categories on one, the value range of all bars on the other. */
	function barAxes(option: PlotOption, categories: PlotCategory[], W: number, H: number) {
		const series = option.series ?? [];
		const cols = categories.map((_, i) =>
			series.map((s) => {
				const v = s.data[i];
				return (typeof v === "number" && v) || 0;
			}),
		);
		const tops = cols.map((c) => (option.stack ? c.reduce((a, b) => a + b, 0) : Math.max(...c)));
		const marked = markedAt(option, option.horizontal ? "x" : "y");
		const span: [number, number] = [
			Math.min(0, ...cols.flat(), ...marked),
			Math.max(0, ...tops, ...marked),
		];
		const x = option.x ?? {};
		const y = option.y ?? {};
		const cat = categoryAxis(
			option.horizontal ? y : x,
			categories,
			Boolean(option.horizontal),
			pick.pickedAt(option),
		);
		const val = numericAxis(
			option.horizontal ? x : y,
			span,
			option.horizontal ? W : H,
			!option.horizontal,
		);
		return option.horizontal ? { xa: val, ya: cat, cat, val } : { xa: cat, ya: val, cat, val };
	}

	/** The values areas reach on y besides the data: 0 under a filled line, and a region's bound by value. */
	function levelsOf(option: PlotOption) {
		const filled = (option.series ?? []).some(
			(s) => (s.type ?? "line") === "line" && s.fill && !Array.isArray(s.fill),
		);
		const bounds = (option.marks ?? []).flatMap(
			(m): readonly (string | number)[] => m.between ?? [],
		);
		return [...(filled ? [0] : []), ...bounds.filter((b): b is number => typeof b === "number")];
	}

	/** Axes of a line and stem plot, over the extent of the data. */
	function plotAxes(option: PlotOption, W: number, H: number) {
		const series = option.series ?? [];
		const [yMin, yMax] = extent(series, 1, [...markedAt(option, "y"), ...levelsOf(option)]);
		const [xMin, xMax] = extent(series, 0, markedAt(option, "x"));
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

	/**
	 * The plot rectangle inside W x H: room left for the value labels and axis names, right and left for half a label, and on the
	 * right for the names at the line ends (`named`).
	 */
	function plotBox(
		xa: Axis,
		ya: Axis,
		W: number,
		H: number,
		textWidth: TextWidth,
		named: string[],
	) {
		const yLabelWidth = Math.max(
			0,
			...ya.labels.map(textWidth),
			...(ya.notes ?? []).map(textWidth),
		);
		const firstHalf = textWidth(xa.labels[0] ?? "") / 2;
		const lastHalf = textWidth(xa.labels.at(-1) ?? "") / 2;
		return {
			L: Math.ceil(Math.max(PAD + yLabelWidth + GAP + 4, firstHalf + 4)),
			R: Math.floor(
				W - Math.max(PAD, lastHalf + 4, ...named.map((name) => ends.room(name, textWidth))),
			),
			T: ya.name ? FONT + 15 : 10,
			B: bottomAt(H, xa.name, Boolean(xa.notes), xa.labels.some(Boolean)),
		};
	}

	/** Lines and stems of every series switched on. */
	function pointMarks(series: PlotSeries[], ctx: PointCtx) {
		return series
			.map((s, i) => (ctx.shown[i] ? (s.type === "stem" ? stemMark : lineMark)(s, i, ctx) : ""))
			.join("");
	}

	/** Each named line's name just past its last point, spread apart (see PlotEnds' marks). */
	function endMarks(option: PlotOption, { X, Y, B, H, shown, textWidth }: PointCtx) {
		const named = endNamed(option, textWidth, H).flatMap(({ s, i, name }) => {
			const last = s.data.filter(finite).at(-1);
			return last && shown[i]
				? [
						{
							name,
							at: { x: X(last[0]), y: Y(last[1]) },
							colour: seriesColor(s, i),
							dash: dashOf(s, i),
						},
					]
				: [];
		});
		return ends.marks(named, B);
	}

	/** What PlotMarks needs to place markers: the numeric axes' mappings (a category axis has none), the box and the text. */
	const markFrame = (f: Omit<Frame, "H"> & { xa: Axis; ya: Axis }): PlotMarkFrame => ({
		...f,
		X: f.xa.names ? undefined : f.xa.at,
		Y: f.ya.names ? undefined : f.ya.at,
		line: lineHeight(),
	});

	/**
	 * The axes and plot box of the option at W x H pixels, and the lines its markers' labels take on top (`rows`), which push the
	 * plot down: one calculation for the drawing and for the height Plot gives a bar plot (markLines).
	 */
	function layoutOf(option: PlotOption, W: number, H: number, textWidth: TextWidth) {
		FONT = size();
		const axes = option.categories
			? barAxes(option, option.categories, W, H)
			: plotAxes(option, W, H);
		const { xa, ya } = axes;
		const named = endNamed(option, textWidth, H).map((end) => end.name);
		const box = { ...plotBox(xa, ya, W, H, textWidth, named), textWidth };
		place(xa, box.L, box.R);
		return { axes, box, rows: marks.rows(option.marks ?? [], markFrame({ ...box, xa, ya, W })) };
	}

	/**
	 * SVG markup for the option at W x H pixels; `shown[i]` says whether series i is switched on in the legend. Markers' labels on
	 * top take lines of their own above the plot, which start 6 px above where the plot would start without them.
	 */
	function render(
		option: PlotOption,
		W: number,
		H: number,
		textWidth: TextWidth,
		shown: boolean[],
		texts = option,
	) {
		const series = option.series ?? [];
		crowded = [];
		const laid = laidOut(option, W, H, textWidth, shown, texts);
		if (!laid) {
			return "";
		}
		const { axes, ctx, marked } = laid;
		if ("cat" in axes) {
			const drawn = bars.draw(series, option, { ...ctx, cat: axes.cat, val: axes.val });
			return drawAxes(ctx) + drawn.rects + marked.lines + drawn.labels + marked.labels;
		}
		// While the plot moves, its notes stay where they go, carried along with their points and regions.
		const going = texts === option ? undefined : laidOut(texts, W, H, textWidth, shown, texts);
		const notes = noted(option, laid, going && noted(texts, going)?.placed);
		if (!notes) {
			return "";
		}
		const { points } = notes;
		crowded = notes.crowded;
		return (
			drawAxes(ctx) +
			notes.fills +
			pointMarks(series, points) +
			marked.lines +
			endMarks(option, points) +
			marked.labels +
			notes.notes
		);
	}

	/**
	 * The option's axes and box at W x H with the axes placed, its drawing context and its markers; none when the plot has too
	 * little room to draw. Markers' labels on top take lines of their own above the plot.
	 */
	function laidOut(
		option: PlotOption,
		W: number,
		H: number,
		textWidth: TextWidth,
		shown: boolean[],
		texts: PlotOption,
	) {
		const { axes, box, rows } = layoutOf(option, W, H, textWidth);
		const { xa, ya } = axes;
		const T = box.T + rows * lineHeight();
		const { L, R, B } = box;
		if (R - L < 40 || B - T < 40) {
			return undefined;
		}
		place(ya, ya.names ? T : B, ya.names ? B : T);
		const ctx = { xa, ya, L, R, T, B, W, H, textWidth, shown, texts };
		return { axes, box, ctx, marked: marks.markers(option.marks ?? [], markFrame(ctx), box.T - 6) };
	}

	/** A line or stem plot's areas and notes (see PlotAreas) as laid out, with its points' mapping; none for a bar plot. */
	function noted(
		option: PlotOption,
		{ axes, box, ctx, marked }: NonNullable<ReturnType<typeof laidOut>>,
		goal?: PlotNotesPlaced,
	) {
		if ("cat" in axes) {
			return undefined;
		}
		const points = { ...ctx, xa: axes.xa, ya: axes.ya, X: axes.xa.at, Y: axes.ya.at };
		// Notes may use the room above the plot that no label on top takes.
		const frame = { ...points, T: box.T - 10, line: lineHeight(), colour: seriesColor };
		return { points, ...areas.draw(option, frame, marked.boxes, goal) };
	}

	/**
	 * Legend buttons for the named series, or "" when the legend is off, has fewer than two entries or the names sit at the line
	 * ends of a drawing H px high, the plot's area with no legend. A bar plot with a picked category has its key instead, from one
	 * named series: the category's name, then each series' value there after its name.
	 */
	function legendMarkup(option: PlotOption, textWidth: TextWidth, H: number) {
		FONT = size();
		const named = (option.series ?? []).map((s, i) => [s, i] as const).filter(([s]) => s.name);
		const at = pick.pickedAt(option);
		if (option.legend === false || named.length < (at === undefined ? 2 : 1)) {
			return "";
		}
		if (at !== undefined) {
			return pick.key(
				option,
				at,
				named.map(([s, i]) => [s, i, swatch(s, i)] as const),
			);
		}
		if (namesAtEnds(option, textWidth, H)) {
			return "";
		}
		return named
			.map(
				([s, i]) =>
					`<li><button type="button" data-i="${i}">${swatch(s, i)}${esc(s.name)}</button></li>`,
			)
			.join("");
	}

	/**
	 * A series' legend swatch: a line in its dash, or a square in its bars' state when every bar takes that one; bars in mixed
	 * states show the series' colour, and the page's chips say what the states mean.
	 */
	function swatch(s: PlotSeries, i: number) {
		const type = s.type ?? "line";
		const states = new Set(s.data.map((_, k) => fillOf(s, k)));
		const [state] = type === "bar" && states.size === 1 ? states : [undefined];
		return marks.swatch(type, seriesColor(s, i), type === "line" ? dashOf(s, i) : "", state);
	}

	/** Per series: whether it is switched on. An unnamed series belongs to the named one before it. */
	function switchedOn(series: PlotSeries[], off: Set<string | undefined>) {
		let owner: string | undefined;
		return series.map((s) => {
			owner = s.name ?? owner;
			return !off.has(owner);
		});
	}

	return {
		render,
		legendMarkup,
		keyText: pick.keyText,
		bands: (option: PlotOption, W: number, H: number, textWidth: TextWidth) =>
			pick.bands(option, layoutOf(option, W, H, textWidth), lineHeight()),
		switchedOn,
		markLines: (option: PlotOption, W: number, H: number, textWidth: TextWidth) =>
			layoutOf(option, W, H, textWidth).rows,
		crowded: () => crowded,
	};
};
