/* Plot: small line, stem and bar plots as SVG in the page theme, no ECharts. For zoom, drill-down, heatmaps or sankey use Chart.
   <Plot label="Calls per day" option={{ categories: ["Mon", "Tue"], series: [{ name: "Calls", type: "bar", data: [12, 18] }] }} />
     option  { series, categories, horizontal, stack, x, y, legend }
       series  [{ name, type, data, color, width, dash, label }]
         type "line"   data [[x, y], ...]; width in px (default 2), dash: true for dashed
         type "stem"   data [[x, y], ...]: a drop line from 0 with a dot, for spectra and samples
         type "bar"    data [v, ...], one per category
         color  any CSS colour, default var(--c1)..var(--c6) in turn; "var(--accent)" and color-mix(...) work
         name   two or more named lines carry their names at their ends, a moved name tied to its line by a leader, when the names
                are short (about 15 characters) and stack down the plot; else names go in the legend, whose entries switch the series
                on and off, a series without a name toggling with the named one before it
         label  prints exact values on the marks: true, a format as below, or one text per point or bar: ["½mA", "A", "½mA"]
       categories  ["A", "B"] makes a bar plot (bars cannot mix with line or stem); horizontal: true runs them down the page,
                   stack: true piles the series (non-negative values) into one bar per category, else they sit side by side. Keep names short.
       x, y   { min, max, step, name, format }  screen axes: in a horizontal bar plot y holds the categories, x the values.
              Range and step are automatic and round; numbers follow the page's lang, and format sets how:
              { digits: 1, unit: "kHz" } (1.5 kHz), { percent: true } (25%), { currency: "EUR", compact: true } (€12K)
       legend true shows the legend, false hides it; unset, it shows for two or more named series unless all are lines
     label   the accessible name (role="img")
     class   more classes after "chart plot", e.g. "tall"
     height  the height: a length in px, rem, vw or vh, or clamp()/min()/max() of them. Size a plot with this, not with CSS on .chart.
             Unset, a horizontal bar plot without a legend is 4.5rem a bar up to the theme's 26rem (thinner rows past it), others
             the theme's height
   The plot fills the element at its pixel size and redraws on resize, so text stays 13 px from phone to desktop; light and dark switch
   with no redraw. pack draws it into the page first, so it shows with scripts off and in print, unless a page rule sizes its element or its
   legend wraps into rows pack cannot count. A new
   option redraws at once: series is replaced whole, other keys merge into the plot (x and y one level deeper).
   Exact values without hovering: label on stems and bars, a readout in the page for lines; each bar (zero ones too) also has a title.
   A label on a stacked segment is left out when it does not fit: when every exact value must stay visible, add a readout or table.
   Values outside min and max sit on the edge. A vertical marker is a two-point dashed line series.
   Axes carry their labels and one quiet baseline at 0, without gridlines or tick marks.
   A plot a slider, choice or toggle switches is an Explore. format and label may also be functions, from your own client
   component or exported by a "use client" module: format (v) => text, label stem (x, y, i) => text, bar (v, i) => text. */
"use client";
import { useEffect, useMemo, useRef } from "preact/hooks";
import { drawnInside, heightStyle, placeOf } from "./parts/drawn.ts";

export interface PlotProps {
	option: PlotOption;
	label: string;
	class?: string;
	id?: string;
	height?: string;
}

/** rem: a bar's row, as the approved layouts set them, and the theme's height (theme.css `.chart`), the most bars take. */
const BAR_ROW = 4.5;
const THEME_HEIGHT = 26;
/**
 * rem around the rows, as plot.js lays them out (kit/parts/plot/draw.ts): the legend's padding (8 px) with 10 px above the bars
 * and 26 px of value labels below them; the x axis name's line under them (22 px); the y axis name's above (18 px more).
 */
const BAR_FRAME = 2.75;
const X_NAME = 1.375;
const Y_NAME = 1.125;

/**
 * The height of a horizontal bar plot by its bar count: rows of 4.5rem, up to the theme's 26rem, past which the rows get
 * thinner. Other plots take the theme's height, and so does one with a legend, whose rows depend on the width.
 */
function barsHeight({ horizontal, categories, series = [], x, y, legend }: PlotOption) {
	const legendShown = legend !== false && series.filter((s) => s.name).length > 1;
	if (!(horizontal && categories?.length) || legendShown) {
		return undefined;
	}
	const frame = BAR_FRAME + (x?.name ? X_NAME : 0) + (y?.name ? Y_NAME : 0);
	return `${Math.min(categories.length * BAR_ROW + frame, THEME_HEIGHT)}rem`;
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
export function Plot({ option, label, class: extra, id, height }: PlotProps) {
	const element = useRef<HTMLDivElement>(null);
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
			handle.current = window.Plot.make(element.current, option);
		}
	}, [option]);
	useEffect(
		() => () => {
			handle.current?.dispose();
			handle.current = null;
		},
		[],
	);
	// "plot" is what plot.js adds; rendering it keeps a re-render from taking it away.
	const classes = extra ? `chart plot ${extra}` : "chart plot";
	// A height by the bar count takes the height prop's path, so pack's box rules see it as they see an author's.
	const sized = height || (classes.split(/\s+/).includes("tall") ? undefined : barsHeight(shown));
	return (
		<div
			ref={element}
			class={classes}
			id={id}
			style={heightStyle(sized)}
			role="img"
			aria-label={label}
			{...drawnInside((drawer) => drawer.plot(option, placeOf(classes, id, sized)))}
		/>
	);
}
