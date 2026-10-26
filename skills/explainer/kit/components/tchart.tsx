/* TChart (spike): a TanStack Charts definition drawn as SVG at pack time and hydrated in the browser, in the page theme.
   <TChart id="coefficients" label="What the chart shows" definition={defineChart({ marks: [...], scales: {...}, tooltip })} />
     definition  a TanStack Charts definition (defineChart), built in a "use client" module: its scales and marks hold functions
     label       the accessible name
     id          required: it also prefixes the SVG's ids, so the prerendered markup and the browser's render agree
     class       more classes after "tchart", e.g. "tall"
   Colours default to --c1..--c6 through --ts-chart-1..6; text, axes and grid follow currentColor (var(--ink)). */
"use client";
import type { ChartValue } from "@tanstack/charts";
import { Chart, type ChartProps } from "@tanstack/charts/preact";

export interface TChartProps<
	TDatum = unknown,
	TX extends ChartValue = ChartValue,
	TY extends ChartValue = ChartValue,
> {
	definition: ChartProps<TDatum, TX, TY>["definition"];
	label: string;
	id: string;
	class?: string;
}

/** The width the prerender lays the chart out at: the page's text column, so the first browser layout moves little. */
const INITIAL_WIDTH = 720;

/** Renders the adapter's host with the kit's class; its height comes from CSS (--tchart-height), not the adapter's 320 px. */
export function TChart<TDatum, TX extends ChartValue, TY extends ChartValue>({
	definition,
	label,
	id,
	class: extra,
}: TChartProps<TDatum, TX, TY>) {
	return (
		<div id={id} class={extra ? `tchart ${extra}` : "tchart"}>
			<Chart
				definition={definition}
				ariaLabel={label}
				idPrefix={id}
				initialWidth={INITIAL_WIDTH}
				style={{ height: "var(--tchart-height)" }}
			/>
		</div>
	);
}
