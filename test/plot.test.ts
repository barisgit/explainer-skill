import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runKitPart } from "../skills/explainer/src/kit.ts";
import {
	act,
	inPage,
	packAndRun,
	packedMdx,
	packHtml,
	pageContract,
	runCli,
	scratch,
} from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><h1>Plots</h1>
<div class="chart" id="line"></div><div class="chart" id="bars"></div>
<script src="kit:plot.js"></script>
<script>
const line = Plot.make(document.getElementById("line"), {
	series: [{ name: "a", data: [[0, 0], [1, 2]] }, { name: "b", type: "stem", data: [[0.5, 1]] }],
});
line.set({ y: { min: 0, max: 3 } });
Plot.make(document.getElementById("bars"), {
	categories: ["x", "y"], horizontal: true, stack: true,
	series: [{ name: "p", type: "bar", data: [1, 2], label: true }, { name: "q", type: "bar", data: [2, 1] }],
});
if (document.querySelectorAll("svg .bar").length !== 4) throw new Error("bars not drawn");
</script></body></html>`;

test("a page that uses only plot.js carries no ECharts and draws without errors", async () => {
	const input = dir.write("plots.html", PAGE);
	const output = dir.path("plots.out.html");

	const packed = await packHtml(input, output);
	const checked = await runCli([
		"check",
		output,
		"--quick",
		"--view",
		"none",
		"--out",
		dir.path("shots"),
	]);

	expect(packed.error).toBe("");
	expect(readFileSync(output, "utf8")).not.toContain("Apache ECharts");
	expect(checked.code).toBe(0);
}, 30_000);

const BARS = [100, 50, 0];
const BAR_PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><h1>Bars</h1>
<figure class="fig"><div class="chart" id="h"></div></figure>
<figure class="fig"><div class="chart" id="v"></div></figure>
<figure class="fig"><div class="chart" id="l"></div></figure>
<script src="kit:plot.js"></script>
<script>
const bars = { categories: ["A", "B", "C"], series: [{ type: "bar", data: ${JSON.stringify(BARS)}, label: true }] };
Plot.make(document.getElementById("h"), { ...bars, horizontal: true });
Plot.make(document.getElementById("v"), bars);
Plot.make(document.getElementById("l"), { series: [{ type: "line", data: [[NaN, 1], [Infinity, 2]] }] });
const inside = (id) => [...document.querySelectorAll("#" + id + " text.value")].every((t) => {
	const box = t.getBBox(), view = t.ownerSVGElement.viewBox.baseVal;
	return box.x >= 0 && box.y >= 0 && box.x + box.width <= view.width && box.y + box.height <= view.height;
});
const labels = (id) => [...document.querySelectorAll("#" + id + " text.value")].map((t) => t.textContent).join();
${pageContract({
	"horizontal bar labels stay inside the panel": 'inside("h") && labels("h") === "100,50,0"',
	"vertical bar labels stay inside the panel": 'inside("v") && labels("v") === "100,50,0"',
	"a zero bar keeps its title": 'document.querySelectorAll("#h .bar title").length === 3',
	"a line with no finite point draws nothing":
		'document.querySelectorAll("#l path.line").length === 0',
})}
</script></body></html>`;

test("bar labels stay inside the panel and keep zero bars; a line without finite points draws nothing", async () => {
	expect(await packAndRun(dir, "bars", BAR_PAGE)).toEqual([]);
}, 60_000);

const UNLABELLED_PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><h1>Unlabelled</h1>
<figure class="fig"><div class="chart" id="b"></div></figure>
<figure class="fig"><div class="chart" id="s"></div></figure>
<script src="kit:plot.js"></script>
<script>
const showValues = false;
Plot.make(document.getElementById("b"), { categories: ["A", "B"], series: [{ type: "bar", data: [1, 2], label: showValues }] });
Plot.make(document.getElementById("s"), { series: [{ type: "stem", data: [[0, 1], [1, 2]], label: showValues }] });
${pageContract({
	"label: false draws the marks without value text":
		'document.querySelectorAll("#b .bar").length === 2 && document.querySelectorAll("#s .dot").length === 2 && !document.querySelector("text.value")',
})}
</script></body></html>`;

test("label: false draws bars and stems without value text instead of throwing", async () => {
	expect(await packAndRun(dir, "unlabelled", UNLABELLED_PAGE)).toEqual([]);
}, 60_000);

/** plot.js's drawing code as pack runs it (kit/parts/plot/draw.ts), measuring every character 7 px wide. */
const plotDraw = (
	runKitPart("plot/draw.ts", "PlotDraw") as (env: { lang: () => string }) => {
		render(
			option: object,
			W: number,
			H: number,
			width: (s: unknown) => number,
			shown: boolean[],
		): string;
		legendMarkup(option: object, textWidth: (s: unknown) => number, H: number): string;
	}
)({ lang: () => "en" });
const width = (s: unknown) => String(s).length * 7;
const draw = (option: { series: object[] }, W = 600, H = 300) =>
	plotDraw.render(
		option,
		W,
		H,
		width,
		option.series.map(() => true),
	);
/** The lines a drawing has, by class, as [x1, x2, y1, y2]. */
const lines = (svg: string, cls: string) =>
	[
		...svg.matchAll(
			new RegExp(`<line class="${cls}" x1="([^"]+)" x2="([^"]+)" y1="([^"]+)" y2="([^"]+)"`, "g"),
		),
	].map((m) => m.slice(1).map(Number));
/** The texts of a class with their x and y. */
const texts = (svg: string, cls: string) =>
	[
		...svg.matchAll(new RegExp(`<text class="${cls}" x="([^"]+)" y="([^"]+)"[^>]*>([^<]*)<`, "g")),
	].map(([, x, y, text]) => ({ x: Number(x), y: Number(y), text }));

test("a plot's axes carry labels and one quiet baseline at zero, with no gridlines or ticks", () => {
	const wave = draw({
		series: [
			{
				data: [
					[0, -1],
					[1, 1],
					[2, 0.5],
				],
			},
		],
	});
	const bars = draw({
		categories: ["A", "B"],
		horizontal: true,
		series: [{ type: "bar", data: [-1, 3] }],
	} as never);
	for (const svg of [wave, bars]) {
		expect(svg).not.toMatch(/class="(grid|zero)"/);
	}
	// The line plot's baseline runs across at y = 0, in the middle of -1..1; the bars' runs down at x = 0.
	const [across] = lines(wave, "axis");
	expect(lines(wave, "axis")).toHaveLength(1);
	expect(across?.[2]).toBe(across?.[3]);
	expect(across?.[2]).toBeCloseTo((10 + 274) / 2, 0);
	const [down] = lines(bars, "axis");
	expect(lines(bars, "axis")).toHaveLength(1);
	expect(down?.[0]).toBe(down?.[1]);
	// Tick labels stay.
	expect(wave).toContain(">-1<");
	expect(bars).toContain(">A<");
});

test("several named lines with no legend set carry their names at their ends, spread apart and inside the plot", () => {
	const option = {
		series: [
			{
				name: "Rising",
				data: [
					[0, 0],
					[1, 2],
				],
			},
			{
				name: "Also rising",
				data: [
					[0, 1],
					[1, 2],
				],
			},
			{
				name: "Flat",
				data: [
					[0, 1],
					[1, 1],
				],
			},
		],
	};
	const svg = draw(option);
	const ends = texts(svg, "end");
	expect(plotDraw.legendMarkup(option, width, 300)).toBe("");
	expect(ends.map((t) => t.text).sort()).toEqual(["Also rising", "Flat", "Rising"]);
	const ys = ends.map((t) => t.y).sort((a, b) => a - b);
	expect(ys.slice(1).every((y, i) => y - (ys[i] ?? 0) >= 13)).toBe(true);
	for (const t of ends) {
		expect(t.x + width(t.text)).toBeLessThanOrEqual(600);
	}
	// The author's legend wins, and so does one that is off; stems or bars keep the legend.
	expect(plotDraw.legendMarkup({ ...option, legend: true }, width, 300)).not.toBe("");
	expect(texts(draw({ ...option, legend: true } as never), "end")).toEqual([]);
	expect(texts(draw({ ...option, legend: false } as never), "end")).toEqual([]);
	const mixed = { series: [...option.series, { name: "Peaks", type: "stem", data: [[0.5, 1]] }] };
	expect(plotDraw.legendMarkup(mixed, width, 300)).not.toBe("");
	expect(texts(draw(mixed), "end")).toEqual([]);
});

test("names go to the line ends only when they fit a phone figure across and down; otherwise the legend shows", () => {
	const lines = (names: string[]) => ({
		series: names.map((name, i) => ({
			name,
			data: [
				[0, i],
				[1, i + 1],
			],
		})),
	});
	// Two names of about 305 px would leave a 356 px figure no plot: the legend names them, and the plot still draws.
	const long = lines(["A".repeat(44), "B".repeat(44)]);
	expect(plotDraw.legendMarkup(long, width, 300)).not.toBe("");
	expect(texts(draw(long, 356, 280), "end")).toEqual([]);
	expect(draw(long, 356, 280)).toContain('class="line"');
	// Names within 45% of the narrowest figure (129.6 px with their gap, leader room and margin) still sit at the ends.
	const fits = lines(["A".repeat(15), "B".repeat(15)]);
	expect(plotDraw.legendMarkup(fits, width, 300)).toBe("");
	expect(plotDraw.legendMarkup(lines(["A".repeat(16), "B"]), width, 300)).not.toBe("");
	// More names than the plot's height can stack, 16 px apart, take the legend.
	const many = lines(Array.from({ length: 17 }, (_, i) => `n${i}`));
	expect(plotDraw.legendMarkup(many, width, 280)).not.toBe("");
	expect(texts(draw(many, 356, 280), "end")).toEqual([]);
	const ten = lines(Array.from({ length: 10 }, (_, i) => `n${i}`));
	const svg = draw(ten, 356, 280);
	expect(texts(svg, "end")).toHaveLength(10);
	for (const t of texts(svg, "end")) {
		expect(t.y).toBeGreaterThanOrEqual(0);
		expect(t.y).toBeLessThanOrEqual(280);
	}
});

test("a name moved off its line's end is tied to it by a leader; one that stays needs none", () => {
	const svg = draw({
		series: [
			{
				name: "Up",
				data: [
					[0, 0],
					[1, 2],
				],
			},
			{
				name: "Also up",
				data: [
					[0, 1],
					[1, 2],
				],
			},
			{
				name: "Down",
				data: [
					[0, 2],
					[1, 0],
				],
			},
		],
	});
	// "Up" and "Also up" end at one point: one of them moves and gets a leader from that point; "Down" keeps its place.
	expect(lines(svg, "leader")).toHaveLength(1);
	const [leader] = lines(svg, "leader");
	const moved = texts(svg, "end").find((t) => Math.abs(t.y - (leader?.[3] ?? 0)) < 0.5);
	expect(moved).toBeDefined();
	expect(leader?.[2]).not.toBe(leader?.[3]);
});

test("horizontal bars are about 45% of their row, as the approved layouts draw them", () => {
	const svg = plotDraw.render(
		{ categories: ["A", "B", "C"], horizontal: true, series: [{ type: "bar", data: [1, 2, 3] }] },
		600,
		252,
		width,
		[true],
	);
	const heights = [...svg.matchAll(/<rect class="bar"[^>]* height="([^"]+)"/g)].map((m) =>
		Number(m[1]),
	);
	expect(heights).toHaveLength(3);
	for (const h of heights) {
		expect(h).toBeCloseTo(72 * 0.45, 0);
	}
});

test("names at the line ends that a short figure cannot stack give way to the legend", () => {
	const ten = {
		series: Array.from({ length: 10 }, (_, i) => ({
			name: `n${i}`,
			data: [
				[0, i],
				[1, 0],
			],
		})),
	};
	// 160 px leaves 134 px for ten names a line apart: the legend names them, and every name drawn stays in the figure.
	expect(plotDraw.legendMarkup(ten, width, 160)).not.toBe("");
	expect(texts(draw(ten, 600, 160), "end")).toEqual([]);
	expect(plotDraw.legendMarkup(ten, width, 300)).toBe("");
	for (const t of texts(draw(ten, 600, 300), "end")) {
		expect(t.y).toBeGreaterThanOrEqual(6);
	}
});

test("a series switched off in the legend shows again when the legend gives way to names at the ends", async () => {
	const page = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><h1>Plots</h1><div class="chart" id="p"></div>
<script src="kit:plot.js"></script>
<script>
const plot = Plot.make(document.getElementById("p"), {
	series: [{ name: "A", type: "stem", data: [[0, 1]] }, { name: "B", data: [[0, 0], [1, 2]] }],
});
var contract = document.fonts.ready.then(() => {
	document.querySelector("#p .plot-legend button").click();
	plot.set({ series: [{ name: "A", data: [[0, 1], [1, 1]] }, { name: "B", data: [[0, 0], [1, 2]] }] });
	const lines = document.querySelectorAll("#p svg .line").length;
	const legend = document.querySelectorAll("#p .plot-legend button").length;
	return lines === 2 && legend === 0 ? [] : [lines + " lines drawn and " + legend + " legend buttons, not 2 and 0"];
});
</script></body></html>`;
	expect(await packAndRun(dir, "off-legend", page)).toEqual([]);
}, 30_000);

/** A client component whose button replaces its horizontal bar plot's option with a patch, as an Explore frame may. */
const PATCHED_BARS = `"use client";
import { Plot } from "kit";
import { useState } from "preact/hooks";

export function Patched() {
	const [patched, setPatched] = useState(false);
	const option = patched
		? { horizontal: true, categories: ["a"] }
		: { horizontal: true, categories: ["a", "b"], x: { name: "X" }, y: { name: "Y" }, series: [{ type: "bar", data: [1, 2] }] };
	return (
		<div>
			<button type="button" id="patch" onClick={() => setPatched(true)}>Patch</button>
			<Plot id="bars" label="Bars" option={option} />
		</div>
	);
}
`;

test("a bar plot's height follows the option it shows, a patch merged in, with room for both axis names", async () => {
	const output = await packedMdx(
		dir,
		"patched-bars",
		`import { Patched } from "./patched.tsx";\n\n# Patched\n\n<Patched />\n`,
		{ "patched.tsx": PATCHED_BARS },
	);
	const state = `(() => { const el = document.getElementById("bars"); return [el.getBoundingClientRect().height, el.querySelectorAll("svg .bar").length > 0]; })()`;
	await inPage(output, async (cdp) => {
		// Two rows of 72 px, 44 px around them, 22 px for the x name and 18 px for the y name.
		expect(await cdp.evaluate<(number | boolean)[]>(state)).toEqual([228, true]);
		expect(
			await act<(number | boolean)[]>(cdp, `document.getElementById("patch").click()`, state),
		).toEqual([156, true]);
	});
}, 30_000);
