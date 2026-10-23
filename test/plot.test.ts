import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { packAndRun, pageContract, runCli, scratch } from "./support.ts";

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

	const packed = await runCli(["pack", input, "-o", output]);
	const checked = await runCli([
		"check",
		output,
		"--quick",
		"--view",
		"none",
		"--out",
		dir.path("shots"),
	]);

	expect(packed.code).toBe(0);
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
