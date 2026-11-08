import { expect, test } from "bun:test";
import { pageDrawer } from "../skills/explainer/src/mdx/draw.ts";

const series = ["Region A", "Region B", "Region C", "Region D"].map((name) => ({
	name,
	type: "bar",
	data: [1, 2],
}));
const base = { legend: {}, xAxis: { type: "category", data: ["a", "b"] }, yAxis: {}, series };
const place = { classes: ["chart"], id: undefined, height: "520px" };

test("a wrap breakpoint inside the phone copy's range leaves the chart live-only", () => {
	const drawer = pageDrawer("en", []);
	for (const placement of [{}, { bottom: 25 }, { top: 8 }]) {
		expect(
			drawer.chart({ ...base, legend: { ...placement, textStyle: { fontSize: 36 } } }, place),
		).toBe("");
	}
});

test("a fixed multirow legend and a single scrolling row retain their drawings", () => {
	const drawer = pageDrawer("en", []);
	for (const legend of [
		{ width: 250, textStyle: { fontSize: 36 } },
		{ type: "scroll", textStyle: { fontSize: 36 } },
	]) {
		expect(drawer.chart({ ...base, legend, grid: { bottom: 240 } }, place)).toContain(
			"chart-drawn",
		);
	}
});

test("negative spacing and variable-height boxes cannot receive an endpoint certificate", () => {
	const drawer = pageDrawer("en", []);
	for (const legend of [
		{ itemGap: -60 },
		{ data: series.map((item, i) => ({ name: item.name, textStyle: { fontSize: (i + 1) * 12 } })) },
	]) {
		expect(drawer.chart({ ...base, legend }, place)).toBe("");
	}
});

test("relative placement with fractional padding cannot hide an adjacent-float wrap", () => {
	const drawer = pageDrawer("en", []);
	expect(
		drawer.chart(
			{
				...base,
				series: series.slice(0, 2).map((item, i) => ({ ...item, name: i ? "B" : "A" })),
				legend: {
					left: "75%",
					itemWidth: 28.5,
					itemHeight: 14,
					itemGap: 0,
					padding: [0, 2.500000000000014],
					textStyle: { width: 1, overflow: "truncate" },
				},
			},
			place,
		),
	).toBe("");
});

test("negative available width and multiline scrolling controls are not certifiable", () => {
	const drawer = pageDrawer("en", []);
	const two = series.slice(0, 2).map((item, i) => ({ ...item, name: i ? "B" : "A" }));
	for (const legend of [
		{
			left: 1000,
			itemWidth: 10,
			itemHeight: 14,
			itemGap: 0,
			textStyle: { width: 1, overflow: "truncate" },
		},
		{
			type: "scroll",
			pageFormatter: "{current}/{total}\nextra\nextra",
			left: "75%",
			itemWidth: 28.5,
			itemHeight: 14,
			itemGap: 0,
			padding: [0, 2.500000000000014],
			textStyle: { width: 1, overflow: "truncate" },
		},
	]) {
		expect(drawer.chart({ ...base, series: two, legend }, place)).toBe("");
	}
});

test("an interior media override cannot hide between stable range endpoints", () => {
	const drawer = pageDrawer("en", []);
	for (const query of [
		{ minWidth: 370, maxWidth: 380 },
		{ minWidth: "370", maxWidth: "380" },
		{ minWidth: 370.1, maxWidth: 370.10000001 },
		{ minWidth: 370, maxWidth: 370 },
		{ minAspectRatio: 370 / 520, maxAspectRatio: 380 / 520 },
		{ minAspectRatio: 370.1 / 520, maxAspectRatio: 370.1 / 520 },
	]) {
		expect(
			drawer.chart(
				{ ...base, media: [{ query, option: { legend: { textStyle: { fontSize: 36 } } } }] },
				place,
			),
		).toBe("");
	}
});
