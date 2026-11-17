/* plot bars: a bar plot's bars and their value labels, not referenced from pages: pack joins it in front of plot.js with draw.ts,
   which uses it. PlotBars({ svgLine, svgText, size, marks, esc, fill, colour, labeller, pick }) gives draw(series, option, frame): the
   bars of every series switched on, stacked or side by side, each cut where it leaves the axis, with the picked category's frame
   (`rects`), their value labels (`labels`), a cut bar's always, placed by bar-labels.ts (PlotBarLabels), and the boxes both
   take (`boxes`), which the markers' labels keep off. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the function only scopes the part's names away from the page; the code in it is split into small functions
window.PlotBars = ({ svgLine, svgText, size, marks, esc, fill, colour, labeller, pick }) => {
	const { barLabel } = window.PlotBarLabels({ svgLine, svgText, size });
	const CUT = 10; // px inside the axis's end where a bar past it is cut
	const BAND = 8; // px of a bar's visible part the cut's slanted band needs

	/**
	 * Layout shared by the bars of a plot: which axis holds the categories, the bar thickness, and each category's running stack
	 * ends, [below 0, above 0], since a stack piles negative values down from 0 and positive ones up.
	 */
	function barLayout(
		series: readonly PlotSeries[],
		option: PlotOption,
		{ cat, val, W, L, B }: PlotBarFrame,
	) {
		const horizontal = Boolean(option.horizontal);
		// Horizontal bars are 25 px in a 56 px row, as the kit sizes a bar plot by its bars (Plot's height); columns 62% of theirs.
		const thick = Math.min(cat.band * (horizontal ? 25 / 56 : 0.62), 56);
		const each = option.stack ? thick : thick / series.length;
		// Where a label past a bar's end may still go: the panel's right edge, the plot's left edge, the top edge, the axis.
		const bounds: [number, number] = horizontal ? [L, W - 4] : [B, 0]; // [for a negative value, for a positive one]
		// The markers across the bars, which a value label keeps clear of.
		const key = horizontal ? "x" : "y";
		const crossing = (option.marks ?? []).flatMap((m) => {
			const at = m[key];
			return typeof at === "number" ? [val.at(at)] : [];
		});
		return {
			horizontal,
			cat,
			val,
			thick,
			each,
			stacked: cat.names.map((): [number, number] => [0, 0]),
			bounds,
			crossing,
			grow: horizontal ? 1 : -1, // screen direction of a positive value
		};
	}

	type Layout = ReturnType<typeof barLayout>;

	/**
	 * A break across a cut bar's visible part, from a to b px on the value axis: CUT inside its end b, or halfway along a part
	 * shorter than that; none on a part too short for the band, nor on a bar that is not cut.
	 */
	function cutMark(
		cut: boolean,
		a: number,
		b: number,
		offset: number,
		{ each, horizontal }: Layout,
	) {
		const length = Math.abs(b - a);
		return cut && length >= BAND
			? marks.cut(
					b + Math.sign(a - b) * Math.min(CUT, length / 2),
					[offset, offset + each],
					horizontal,
				)
			: "";
	}
	/** Past the axis's end by more than the rounding numericAxis allows when it rounds the end to a step. */
	const pastEnd = (v: number, { lo, hi }: PlotBarFrame["val"]) => {
		const slack = (hi - lo) * 1e-9;
		return v > hi + slack || v < lo - slack;
	};

	/**
	 * How a bar's value label is written: as its series asks, and a cut bar's value, asked for or not; none for a stacked segment
	 * that starts past the axis's end, wholly hidden beyond the cut segment under it, which prints the value there.
	 */
	const formatOf = (
		s: PlotSeries,
		cut: boolean,
		hidden: boolean,
		{ format }: PlotBarFrame["val"],
	) => (hidden ? undefined : (labeller(s.label, format, false) ?? (cut ? format : undefined)));
	/** A bar's title: its category, its series' name and the value it says. */
	const titleOf = (s: PlotSeries, i: number, said: number, { cat, val }: Layout) =>
		`<title>${esc(`${cat.names[i]}${s.name ? ` · ${s.name}` : ""}: ${val.format(said)}`)}</title>`;

	/** The rect (with its title) of bar series j, category i, at value v saying `said`, and the geometry its label needs. */
	function barRect(
		s: PlotSeries,
		j: number,
		i: number,
		[v, said]: [number, number],
		layout: Layout,
		option: PlotOption,
	) {
		const { horizontal, val, thick, each, stacked, bounds, grow } = layout;
		const ends = stacked[i] ?? [0, 0];
		const up = v >= 0 ? 1 : 0;
		const from = option.stack ? ends[up] : 0;
		ends[up] = from + v;
		// at() keeps a value inside the axis, so a and b are the ends of the bar's visible part.
		const a = val.at(from);
		const b = val.at(from + v);
		const start = Math.min(a, b);
		const length = Math.abs(b - a);
		const offset = layout.cat.at(i) - thick / 2 + (option.stack ? 0 : j * each);
		const shape = marks.bar(
			fill(s, i),
			colour(s, j),
			horizontal ? [start, offset, length, each] : [offset, start, each, length],
			titleOf(s, i, said, layout),
		);
		// A value past the axis's end is cut there, its label still the true value.
		const cut = pastEnd(from + v, val);
		const bar: PlotBarGeometry = {
			horizontal,
			start,
			length,
			end: b,
			mid: offset + each / 2,
			each,
			dir: up ? grow : -grow,
			bound: bounds[up],
			colour: fill(s, i) === "accent" ? "var(--accent)" : colour(s, j),
			open: shape.open,
			cut,
		};
		return {
			rect: shape.markup + cutMark(cut, a, b, offset, layout),
			bar,
			format: formatOf(s, cut, cut && Boolean(option.stack) && from !== 0 && length < 0.5, val),
		};
	}

	/** The box a bar takes on the screen. */
	const barBox = ({ horizontal, start, length, mid, each }: PlotBarGeometry): PlotBox => {
		const [a0, a1, c0, c1] = [start, start + length, mid - each / 2, mid + each / 2];
		return horizontal ? { x0: a0, x1: a1, y0: c0, y1: c1 } : { x0: c0, x1: c1, y0: a0, y1: a1 };
	};

	/** One series' bars, their boxes, and the value labels it asks for with the bars they belong to. */
	function seriesBars(
		s: PlotSeries,
		j: number,
		layout: Layout,
		option: PlotOption,
		ctx: PlotBarFrame,
	) {
		let rects = "";
		const labelled: { t: string; bar: PlotBarGeometry }[] = [];
		const boxes: PlotBox[] = [];
		// The texts are those of where a move goes (ctx.texts), so they never change while the bars do.
		const said = ctx.texts.series?.[j]?.data;
		for (const [i, v] of s.data.entries()) {
			if (typeof v === "number" && Number.isFinite(v)) {
				const shows = typeof said?.[i] === "number" ? (said[i] as number) : v;
				const { rect, bar, format } = barRect(s, j, i, [v, shows], layout, option);
				const t = format?.(shows, i, 0);
				rects += rect;
				boxes.push(barBox(bar));
				labelled.push(...(t ? [{ t, bar }] : []));
			}
		}
		return { rects, labelled, boxes };
	}

	/**
	 * Bars of every series switched on, stacked or side by side (`rects`, each with its title), and the value labels of the series
	 * that ask for them and of the bars cut (`labels`), which are drawn over the markers' lines and kept off every other bar and
	 * label; a cut segment of a stack is labelled at its end, as a bar side by side is. `boxes` are the bars' and the labels'.
	 */
	function draw(series: readonly PlotSeries[], option: PlotOption, ctx: PlotBarFrame) {
		const layout = barLayout(series, option, ctx);
		const drawn = series.flatMap((s, j) =>
			ctx.shown[j] ? [seriesBars(s, j, layout, option, ctx)] : [],
		);
		const rects = drawn.map((b) => b.rects).join("");
		const room = {
			crossing: layout.crossing,
			bars: drawn.flatMap((b) => b.boxes),
			placed: [] as PlotBox[],
		};
		const labels = drawn
			.flatMap((b) => b.labelled)
			.map(({ t, bar }) => barLabel(t, bar, Boolean(option.stack) && !bar.cut, ctx.textWidth, room))
			.join("");
		// Stacked segments touch: theme.css parts them by a line in the tone under the plot.
		const stacked = option.stack && rects ? `<g class="stack">${rects}</g>` : rects;
		const picked = pick.frame(
			series.filter((_, j) => ctx.shown[j]),
			Boolean(option.stack),
			layout,
		);
		return { rects: stacked + picked, labels, boxes: [...room.bars, ...room.placed] };
	}

	return { draw };
};
