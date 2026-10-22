import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runCli, scratch } from "./support.ts";

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
	expect(checked.stdout).not.toContain("FAIL");
	expect(checked.code).toBe(0);
}, 30_000);
