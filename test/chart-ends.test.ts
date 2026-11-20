/* A Chart's names at its line ends: crowded ones move apart there, never into a legend; pack says which cannot stay, and why named lines carry none (#190). */
import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runKitPart } from "../skills/explainer/src/kit.ts";
import { packMdx, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

test("pack warns about a Chart line whose name cannot stay at its end, naming the series and the width, and still draws every name (#190)", async () => {
	// Three lines that end at one value: the middle name stays, the outer two move a whole line off their ends.
	const option = `{ xAxis: { type: "category", data: ["a", "b", "c"] }, yAxis: {}, series: [{ name: "Rising", type: "line", data: [0, 1, 2] }, { name: "Also rising", type: "line", data: [1, 1.5, 2] }, { name: "Flat", type: "line", data: [2, 2, 2] }] }`;
	const { result, output } = await packMdx(
		dir,
		"chart-crowd",
		`import { Chart } from "kit";\n\n# Ends\n\n<Chart id="c" label="Ends" option={${option}} />\n`,
	);
	expect(result.code).toBe(0);
	for (const width of [1054, 527, 356]) {
		const named = [
			...result.stdout.matchAll(new RegExp(`Chart line "([^"]+)"[^\\n]* at ${width} px wide`, "g")),
		];
		expect(named.length, `${width} px`).toBe(2);
	}
	const html = readFileSync(output, "utf8");
	for (const name of ["Rising", "Also rising", "Flat"]) {
		expect(html).toContain(`>${name}</text>`);
	}
});

test("a Chart's named lines carry their names beside an author's grid bounds, and pack says why when they cannot (#190)", async () => {
	const series = `series: [{ name: "Postgres", type: "line", data: [[0, 1], [36, 3]] }, { name: "ClickHouse", type: "line", data: [[0, 2], [36, 1]] }]`;
	const page = (option: string) =>
		`import { Chart } from "kit";\n\n# Ends\n\n<Chart id="c" label="Ends" option={{ ${option} }} />\n`;
	// An author's grid, as a fresh author wrote it: names at the ends in every copy, with nothing to warn about.
	const bounded = await packMdx(
		dir,
		"chart-grid",
		page(
			`grid: { left: 8, bottom: 24 }, xAxis: { type: "value", min: 0 }, yAxis: { min: 0 }, ${series}`,
		),
	);
	expect(bounded.result.code).toBe(0);
	expect(bounded.result.stdout).not.toContain("warning");
	const html = readFileSync(bounded.output, "utf8");
	for (const name of ["Postgres", "ClickHouse"]) {
		expect(html.split(`>${name}</text>`).length - 1, name).toBe(3);
	}
	// Zoom moves the ends, so the kit cannot name the lines there: pack says so rather than leave them unnamed.
	const zoomed = await packMdx(
		dir,
		"chart-zoom",
		page(`xAxis: { type: "value" }, yAxis: {}, dataZoom: [{ type: "inside" }], ${series}`),
	);
	expect(zoomed.result.stdout).toMatch(
		/Chart lines "Postgres", "ClickHouse" carry no names: .*dataZoom.*legend/,
	);
	// An author's legend names them.
	const legend = await packMdx(
		dir,
		"chart-legend",
		page(
			`legend: {}, xAxis: { type: "value" }, yAxis: {}, dataZoom: [{ type: "inside" }], ${series}`,
		),
	);
	expect(legend.result.code).toBe(0);
	expect(legend.result.stdout).not.toContain("carry no names");
});

test("pack explains why a fixed grid width leaves Chart lines without end names (#190)", async () => {
	const { result, output } = await packMdx(
		dir,
		"chart-grid-width",
		`import { Chart } from "kit";\n\n# Ends\n\n<Chart label="Ends" option={{ grid: { left: 8, width: "95%" }, xAxis: { type: "category", data: ["a", "b"] }, yAxis: {}, series: [{ name: "Rising", type: "line", data: [0, 2] }, { name: "Falling", type: "line", data: [2, 0] }] }} />\n`,
	);
	expect(result.code).toBe(0);
	expect(result.stdout).toMatch(/Chart lines "Rising", "Falling" carry no names: .*grid width/);
	expect(readFileSync(output, "utf8")).not.toMatch(/>(Rising|Falling)<\/text>/);
});

test("Chart end names stay inside a grid too short to space them, and pack warns that they are unclear (#190)", async () => {
	const { result, output } = await packMdx(
		dir,
		"chart-short-grid",
		`import { Chart } from "kit";\n\n# Ends\n\n<Chart label="Ends" option={{ grid: { top: 60, height: 10, outerBoundsMode: "none" }, xAxis: { type: "category", data: ["a", "b"] }, yAxis: { min: 0, max: 2 }, series: [{ name: "Rising", type: "line", data: [0, 1] }, { name: "Falling", type: "line", data: [2, 1] }] }} />\n`,
	);
	expect(result.code).toBe(0);
	const html = readFileSync(output, "utf8");
	const centers = [
		...html.matchAll(/transform="translate\([\d.]+ ([\d.]+)\)"[^>]*>(Rising|Falling)<\/text>/g),
	];
	expect(centers.map((m) => Number(m[1]))).toHaveLength(6);
	expect(centers.map((m) => Number(m[1])).filter((y) => y < 60 || y > 70)).toEqual([]);
	for (const name of ["Rising", "Falling"]) {
		expect(result.stdout).toContain(`Chart line "${name}"`);
	}
});

/** kit/parts/charts/option.ts as pack runs it, with colours passed through and labels 7 px a character. */
const chartsOption = (
	runKitPart("charts/option.ts", "ChartsOption") as (env: {
		color: (c: string) => string;
		lang: () => string;
	}) => {
		endNames(option: object, width: (text: string) => number): object | undefined;
		unnamed(option: object): string | undefined;
	}
)({ color: (c) => c, lang: () => "en" });
const TWO_LINES = {
	xAxis: { type: "category", data: ["a", "b"] },
	yAxis: {},
	series: [
		{ name: "One", type: "line", data: [0, 1] },
		{ name: "Two", type: "line", data: [1, 0] },
	],
};

test("names at the line ends only where the kit knows their text and nothing lays labels out", () => {
	const ends = (option: object) => chartsOption.endNames(option, (t) => t.length * 7) !== undefined;
	expect(ends(TWO_LINES)).toBe(true);
	const series = (extra: object) => TWO_LINES.series.map((s) => ({ ...s, ...extra }));
	// An authored labelLayout, as an object or a function, would move or keep the names where the kit cannot see.
	expect(ends({ ...TWO_LINES, series: series({ labelLayout: { hideOverlap: true } }) })).toBe(
		false,
	);
	expect(ends({ ...TWO_LINES, series: series({ labelLayout: () => ({}) }) })).toBe(false);
	// Room is measured at ECharts' 12 px label: a text style of the author's sizes the names otherwise.
	expect(ends({ ...TWO_LINES, textStyle: { fontSize: 32 } })).toBe(false);
	// The author's grid bounds leave the names where they are: no legend needs their room (#190).
	expect(ends({ ...TWO_LINES, grid: { left: 8, bottom: 24 } })).toBe(true);
	expect(ends({ ...TWO_LINES, grid: { right: 24 } })).toBe(true);
	// An axis min or max that clips a line puts its name where the line meets the edge rather than at its last point; one
	// that holds every point clips nothing.
	expect(ends({ ...TWO_LINES, xAxis: { ...TWO_LINES.xAxis, max: 0.5 } })).toBe(false);
	expect(ends({ ...TWO_LINES, yAxis: { min: 0.2 } })).toBe(false);
	expect(ends({ ...TWO_LINES, yAxis: { min: 0, max: "dataMax" } })).toBe(true);
	expect(ends({ ...TWO_LINES, xAxis: { ...TWO_LINES.xAxis, min: 0, max: 1 } })).toBe(true);
	const xy = (data: number[][]) => ({ name: "A", type: "line", data });
	const values = { xAxis: { type: "value", min: 0, max: 36 }, yAxis: { min: 0 } };
	expect(
		ends({
			...values,
			series: [
				xy([
					[0, 1],
					[36, 2],
				]),
				{
					...xy([
						[0, 2],
						[36, 3],
					]),
					name: "B",
				},
			],
		}),
	).toBe(true);
	expect(
		ends({
			...values,
			series: [
				xy([
					[0, 1],
					[40, 2],
				]),
				{
					...xy([
						[0, 2],
						[36, 3],
					]),
					name: "B",
				},
			],
		}),
	).toBe(false);
	// Zoom moves the ends as the reader zooms.
	expect(ends({ ...TWO_LINES, dataZoom: [{ type: "inside" }] })).toBe(false);
	// A reversed x axis puts the ends on the left.
	expect(ends({ ...TWO_LINES, xAxis: { ...TWO_LINES.xAxis, inverse: true } })).toBe(false);
	// Pack says why named lines go unnamed; a legend or end labels of the author's name them.
	expect(chartsOption.unnamed({ ...TWO_LINES, dataZoom: [{ type: "inside" }] })).toBe(
		"its dataZoom",
	);
	expect(chartsOption.unnamed({ ...TWO_LINES, yAxis: { min: 0.2 } })).toBe(
		"a y axis min or max that cuts a line short",
	);
	expect(chartsOption.unnamed({ ...TWO_LINES, legend: {}, dataZoom: [] })).toBeUndefined();
	expect(chartsOption.unnamed(TWO_LINES)).toBeUndefined();
});

test("an axis bound is compared with the lines as ECharts places them: a category by its place, a stacked line's y not at all (#190)", () => {
	const ends = (option: object) => chartsOption.endNames(option, (t) => t.length * 7) !== undefined;
	// Bounds named by category hold both points, so the names stay at the ends.
	expect(ends({ ...TWO_LINES, xAxis: { ...TWO_LINES.xAxis, min: "a", max: "b" } })).toBe(true);
	expect(ends({ ...TWO_LINES, xAxis: { ...TWO_LINES.xAxis, max: "a" } })).toBe(false);
	// Stacked lines end at their sum, which the kit does not add up: a y bound over them is not called a cut.
	const stacked = {
		...TWO_LINES,
		yAxis: { max: 6 },
		series: TWO_LINES.series.map((s) => ({ ...s, stack: "all", data: [4, 4] })),
	};
	expect(ends(stacked)).toBe(false);
	expect(chartsOption.unnamed(stacked)).toContain("cannot compare");
});

test("lines named in a baseOption carry no names at their ends, and pack says why (#190)", () => {
	const based = { baseOption: TWO_LINES, media: [] };
	expect(chartsOption.endNames(based, (t) => t.length * 7)).toBeUndefined();
	expect(chartsOption.unnamed(based)).toContain("baseOption");
	expect(chartsOption.unnamed({ baseOption: { ...TWO_LINES, legend: {} } })).toBeUndefined();
});

test("pack leaves an author's own end labels where the author put them (#190)", async () => {
	const label = (offset: string) => `endLabel: { show: true, formatter: "{a}", offset: ${offset} }`;
	// "Two" ends where "One" does, so a spread would move one of them off the offset its author gave it.
	const own = `legend: {}, xAxis: { type: "category", data: ["a", "b"] }, yAxis: {}, series: [{ name: "One", type: "line", data: [0, 2], ${label("[25, 70]")} }, { name: "Two", type: "line", data: [1, 2], ${label("[0, 0]")} }]`;
	const page = (option: string) =>
		`import { Chart } from "kit";\n\n# Ends\n\n<Chart id="c" label="Ends" option={{ ${option} }} />\n`;
	const { result, output } = await packMdx(dir, "chart-own-ends", page(own));
	expect(result.code).toBe(0);
	expect(result.stdout).not.toContain("ends too near");
	// Each end label's place, which ECharts writes as its transform: the same as with nothing to spread them from.
	const places = (html: string) =>
		[...html.matchAll(/transform="([^"]+)"[^>]*>(?:One|Two)<\/text>/g)].map((m) => m[1]);
	const alone = await packMdx(
		dir,
		"chart-own-ends-alone",
		page(own.replace("data: [1, 2]", "data: [2, 0]")),
	);
	const [drawn, apart] = [
		places(readFileSync(output, "utf8")),
		places(readFileSync(alone.output, "utf8")),
	];
	expect(drawn.length).toBeGreaterThan(6);
	// "One"'s labels, legend and end, sit where they sit when no other line ends near it.
	const ones = (html: string) =>
		[...html.matchAll(/transform="([^"]+)"[^>]*>One<\/text>/g)].map((m) => m[1]);
	expect(ones(readFileSync(output, "utf8"))).toEqual(ones(readFileSync(alone.output, "utf8")));
	expect(apart.length).toBe(drawn.length);
});

test("category bounds and category data are read alike, so bounds that hold every point keep the names (#190)", () => {
	const ends = (option: object) => chartsOption.endNames(option, (t) => t.length * 7) !== undefined;
	const tuples = (bounds: object, data: unknown[] = ["a", "b", "c", "d"]) => ({
		xAxis: { type: "category", data, ...bounds },
		yAxis: {},
		series: ["One", "Two"].map((name, k) => ({
			name,
			type: "line",
			data: [
				["b", k],
				["c", k + 1],
			],
		})),
	});
	expect(ends(tuples({ min: "b", max: "c" }))).toBe(true);
	expect(ends(tuples({ max: "b" }))).toBe(false);
	expect(chartsOption.unnamed(tuples({ max: "b" }))).toContain("cuts a line short");
	const styled = ["a", { value: "b", textStyle: { fontWeight: "bold" } }, { value: "c" }, "d"];
	expect(ends(tuples({ min: "b", max: "c" }, styled))).toBe(true);
	expect(chartsOption.unnamed(tuples({ max: "b" }, styled))).toContain("cuts a line short");
});

test("axis bounds ignore undrawable line points with an empty coordinate (#190)", () => {
	const option = {
		xAxis: { type: "value", max: 10 },
		yAxis: { type: "value", max: 10 },
		series: [
			{
				name: "Rising",
				type: "line",
				data: [
					[0, 0],
					[8, 4],
					[99, null],
				],
			},
			{
				name: "Falling",
				type: "line",
				data: [
					[0, 8],
					[8, 2],
					["-", 99],
				],
			},
		],
	};
	expect(chartsOption.unnamed(option)).toBeUndefined();
	expect(chartsOption.endNames(option, (t) => t.length * 7)).toBeDefined();
	expect(
		chartsOption.unnamed({
			...option,
			series: option.series.map((s) => ({ ...s, data: [...s.data, [99, 1]] })),
		}),
	).toContain("an x axis min or max that cuts a line short");
});

test("pack names the lines of a baseOption it cannot name at their ends (#190)", async () => {
	const { result } = await packMdx(
		dir,
		"chart-base",
		`import { Chart } from "kit";\n\n# Ends\n\n<Chart id="c" label="Ends" option={{ baseOption: ${JSON.stringify(TWO_LINES)}, media: [] }} />\n`,
	);
	expect(result.stdout).toContain('Chart lines "One", "Two" carry no names: its baseOption');
});
