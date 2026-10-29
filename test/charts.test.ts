import { afterAll, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { inPage, packAndRun, packedMdx, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/**
 * A bar series whose data starts with a plain number and then has an item with a token colour. The contract resolves in setup, when
 * the chart mounts, which waits for the chart's font.
 */
const PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><main><h1>Charts</h1><div class="chart" id="c"></div></main>
<script src="kit:echarts.js"></script><script src="kit:charts.js"></script>
<script>
var contract = new Promise((found) => Charts.make(document.getElementById("c"), {
	xAxis: { type: "category", data: ["a", "b"] },
	yAxis: { type: "value" },
	series: [{ type: "bar", data: [1, { value: 2, itemStyle: { color: "var(--c3)" } }] }],
}, (chart) => {
	const color = chart.getOption().series[0].data[1].itemStyle.color;
	found(/^rgba?\\(/.test(color) ? [] : ["a token colour resolves in an item after a plain number: " + color]);
}));
</script></body></html>`;

test("colour tokens resolve in any element of a series' data, not only when it starts with an object", async () => {
	expect(await packAndRun(dir, "mixed", PAGE)).toEqual([]);
}, 30_000);

test("a page with a Chart carries ECharts compressed, and the live chart takes the drawn one's place once it has unpacked", async () => {
	const output = await packedMdx(
		dir,
		"packed",
		`import { Chart } from "kit";

# Bars

<Chart label="Bars" option={{ xAxis: { type: "category", data: ["a", "b"] }, yAxis: {}, series: [{ type: "bar", data: [1, 2] }] }} />
`,
	);
	const html = readFileSync(output, "utf8");
	// The plain runtime ends with the line that defines the global; the page has the packed copy and the licence comment instead.
	expect(html).not.toContain("globalThis,{echarts");
	expect(html).toContain("/* echarts: Apache ECharts");
	expect(html).toMatch(/<script data-deflate="[A-Za-z0-9+/=]+">/);
	expect(statSync(output).size).toBeLessThan(600_000);
	const state = await inPage(output, (cdp) =>
		cdp.evaluate(`({
			live: Boolean(echarts.getInstanceByDom(document.querySelector(".chart"))),
			drawn: document.querySelectorAll(".chart-drawn").length,
		})`),
	);
	expect(state).toEqual({ live: true, drawn: 0 });
}, 30_000);
