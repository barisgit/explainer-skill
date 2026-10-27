/* Chart: rich interactive charts (zoom, drill-down, heatmap, sankey, ...) with ECharts, themed from the page's CSS tokens and following light and dark.
   pack includes ECharts when a page uses it.
   <Chart option={{ xAxis: {...}, yAxis: {}, series: [...] }} label="What the chart shows" />
     option  any ECharts option. Colours default to --c1..--c6; write "var(--accent)" for a token. A new option re-applies:
             series follow its list, other components merge into what the chart shows.
     label   the accessible name (role="img")
     class   more classes after "chart", e.g. "tall"
     setup   (chart) => void, run after every (re)mount: chart.on("click", ...).
   Colours: write "var(--accent)" or "color-mix(in srgb, var(--accent) 20%, transparent)" in any colour option (color, borderColor,
     fill, colorStops[].color, ...); they are resolved when the chart mounts, so they follow light/dark.
   Formats: a formatter, valueFormatter or labelFormatter may be JSON: { digits: 1, unit: "min" }, { percent: true },
     { currency: "EUR", compact: true } (written for the page's lang), or one text per data item or tick: ["Low", "", "Peak"].
   Layout: write grid: { top, left, right, bottom } as padding; axis labels stay inside it, so margins of 8 to 24 px are enough.
     Do not write grid.containLabel: ECharts 6 logs a warning for it on every chart; check reports it. For a layout that changes
     with the width, write media: [{ query: { maxWidth: 639 }, option: { grid: { top: 112 } } }]; what pack draws follows it.
   pack draws the chart into the page as SVG, shown until ECharts draws it, with scripts off and in print. The option's functions
   run in pack too: a chart whose functions fail there (reading the page, say) is left to ECharts, as is one whose height or
   colours pack cannot tell exactly, and what setup changes.
   A Chart in a hidden view mounts when it is first shown; one your component stops rendering is disposed. The page's colour
   scheme changing remounts the chart: zoom and legend state reset. Reduced motion turns animation off.
   From the page a Chart takes JSON, and functions (setup, a formatter) a "use client" module exports. A chart a slider, choice
   or toggle switches is an Explore; for anything more (a click that changes the page), render it in your own client component. */
"use client";
import { useEffect, useRef } from "preact/hooks";
import { drawnInside, placeOf } from "./parts/drawn.ts";

export interface ChartProps {
	option: ChartOption;
	label: string;
	class?: string;
	id?: string;
	setup?: (chart: ECharts) => void;
}

/**
 * A copy of the plain objects and arrays in an option, sharing everything else (functions included). Charts.make keeps the
 * option it gets and merges later patches into it, so the props, and data a page imports, must not be that object.
 */
function copy<T>(value: T): T;
function copy(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(copy);
	}
	if (
		value !== null &&
		typeof value === "object" &&
		Object.getPrototypeOf(value) === Object.prototype
	) {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]));
	}
	return value;
}

/**
 * Renders `<div class="chart" role="img">` holding the chart as pack drew it, and makes the live chart on it in the browser,
 * which takes the drawn one's place; a changed `option` is applied with set(), and unmounting disposes the chart.
 */
export function Chart({ option, label, class: extra, id, setup }: ChartProps) {
	const element = useRef<HTMLDivElement>(null);
	const handle = useRef<ChartHandle | null>(null);
	// The latest setup runs on every remount, without re-applying the option when an inline setup changes identity.
	const latestSetup = useRef(setup);
	latestSetup.current = setup;
	useEffect(() => {
		if (handle.current) {
			handle.current.set(copy(option), ["series"]);
		} else if (element.current) {
			handle.current = Charts.make(element.current, copy(option), (chart) =>
				latestSetup.current?.(chart),
			);
		}
	}, [option]);
	// A Chart your component stops rendering takes its ECharts instance and observers with it.
	useEffect(
		() => () => {
			handle.current?.dispose();
			handle.current = null;
		},
		[],
	);
	const classes = extra ? `chart ${extra}` : "chart";
	return (
		<div
			ref={element}
			class={classes}
			id={id}
			role="img"
			aria-label={label}
			{...drawnInside((drawer) => drawer.chart(copy(option), placeOf(classes, id)))}
		/>
	);
}
