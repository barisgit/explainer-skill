/* plot bars: a bar plot's bars and their value labels, not referenced from pages: pack joins it in front of plot.js with draw.ts,
   which uses it. PlotBars({ svgLine, svgText, size, marks, esc, fill, colour, labeller, pick }) gives draw(series, option, frame): the
   bars of every series switched on, stacked or side by side, with the picked category's frame (`rects`), and their value labels
   (`labels`), placed by bar-labels.ts (PlotBarLabels). */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the function only scopes the part's names away from the page; the code in it is split into small functions
window.PlotBars = ({ svgLine, svgText, size, marks, esc, fill, colour, labeller, pick }) => {
	const { barLabel } = window.PlotBarLabels({ svgLine, svgText, size });

	/** Layout shared by the bars of a plot: which axis holds the categories, the bar thickness, running stack ends. */
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
			stacked: cat.names.map(() => 0),
			bounds,
			crossing,
			grow: horizontal ? 1 : -1, // screen direction of a positive value
		};
	}

	type Layout = ReturnType<typeof barLayout>;

	/** The rect (with its title) of bar series j, category i, and the geometry its label needs. */
	function barRect(
		s: PlotSeries,
		j: number,
		i: number,
		[v, said]: [number, number],
		layout: Layout,
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
		const title = `<title>${esc(`${cat.names[i]}${s.name ? ` · ${s.name}` : ""}: ${val.format(said)}`)}</title>`;
		const shape = marks.bar(fill(s, i), colour(s, j), [x, y, w, h], title);
		const bar: PlotBarGeometry = {
			horizontal,
			start,
			length,
			end: b,
			mid: offset + each / 2,
			each,
			dir: v >= 0 ? grow : -grow,
			bound: bounds[v >= 0 ? 1 : 0],
			colour: fill(s, i) === "accent" ? "var(--accent)" : colour(s, j),
			open: shape.open,
		};
		return {
			rect: shape.markup,
			bar,
			format: labeller(s.label, val.format, false),
		};
	}

	const NO_BARS = { rects: "", labels: "" };
	/** One series' bars and the value labels it asks for. */
	function seriesBars(
		s: PlotSeries,
		j: number,
		layout: Layout,
		option: PlotOption,
		ctx: PlotBarFrame,
	) {
		let rects = "";
		let labels = "";
		const said = ctx.texts.series?.[j]?.data;
		for (const [i, v] of s.data.entries()) {
			if (typeof v === "number" && Number.isFinite(v)) {
				const shows = typeof said?.[i] === "number" ? (said[i] as number) : v;
				const { rect, bar, format } = barRect(s, j, i, [v, shows], layout, option);
				const t = format?.(shows, i, 0);
				rects += rect;
				labels += t ? barLabel(t, bar, Boolean(option.stack), ctx.textWidth, layout.crossing) : "";
			}
		}
		return { rects, labels };
	}

	/**
	 * Bars of every series switched on, stacked or side by side (`rects`, each with its title), and the value labels of the series
	 * that ask for them (`labels`), which are drawn over the markers' lines.
	 */
	function draw(series: readonly PlotSeries[], option: PlotOption, ctx: PlotBarFrame) {
		const layout = barLayout(series, option, ctx);
		const bars = series.map((s, j) =>
			ctx.shown[j] ? seriesBars(s, j, layout, option, ctx) : NO_BARS,
		);
		const rects = bars.map((b) => b.rects).join("");
		const labels = bars.map((b) => b.labels).join("");
		// Stacked segments touch: theme.css parts them by a line in the tone under the plot.
		const drawn = option.stack && rects ? `<g class="stack">${rects}</g>` : rects;
		const picked = pick.frame(
			series.filter((_, j) => ctx.shown[j]),
			Boolean(option.stack),
			layout,
		);
		return { rects: drawn + picked, labels };
	}

	return { draw };
};
