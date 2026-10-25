/* Plot: small line, stem and bar plots as SVG in the page theme, no ECharts. For zoom, drill-down, heatmaps or sankey use Chart.
   <Plot label="Calls per day" option={{ categories: ["Mon", "Tue"], series: [{ name: "Calls", type: "bar", data: [12, 18] }] }} />
     option  { series, categories, horizontal, stack, x, y, legend }
       series  [{ name, type, data, color, width, dash, label }]
         type "line"   data [[x, y], ...]; width in px (default 2), dash: true for dashed
         type "stem"   data [[x, y], ...]: a drop line from 0 with a dot, for spectra and samples
         type "bar"    data [v, ...], one per category
         color  any CSS colour, default var(--c1)..var(--c6) in turn; "var(--accent)" and color-mix(...) work
         name   shown in the legend, whose entries switch the series on and off; a series without a name toggles with the named one before it
         label  prints exact values on the marks: true, a format as below, or one text per point or bar: ["½mA", "A", "½mA"]
       categories  ["A", "B"] makes a bar plot (bars cannot mix with line or stem); horizontal: true runs them down the page,
                   stack: true piles the series (non-negative values) into one bar per category, else they sit side by side. Keep names short.
       x, y   { min, max, step, name, format }  screen axes: in a horizontal bar plot y holds the categories, x the values.
              Range and step are automatic and round; format writes the tick labels and values in the page's lang:
              { digits: 1, unit: "kHz" } (1.5 kHz), { percent: true } (25%), { currency: "EUR", compact: true } (€12K)
       legend false hides the legend (by default it shows when two or more series have a name)
     label   the accessible name (role="img")
     class   more classes after "chart plot", e.g. "tall"
   The plot fills the element at its pixel size and redraws on resize, so text stays 13 px from phone to desktop; light and dark switch
   with no redraw. A new option redraws at once: series is replaced whole, other keys merge into the plot (x and y one level deeper).
   Exact values without hovering: label on stems and bars, a readout in the page for lines; each bar (zero ones too) also has a title.
   A label on a stacked segment is left out when it does not fit: when every exact value must stay visible, add a readout or table.
   Values outside min and max sit on the edge. A vertical marker is a two-point dashed line series.
   A plot a slider, choice or toggle switches is an Explore. format and label may also be functions, from your own client
   component or exported by a "use client" module: format (v) => text, label stem (x, y, i) => text, bar (v, i) => text. */
"use client";
import { useEffect, useRef } from "preact/hooks";

export interface PlotProps {
	option: PlotOption;
	label: string;
	class?: string;
	id?: string;
}

/**
 * Renders `<div class="chart plot" role="img">` and draws the plot into it in the browser; a changed `option` is applied with
 * set(), and unmounting stops its resize observer. plot.js replaces the element's children, so the element renders none.
 */
export function Plot({ option, label, class: extra, id }: PlotProps) {
	const element = useRef<HTMLDivElement>(null);
	// This component's name shadows the kit's global Plot here, so the global is reached through window.
	const handle = useRef<ReturnType<typeof window.Plot.make> | null>(null);
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
	return (
		<div
			ref={element}
			// "plot" is what plot.js adds; rendering it keeps a re-render from taking it away.
			class={extra ? `chart plot ${extra}` : "chart plot"}
			id={id}
			role="img"
			aria-label={label}
		/>
	);
}
