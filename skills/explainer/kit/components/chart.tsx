/* Chart: an ECharts chart (kit charts.js) that follows light and dark; pack includes echarts and charts.js when a page uses it.
   <Chart option={{ xAxis: {...}, yAxis: {}, series: [...] }} label="What the chart shows" />
     option  any ECharts option. Colours default to --c1..--c6; write "var(--accent)" for a token. A new option re-applies:
             series follow its list, other components merge into what the chart shows.
     label   the accessible name (role="img")
     class   more classes after "chart", e.g. "tall"
     setup   (chart) => void, run after every (re)mount: chart.on("click", ...). A function, so only from your own "use client" component.
   From the page a Chart takes JSON props only; to drive one from state (a slider, a click), render it in your own client component. */
"use client";
import { useEffect, useRef } from "preact/hooks";

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

/** Renders `<div class="chart" role="img">` and makes the chart on it in the browser; a changed `option` is applied with set(). */
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
	return (
		<div
			ref={element}
			class={extra ? `chart ${extra}` : "chart"}
			id={id}
			role="img"
			aria-label={label}
		/>
	);
}
