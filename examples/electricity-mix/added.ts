/* The page's one figure form: a place's yearly change in generation as a muted column, the wind-and-solar part of it an
   accent column in front. Overlaid rather than stacked, so a year that shrank while wind and solar grew (2009, 2020)
   still draws both true. Plot cannot overlay or stack mixed signs, hence Chart. The columns cover the last twenty years,
   so a label every fifth year falls on the last one. */
import { fmt, type Place, steps, Y1 } from "./model.ts";

const tenth = (v: number) => Math.round(v * 10) / 10;
/** Years shown before the last, and the years between two axis labels: a multiple, so the last year carries one. */
const SPAN = 20;
const EVERY = 5;

/** The Chart option for a place; the last year's two values are printed beside its columns. */
export function addedOption(place: Place) {
	const rows = steps(place).filter((r) => r.year >= Y1 - SPAN);
	const last = rows.length - 1;
	const end = rows.at(-1);
	const label = (text: string) => ({
		show: true,
		position: "right" as const,
		align: "left",
		formatter: text,
	});
	const column = (
		name: string,
		color: string,
		value: (r: (typeof rows)[number]) => number,
		mark: ReturnType<typeof label>,
	) => ({
		name,
		type: "bar",
		barGap: "-100%",
		itemStyle: { color },
		data: rows.map((r, i) =>
			i === last ? { value: tenth(value(r)), label: mark } : tenth(value(r)),
		),
	});
	return {
		grid: { top: 12, left: 8, right: 116, bottom: 8 },
		xAxis: {
			type: "category",
			data: rows.map((r) => String(r.year)),
			axisLabel: { interval: EVERY - 1 },
		},
		yAxis: { type: "value" },
		series: [
			column(
				"Generation added",
				"var(--rule-strong)",
				(r) => r.total,
				label(`${fmt(end?.total ?? 0)} total`),
			),
			column(
				"Wind and solar",
				"var(--accent)",
				(r) => r.windSolar,
				label(`${fmt(end?.windSolar ?? 0)} wind and solar`),
			),
		],
	};
}
