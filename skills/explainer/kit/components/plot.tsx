/* Plot: small line, stem and bar plots as SVG in the page theme, no ECharts. For zoom, drill-down, heatmaps or sankey use Chart.
   <Plot label="Calls per day" option={{ categories: ["Mon", "Tue"], series: [{ name: "Calls", type: "bar", data: [12, 18] }] }} />
     option  { series, categories, horizontal, stack, x, y, marks, legend }
       series  [{ name, type, data, color, width, dash, fill, label }]
         type "line"   data [[x, y], ...]; width in px (default 2); dash: true dashed, false solid, unset by its slot (below)
         type "stem"   data [[x, y], ...]: a drop line from 0 with a dot, for spectra and samples
         type "bar"    data [v, ...], one per category
         color  any CSS colour, default var(--c1)..var(--c6) in turn: muted inks, a line in each also dashed its own way.
                Put "var(--accent)" on the series the page is about; color-mix(...) works too
         fill   a bar's state, from the accent: "accent" solid, "hollow" (tint in an accent outline), "hatch" (grey lines at 45
                degrees), for the whole series or one per bar: ["accent", "hollow", "hatch"] ("" keeps the series' colour; the legend
                shows a state every bar shares, else the series' colour). On a line: the area down to 0, true in a tint of its
                colour or a state
         name   named lines carry their names on the plot, never in a legend: at their ends, stacked with leaders where ends
                crowd, else beside their own line along it; pack warns about a name with no clear place (shorten it, or add
                height). With stems or bars, names go in the legend, whose entries switch the series on and off, a series
                without a name toggling with the named one before it
         label  prints exact values on the marks: true, a format as below, or one text per point or bar: ["½mA", "A", "½mA"];
                a line prints its last point's after its name: "10 kΩ: 847 ns", wrapped, or left out past two lines. A bar plot
                whose every bar prints its value (true or a format, side by side) leaves out its value axis, unless a marker on
                it does not write its number
       categories  ["A", "B"] makes a bar plot (bars cannot mix with line or stem); horizontal: true runs them down the page,
                   stack: true piles the series into one bar per category, negative values down from 0, else they sit side by side. Keep names short.
                   { name: "Heat pump", note: "4,200 EUR" } adds a muted second line under a name
       marks  [{ x: 16, label: "Payback" }]: a dashed reference line at x (or y), its label on top beside it, wrapped inside the plot,
              a row higher where it would touch another's
              { x: [20, 30], label: "night" }: a span, a bracket on top with its label
              { x: [6, 11.5], between: ["Roof", "House"], fill: "accent", label: "charging" }: the region between two named lines
                (or a line and a number) over x, filled as a line's fill, its label inside it or beside it
              { at: [11.5, 2.8], label: "full at 11:31" }: a note beside that point
              { from: [10, 1.09], to: [100, 1.09], label: "more terms" }: an arrow between two data points, for a change in
                direction and size the reader should follow (a peak that moves), its label placed as a note; on two numeric axes only,
                and pack warns about one too short to read
              Notes keep clear of the lines and labels, wrapping or tied by a leader; pack warns about one with no clear place
       x, y   { min, max, step, name, format, labels }  screen axes (labels: false leaves the tick labels out, true keeps them, and texts are
              a number axis's own, spread evenly from min to max, else the data's ends: ["06:00", "12:00", "18:00", "00:00", "06:00"]):
              in a horizontal bar plot y holds the categories, x the values.
              Range and step are automatic and round; numbers follow the page's lang, and format sets how:
              { digits: 1, unit: "kHz" } (1.5 kHz), { percent: true } (25%), { currency: "EUR", compact: true } (€12K)
       legend true shows the legend, false hides it and the names at the ends; unset, it shows for two or more named series
              unless all are lines
       pick   3 picks a bar plot's fourth category: its bars framed, and the legend becomes its key, each series' value there.
              An Explore choice with axis: true sets it and lets the reader pick
     label   the accessible name (role="img")
     class   more classes after "chart plot", e.g. "tall"
     height  the height: a length in px, rem, vw or vh, or clamp()/min()/max() of them. Size a plot with this, not with CSS on .chart.
             Unset, a horizontal bar plot without a legend is 3.5rem a bar (25 px bars) up to the tall 34rem (thinner rows past it),
             plus the lines its marker labels take; others the theme's height
   The plot fills the element at its pixel size and redraws on resize, so text stays at the label size from phone to desktop; light and dark switch
   with no redraw. pack draws it into the page first, so it shows with scripts off and in print, unless a page rule sizes its element or its
   legend wraps into rows pack cannot count. A new option moves the plot there from what it shows (bars grow, lines morph, the numbers
   written already the new ones; at once under reduced motion and before the reader acts): series is replaced whole, other keys merge into the plot (x and y one level deeper).
   Exact values without hovering: label on stems and bars, a readout in the page for lines; each bar (zero ones too) also has a title.
   A label on a stacked segment is left out when it does not fit: when every exact value must stay visible, add a readout or table.
   A bar past min or max is cut where it meets the edge, its true value always printed there; other values sit on the edge.
   Axes carry their labels and one quiet baseline at 0, without gridlines or tick marks.
   A plot a slider, choice or toggle switches is an Explore. format and label may also be functions, from your own client
   component or exported by a "use client" module: format (v) => text, label line and stem (x, y, i) => text, bar (v, i) => text. */
"use client";
import type { RefObject } from "preact";
import { useEffect, useMemo, useRef } from "preact/hooks";
import { drawnInside, drawnMarkLines, placeOf } from "./parts/drawn.ts";

/**
 * What lets the reader pick a bar plot's category (its option's `pick`): `choose(i)` for a click on category i, and the strip of
 * controls under the categories, which plot.js lines up with them.
 */
export interface PlotPick {
	choose(i: number): void;
	strip?: RefObject<HTMLElement>;
}

export interface PlotProps {
	option: PlotOption;
	label: string;
	class?: string;
	id?: string;
	height?: string;
	pick?: PlotPick;
}

/** rem: a bar's row (56 px, for a 25 px bar), and the tall height (theme.css `.chart.tall`), the most bars take. */
const BAR_ROW = 3.5;
const MOST = 34;
/**
 * rem around the rows, as plot.js lays them out (kit/parts/plot/draw.ts): the legend's padding (8 px) with 10 px above the bars
 * and 26 px of value labels below them; the x axis name's line under them (22 px); the y axis name's above (18 px more).
 */
const BAR_FRAME = 2.75;
const X_NAME = 1.375;
const Y_NAME = 1.125;
/** rem of those value labels (21 px), which a bar plot may leave out (valueAxisOut in draw.ts, the same rule). */
const VALUES = 1.3125;
const digits = (v: unknown) => String(v).replace(/\D/g, "").replace(/^0+/, "");
/** Whether a horizontal bar plot leaves out its value axis's labels, as valueAxisOut in kit/parts/plot/draw.ts decides. */
function valueAxisOut({ stack, series = [], marks = [], x }: PlotOption) {
	if (x?.labels !== undefined) {
		return !x.labels;
	}
	const printed = (s: PlotSeries) =>
		s.type === "bar" &&
		(s.label === true || (typeof s.label === "object" && !Array.isArray(s.label)));
	const readable = (m: PlotMark) =>
		[m.x ?? []].flat().every((v) => digits(m.label ?? "").includes(digits(v)));
	return !stack && series.every(printed) && marks.every(readable);
}
/**
 * The height of a horizontal bar plot by its bar count: rows of 3.5rem, up to the tall 34rem, past which the rows get thinner.
 * Other plots take the theme's height, and so does one with a legend, whose rows depend on the width.
 */
function barsHeight(option: PlotOption) {
	const { horizontal, categories, series = [], x, y, legend } = option;
	const legendShown = legend !== false && series.filter((s) => s.name).length > 1;
	if (!(horizontal && categories?.length) || legendShown) {
		return undefined;
	}
	const frame =
		BAR_FRAME +
		(x?.name ? X_NAME : 0) +
		(y?.name ? Y_NAME : 0) -
		(valueAxisOut(option) ? VALUES : 0);
	return `${Math.min(categories.length * BAR_ROW + frame, MOST)}rem`;
}

/**
 * A bar plot's height with its markers' labels on top: the lines they wrap into at the plot's width, which plot.js sets as
 * --plot-mark-lines as it lays them out (PlotDraw's markLines), each a line of label text; `lines` stands in until it draws,
 * the lines pack drew the plot with.
 */
const withMarkLines = (height: string, lines: number) =>
	`calc(${height} + var(--plot-mark-lines, ${lines}) * (var(--size-label) + 4px))`;

/** Where a Plot showing `option` draws, as its props size it: a horizontal bar plot without `height` by its bars (barsHeight). */
export function plotPlace(
	option: PlotOption,
	extra: string | undefined,
	id: string | undefined,
	height: string | undefined,
) {
	// "plot" is what plot.js adds; rendering it keeps a re-render from taking it away.
	const classes = extra ? `chart plot ${extra}` : "chart plot";
	// A height by the bar count takes the height prop's path, so pack's box rules see it as they see an author's.
	const bars = height || classes.split(/\s+/).includes("tall") ? undefined : barsHeight(option);
	const sized = height ?? bars;
	return { classes, sized, bars, place: placeOf(classes, id, sized, Boolean(bars)) };
}

/** The option a plot shows once `patch` is set on it, merged as Plot.set merges (kit/plot.ts): x and y one level deeper. */
const merged = (option: PlotOption, patch: PlotOption): PlotOption => ({
	...option,
	...patch,
	x: { ...option.x, ...patch.x },
	y: { ...option.y, ...patch.y },
});

/**
 * Renders `<div class="chart plot" role="img">` holding the plot as pack drew it, and draws the plot into it in the browser at
 * its size; a changed `option` is applied with set(), and unmounting stops its resize observer. plot.js replaces the element's
 * children, so in the browser the element renders none of its own.
 */
export function Plot({ option, label, class: extra, id, height, pick }: PlotProps) {
	const element = useRef<HTMLDivElement>(null);
	// The latest pick, which the plot made once calls on each click.
	const picking = useRef(pick);
	picking.current = pick;
	// This component's name shadows the kit's global Plot here, so the global is reached through window.
	const handle = useRef<ReturnType<typeof window.Plot.make> | null>(null);
	// What the plot shows: each new option is set on it as a patch, so it is merged into what it showed.
	const showing = useRef<PlotOption | null>(null);
	const shown = useMemo(() => {
		showing.current = showing.current ? merged(showing.current, option) : option;
		return showing.current;
	}, [option]);
	useEffect(() => {
		if (handle.current) {
			handle.current.set(option);
		} else if (element.current) {
			const picker = picking.current && {
				choose: (i: number) => picking.current?.choose(i),
				strip: picking.current.strip?.current ?? null,
			};
			handle.current = window.Plot.make(element.current, option, picker || undefined);
		}
	}, [option]);
	useEffect(
		() => () => {
			handle.current?.dispose();
			handle.current = null;
		},
		[],
	);
	const { classes, place, sized, bars } = plotPlace(shown, extra, id, height);
	// Markers and spans on x take lines on top; a region's label sits in the plot.
	const marked =
		bars && shown.marks?.some((mark) => mark.x !== undefined && !mark.between && mark.label);
	// An object, so a re-render sets the block size alone and leaves the --plot-mark-lines plot.js sets on the element.
	const style = sized && {
		blockSize: marked ? withMarkLines(sized, drawnMarkLines(option, place)) : sized,
	};
	return (
		<div
			ref={element}
			class={classes}
			id={id}
			style={style || undefined}
			role="img"
			aria-label={label}
			{...drawnInside((drawer) => drawer.plot(option, place))}
		/>
	);
}
