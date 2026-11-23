/* plot draw: what kit:plot.js draws, not referenced from pages: pack joins it in front of plot.js, and runs it itself to draw each
   plot into the page (src/mdx/draw.ts). PlotDraw({ lang, size }) gives render(option, W, H, textWidth, shown), the SVG content,
   legendMarkup(option), the legend's buttons (none when the series carry their names on their marks), and
   switchedOn(series, off), which series the legend leaves on; numbers are written in lang(), text is set at size() px (the
   theme's --size-label), and textWidth measures a label at that size. Bars' and areas' states and markers are marks.ts's
   (PlotMarks), regions and notes areas.ts's (PlotAreas), bars and their value labels bars.ts's (PlotBars), the lines' ends
   ends.ts's (PlotEnds), bar names bar-names.ts's (PlotBarNames), the axes axes.ts's (PlotAxes), the legend legend.ts's (PlotLegend), a picked category's frame and key pick.ts's (PlotPick); end names
   and notes are placed together by place.ts (PlotPlace), after the markers' labels. bands(option, W, H, textWidth) is where a
   bar plot's categories lie along their axis, for code that maps a click to one. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the function only scopes the part's names away from the page; the code in it is split into small functions
window.PlotDraw = ({ lang, size }) => {
	// px: the label size, as theme.css sets it for .plot text (--size-label); read again at each render and legend.
	/** px: an arrow shorter than this, its head and gaps shrunk to fit, is reported as too short to read. */
	const SHORT = 6;
	/** No room kept for bar names past what the layout keeps. */
	const NO_ROOM = { top: 0, right: 0 };
	// The most of a bar plot's width its series' names may take from it on the right.
	const NAME_SHARE = 0.4;
	let FONT = size();
	const PAD = 16;
	const GAP = 5; // px between the plot and its tick labels
	const lineHeight = () => FONT + 4; // px a line of a label takes: a category's note, a marker's wrapped label
	// The dash of each palette slot's line, so default lines stay apart without hue: solid, dashed, dotted, long, dash-dot, long-dot.
	const DASHES = ["", "6 4", "1 4", "12 4", "6 4 1 4", "12 4 1 4"];
	const AUTHOR_DASH = "6 4"; // dash: true

	type TextWidth = (s: unknown) => number;
	type NumericAxis = PlotNumericAxis;
	type Axis = PlotAxis;
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
	const placer = window.PlotPlace({ wrap: marks.wrap });
	const areas = window.PlotAreas({
		svgText,
		svgLine,
		wrap: marks.wrap,
		area: marks.area,
		place: placer,
	});
	/** What the last render found no clear place for: notes by label, line names by series. */
	let crowded: PlotCrowded = { notes: [], names: [], arrows: [] };
	const format = window.PlotFormat({ lang });
	const { formatter, labeller } = format;
	const pick = window.PlotPick({ esc, formatter, labeller });
	const { numericAxis, categoryAxis, place } = window.PlotAxes({ formatter });
	const axisLabels = window.PlotAxisLabels({
		svgLine,
		svgText,
		size: () => FONT,
		pad: PAD,
		gap: GAP,
	});
	const drawAxes = (ctx: Ctx) => axisLabels.draw({ ...ctx, picked: pick.pickedAt(ctx.texts) });
	const seriesColor = (s: PlotSeries, i: number) => s.color ?? `var(--c${(i % 6) + 1})`;
	/** A line's dash: the author's (dash: true or false), none for a colour of the author's, else its palette slot's. */
	const dashOf = (s: PlotSeries, i: number) =>
		s.dash !== undefined ? (s.dash ? AUTHOR_DASH : "") : s.color ? "" : (DASHES[i % 6] ?? "");
	const ends = window.PlotEnds({
		svgLine,
		svgText,
		size,
		place: placer,
		format,
		colour: seriesColor,
		dash: dashOf,
		wrap: marks.wrap,
	});
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
	const stems = window.PlotStems({
		svgLine,
		svgText,
		size: () => FONT,
		colour: seriesColor,
		labeller,
		finite,
		px,
	});
	const barNames = window.PlotBarNames({ svgLine, svgText, place: placer, wrap: marks.wrap });
	const legend = window.PlotLegend({
		swatch: marks.swatch,
		esc,
		colour: seriesColor,
		dash: dashOf,
		fill: fillOf,
		pick,
	});
	/**
	 * px from the top of a W x H drawing to the plot's bottom edge, under which sit the x labels (with a line more for categories'
	 * notes) unless they are left out, and the x axis's name.
	 */
	const bottomAt = (H: number, xName: unknown, notes = false, labelled = true) =>
		Math.floor(H - (labelled ? GAP + FONT + 8 : 4) - (xName ? 22 : 0) - (notes ? lineHeight() : 0));
	/** A number's digits, without sign, point or leading zeros: what a label that writes it holds in some format. */
	const digits = (v: unknown) => String(v).replace(/\D/g, "").replace(/^0+/, "");
	/**
	 * Whether a bar plot leaves out its value axis's labels: as its axis's `labels` says, else when every bar prints its value,
	 * written by the kit from the value (label true or a format), side by side, and every marker on that axis writes its own:
	 * the labels would only repeat them. Text labels may say something else, a stacked segment too thin for its value drops it,
	 * and a marker without its number is read against the axis, so those keep it. plot.tsx sizes a bar plot by the same rule.
	 */
	function valueAxisOut(option: PlotOption) {
		const key = option.horizontal ? "x" : "y";
		const said = option[key]?.labels;
		if (said !== undefined) {
			return !said;
		}
		const printed = (s: PlotSeries) =>
			s.type === "bar" &&
			(s.label === true || (typeof s.label === "object" && !Array.isArray(s.label)));
		const readable = (m: PlotMark) =>
			[m[key] ?? []].flat().every((v) => digits(m.label ?? "").includes(digits(v)));
		return (
			!option.stack && (option.series ?? []).every(printed) && (option.marks ?? []).every(readable)
		);
	}
	/**
	 * The values the option's markers, notes and, on two numeric axes (`arrows`), arrows stand at on one axis, which its range
	 * covers. A plot with categories draws no arrow, so its arrows move no axis.
	 */
	const markedAt = (option: PlotOption, key: "x" | "y", arrows: boolean) =>
		(option.marks ?? []).flatMap((m) => [
			...[m[key] ?? []].flat(),
			...[m.at, ...(arrows ? [m.from, m.to] : [])].flatMap((p) =>
				p ? [p[key === "x" ? 0 : 1]] : [],
			),
		]);

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

	/** Axes of a bar plot: the categories on one, the value range of all bars on the other. */
	function barAxes(option: PlotOption, categories: PlotCategory[], W: number, H: number) {
		const series = option.series ?? [];
		const cols = categories.map((_, i) =>
			series.map((s) => {
				const v = s.data[i];
				return (typeof v === "number" && v) || 0;
			}),
		);
		// A stack's ends: its negative values piled down from 0, its positive ones up.
		const sum = (c: number[], sign: number) =>
			c.filter((v) => v * sign > 0).reduce((a, b) => a + b, 0);
		const ends = cols.flatMap((c) => (option.stack ? [sum(c, -1), sum(c, 1)] : c));
		const marked = markedAt(option, option.horizontal ? "x" : "y", false);
		const span: [number, number] = [
			Math.min(0, ...ends, ...marked),
			Math.max(0, ...ends, ...marked),
		];
		const x = option.x ?? {};
		const y = option.y ?? {};
		const cat = categoryAxis(
			option.horizontal ? y : x,
			categories,
			Boolean(option.horizontal),
			pick.pickedAt(option),
		);
		const valueSpec = option.horizontal ? x : y;
		// Labels out when valueAxisOut says so, else the axis's own texts, if any.
		const val = numericAxis(
			{ ...valueSpec, labels: !valueAxisOut(option) && (valueSpec.labels ?? true) },
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
		const [yMin, yMax] = extent(series, 1, [...markedAt(option, "y", true), ...levelsOf(option)]);
		const [xMin, xMax] = extent(series, 0, markedAt(option, "x", true));
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
	 * right for names at the line ends (`named`, each with the x its line ends at), and `right` more for bar names.
	 */
	function plotBox(
		[xa, ya]: [Axis, Axis],
		[W, H]: [number, number],
		textWidth: TextWidth,
		named: { name: string; x: number }[],
		right: number,
	) {
		const yLabelWidth = Math.max(
			0,
			...ya.labels.map(textWidth),
			...(ya.notes ?? []).map(textWidth),
		);
		const firstHalf = textWidth(xa.labels[0] ?? "") / 2;
		const lastHalf = textWidth(xa.labels.at(-1) ?? "") / 2;
		const L = Math.ceil(Math.max(PAD + yLabelWidth + GAP + 4, firstHalf + 4));
		// The right edge leaves each name room past its line's end, which lies `share` of the way across.
		const reach = named.map(({ name, x }) => {
			const share = "lo" in xa ? Math.min(1, (x - xa.lo) / (xa.hi - xa.lo)) : 1;
			return share > 0 ? L + (W - ends.room(name, textWidth) - L) / share : W;
		});
		const R = Math.min(W - Math.max(PAD, lastHalf + 4), ...reach);
		return {
			L,
			R: Math.floor(R - right),
			T: ya.name ? FONT + 15 : 10,
			B: bottomAt(H, xa.name, Boolean(xa.notes), xa.labels.some(Boolean)),
		};
	}

	/** Lines and stems of every series switched on. */
	function pointMarks(series: PlotSeries[], ctx: PointCtx) {
		return series
			.map((s, i) => (ctx.shown[i] ? (s.type === "stem" ? stems.draw : lineMark)(s, i, ctx) : ""))
			.join("");
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
	function layoutOf(
		option: PlotOption,
		W: number,
		H: number,
		textWidth: TextWidth,
		extra = NO_ROOM,
	) {
		FONT = size();
		const axes = option.categories
			? barAxes(option, option.categories, W, H)
			: plotAxes(option, W, H);
		const { xa, ya } = axes;
		const named = ends.named(option, textWidth).map(({ s, name }) => ({
			name,
			x: s.data.filter(finite).at(-1)?.[0] ?? 0,
		}));
		const box = {
			...plotBox([xa, ya], [W, H], textWidth, named, extra.right),
			textWidth,
		};
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
		from?: PlotOption,
	) {
		const series = option.series ?? [];
		crowded = { notes: [], names: [], arrows: [] };
		const args: BarArgs = [W, H, textWidth, shown, texts];
		const drawn = drawnLayout(option, args, from);
		if (!drawn) {
			return "";
		}
		const { laid } = drawn;
		const { axes } = laid;
		if ("cat" in axes) {
			return barPlot(option, args, drawn);
		}
		// While the plot moves, its notes stay where the move's end places them, carried along with their points and regions.
		const going = texts === option ? undefined : laidOut(texts, W, H, textWidth, shown, texts);
		const goal =
			going && !("cat" in going.axes) ? labelled(texts, { ...going, ...going.axes }) : undefined;
		const { points, marked, named, noted } = labelled(
			option,
			{ ...laid, ...axes },
			goal?.noted.placed,
		);
		crowded = { notes: noted.crowded, names: named.crowded, arrows: short(option, points) };
		return (
			drawAxes(points) +
			noted.fills +
			pointMarks(series, points) +
			marked.lines +
			named.markup +
			marked.labels +
			noted.notes
		);
	}

	type Laid = NonNullable<ReturnType<typeof laidOut>>;
	type BarArgs = [W: number, H: number, textWidth: TextWidth, shown: boolean[], texts: PlotOption];

	/** A bar plot's bars and their values in a layout, and the frame names are placed in. */
	function barsIn(option: PlotOption, { axes, ctx }: Laid, texts: PlotOption) {
		const drawn =
			"cat" in axes
				? bars.draw(option.series ?? [], option, { ...ctx, cat: axes.cat, val: axes.val })
				: undefined;
		const frame = { ...ctx, line: lineHeight(), lines: [], fills: [], R: ctx.W - 4, texts };
		return { drawn, frame };
	}

	/** The highest px names above a bar plot may reach: where the labels on top end, a little above the room kept for them. */
	const ceilingOf = (T: number, extra: typeof NO_ROOM) => Math.max(2, T - extra.top - 8);

	type Room = typeof NO_ROOM;
	/** Each side's larger room. */
	const wider = (a: Room, b: Room) =>
		b === NO_ROOM ? a : { top: Math.max(a.top, b.top), right: Math.max(a.right, b.right) };

	/**
	 * The room a bar plot drawn as `geometry` keeps for the names (those of where it is going, `texts`) of bars side by side above
	 * it and on its right: laid out again with what was missing until the names fit, as the bars scale with it, the right never
	 * more than NAME_SHARE of the width, and never so much that no plot is left. Stacked columns keep side room only when it helps.
	 */
	function barRoom(geometry: PlotOption, [W, H, textWidth, shown, texts]: BarArgs) {
		let room = NO_ROOM;
		if (geometry.stack) {
			return stackRoom(geometry, [W, H, textWidth, shown, texts]);
		}
		if (!ends.onMarks(texts)) {
			return room;
		}
		let laid = laidOut(geometry, W, H, textWidth, shown, texts);
		for (let k = 0; laid && k < 8; k++) {
			const { drawn, frame } = barsIn(geometry, laid, texts);
			const need = drawn && barNames.room(geometry, drawn.drawn, frame, ceilingOf(frame.T, room));
			const next = need && grown(room, need, W);
			if (!next) {
				break;
			}
			laid = laidOut(geometry, W, H, textWidth, shown, texts, next);
			room = laid ? next : room;
		}
		return room;
	}
	/** The room with what the names still need (`need`, px), the right at most NAME_SHARE of W; undefined when it gains nothing. */
	function grown(room: Room, need: Room, W: number) {
		const right = Math.min(room.right + Math.ceil(need.right), Math.floor(W * NAME_SHARE));
		return need.top < 1 && right === room.right
			? undefined
			: { top: room.top + Math.ceil(need.top), right };
	}

	/** Spare room to the right of stacked columns without dropping any more category labels. */
	function stackSlack({ ctx: { xa, L, R, textWidth } }: Laid) {
		const span = R - L;
		return Math.max(
			0,
			Math.floor(Math.min(span - axisLabels.labelSpan(xa, textWidth), span * NAME_SHARE)),
		);
	}

	/** A stack gets a side gutter only if it gives more names a clear spot without thinning the category ticks. */
	function stackRoom(option: PlotOption, [W, H, textWidth, shown, texts]: BarArgs) {
		const plain = laidOut(option, W, H, textWidth, shown, texts);
		if (!plain || !ends.onMarks(texts) || option.horizontal) {
			return NO_ROOM;
		}
		const right = barNames.sideRoom(stackSlack(plain), (right) => {
			const room = { top: 0, right };
			const laid = right ? laidOut(option, W, H, textWidth, shown, texts, room) : plain;
			return laid && decoratedBars(option, laid, texts, room)?.named.crowded;
		});
		return right ? { top: 0, right } : NO_ROOM;
	}

	/**
	 * The layout a plot is drawn in and the room kept in it for bar names: what they need where the plot is going (`texts`) and,
	 * while it moves, where the move started (`from`), so no step of it runs short; the plain layout where that leaves no plot.
	 * One for the drawing, the lines its markers take (markLines) and the bands a pick reads (bands). None without room to draw.
	 */
	function drawnLayout(option: PlotOption, args: BarArgs, from?: PlotOption) {
		const [W, H, textWidth, shown, texts] = args;
		const plain = laidOut(option, W, H, textWidth, shown, texts);
		if (!(plain && "cat" in plain.axes)) {
			return plain && { laid: plain, room: NO_ROOM };
		}
		const end = barRoom(texts, args);
		// A move switches the group/stack layout immediately; an old stack's side space does not belong to groups or rows.
		const sameLayout =
			from &&
			Boolean(from.stack) === Boolean(texts.stack) &&
			(!from.stack || Boolean(from.horizontal) === Boolean(texts.horizontal));
		const reserved = sameLayout ? wider(end, barRoom(from, args)) : end;
		const room =
			option.stack && !option.horizontal && reserved.right
				? { ...reserved, right: Math.min(reserved.right, stackSlack(plain)) }
				: reserved;
		const laid =
			room === NO_ROOM ? undefined : laidOut(option, W, H, textWidth, shown, texts, room);
		return laid ? { laid, room } : { laid: plain, room: NO_ROOM };
	}

	/** Places markers and names together so the room probe and the drawing see the same obstacles. */
	function decoratedBars(option: PlotOption, laid: Laid, texts: PlotOption, room: Room) {
		const { drawn, frame } = barsIn(option, laid, texts);
		if (!drawn) {
			return undefined;
		}
		const nameFrame = { ...frame, ceiling: ceilingOf(frame.T, room) };
		const choose = (spots: PlotSpot[], placed: readonly PlotBox[]) =>
			placer.cheapest(spots, frame, [...placed, ...drawn.boxes]);
		const marked = marks.markers(
			option.marks ?? [],
			{ ...markFrame(laid.ctx), choose },
			laid.box.T - 6,
		);
		const named = ends.onMarks(texts)
			? barNames.names(option, drawn.drawn, nameFrame, [...drawn.boxes, ...marked.boxes])
			: { markup: "", crowded: [] };
		return { drawn, marked, named };
	}

	/** A bar plot and its labels in the layout selected by drawnLayout. */
	function barPlot(option: PlotOption, args: BarArgs, { laid, room }: { laid: Laid; room: Room }) {
		const parts = decoratedBars(option, laid, args[4], room);
		if (!parts) {
			return "";
		}
		const { drawn, marked, named } = parts;
		crowded = { notes: [], names: named.crowded, arrows: [] };
		return (
			drawAxes(laid.ctx) + drawn.rects + marked.lines + drawn.labels + marked.labels + named.markup
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
		extra = NO_ROOM,
	) {
		const { axes, box, rows } = layoutOf(option, W, H, textWidth, extra);
		const { xa, ya } = axes;
		const T = box.T + rows * lineHeight() + extra.top;
		const { L, R, B } = box;
		if (R - L < 40 || B - T < 40) {
			return undefined;
		}
		place(ya, ya.names ? T : B, ya.names ? B : T);
		const ctx = { xa, ya, L, R, T, B, W, H, textWidth, shown, texts };
		return { axes, box, ctx, rows };
	}

	/** The arrows drawn shorter than SHORT px, which read as a dot more than an arrow, as their label or their points. */
	const short = (
		option: PlotOption,
		{ X, Y }: { X: (v: number) => number; Y: (v: number) => number },
	) =>
		(option.marks ?? []).flatMap(({ from, to, label }) =>
			from && to && Math.hypot(X(to[0]) - X(from[0]), Y(to[1]) - Y(from[1])) < SHORT
				? [label ?? `${JSON.stringify(from)} to ${JSON.stringify(to)}`]
				: [],
		);

	/**
	 * A line and stem plot's labels placed together, the markers' first (a label across the plot keeps off the lines), then the
	 * names and values at the ends, then the notes (with a move's `goal`, where it placed them), each clear of those before it.
	 * Names and notes may use the room above the plot that no label on top takes, and names the room kept for them on the right.
	 */
	function labelled(
		option: PlotOption,
		{ xa, ya, box, ctx }: { xa: NumericAxis; ya: NumericAxis; box: { T: number }; ctx: Ctx },
		goal?: PlotNotesPlaced,
	) {
		const points = { ...ctx, xa, ya, X: xa.at, Y: ya.at };
		const frame = { ...points, T: box.T - 10, line: lineHeight(), colour: seriesColor };
		const labelFrame = { ...frame, lines: placer.obstacles(option, frame), fills: [] };
		const choose = (spots: PlotSpot[], placed: readonly PlotBox[]) =>
			placer.cheapest(spots, labelFrame, placed);
		const marked = marks.markers(option.marks ?? [], { ...markFrame(points), choose }, box.T - 6);
		const placed = [...marked.boxes, ...stems.values(option.series ?? [], points)];
		const named = ends.marks(option, points, { ...labelFrame, R: points.W - 2 }, placed);
		return { points, marked, named, noted: areas.draw(option, frame, placed, goal) };
	}

	/** Legend buttons for the named series, or "" when the series carry their names on their marks (see PlotLegend). */
	const legendMarkup = (option: PlotOption) => legend.markup(option, ends.onMarks(option));

	return {
		render,
		legendMarkup,
		keyText: pick.keyText,
		// Where the categories are drawn, below and beside the room kept for bar names.
		bands(option: PlotOption, W: number, H: number, textWidth: TextWidth) {
			const shown = (option.series ?? []).map(() => true);
			const drawn = drawnLayout(option, [W, H, textWidth, shown, option]);
			return drawn && pick.bands(option, drawn.laid.ctx);
		},
		switchedOn: legend.switchedOn,
		// In the layout the plot is drawn in; a plot too small to draw counts its lines as if it had no names.
		markLines(
			option: PlotOption,
			W: number,
			H: number,
			textWidth: TextWidth,
			texts = option,
			from?: PlotOption,
		) {
			if (!option.marks?.length) {
				return 0;
			}
			const shown = (option.series ?? []).map(() => true);
			return (
				drawnLayout(option, [W, H, textWidth, shown, texts], from)?.laid.rows ??
				layoutOf(option, W, H, textWidth).rows
			);
		},
		crowded: () => crowded,
	};
};
