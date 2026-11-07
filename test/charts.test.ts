import { afterAll, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { runStep } from "../skills/explainer/src/steps.ts";
import { inPage, packAndRun, packedMdx, packHtml, packMdx, scratch, until } from "./support.ts";

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

test("swapping series with an open tooltip leaves the next hover working", async () => {
	const output = dir.path("tooltip-swap.out.html");
	const packed = await packHtml(
		dir.write(
			"tooltip-swap.html",
			`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><main><h1>Swap series</h1>
<button id="swap">Swap</button><div class="chart" id="c"></div></main>
<script src="kit:echarts.js"></script><script src="kit:charts.js"></script><script>
const series = (id) => [{ id, name: id, type: "bar", stack: "total", data: [2, 3] }];
const h = Charts.make(document.getElementById("c"), {
 tooltip: { trigger: "axis", className: "swap-tip", hideDelay: 0 },
 xAxis: { type: "category", data: ["a", "b"] }, yAxis: {}, series: [...series("Before"), ...series("Removed")]
});
document.getElementById("swap").onclick = () => h.set({ series: series("After") }, ["series"]);
</script></body></html>`,
		),
		output,
	);
	expect(packed.error).toBe("");
	await inPage(output, async (cdp) => {
		const tip = (name: string) => `(() => {
			const el = document.querySelector(".swap-tip");
			return el && getComputedStyle(el).visibility === "visible" && el.textContent.includes(${JSON.stringify(name)});
		})()`;
		expect(await runStep(cdp, "hover:#c", () => "")).toEqual({});
		expect(await until(cdp, tip("Before"))).toBe(true);
		// A keyboard activation swaps while the pointer and the tooltip stay over the chart.
		expect(await runStep(cdp, "focus:#swap", () => "")).toEqual({});
		expect(await runStep(cdp, "key:Enter", () => "")).toEqual({});
		const point = await cdp.evaluate<{ x: number; y: number }>(`(() => {
			const b = document.getElementById("c").getBoundingClientRect();
			return { x: b.x + b.width / 2 + 10, y: b.y + b.height / 2 };
		})()`);
		expect(
			await runStep(cdp, `hover:${Math.round(point.x)},${Math.round(point.y)}`, () => ""),
		).toEqual({});
		expect(await until(cdp, tip("After"))).toBe(true);
	});
}, 30_000);

test("custom series pack without an approximate drawing and render in the browser", async () => {
	const output = await packedMdx(
		dir,
		"custom",
		`import { Chart } from "kit";
import { renderItem } from "./custom.ts";

# Ranges

<Chart label="Ranges" option={{ xAxis: {}, yAxis: {}, series: [{ type: "custom", data: [[1, 2]], itemStyle: { color: "#123456" }, renderItem }] }} />
`,
		{
			"custom.ts": `"use client";
export function renderItem() {
	return { type: "rect", shape: { x: 40, y: 40, width: 120, height: 30 }, style: { fill: "#123456" } };
}`,
		},
	);
	expect(readFileSync(output, "utf8")).not.toContain('class="chart-drawn"');
	const state = await inPage(output, (cdp) =>
		cdp.evaluate(`(() => {
		const chart = echarts.getInstanceByDom(document.querySelector(".chart"));
		const shapes = chart.getZr().storage.getDisplayList();
		return shapes.some(shape => shape.type === "rect" && shape.shape.width === 120 && shape.style.fill === "#123456");
	})()`),
	);
	expect(state).toBe(true);
}, 30_000);

test("pack rejects unbundled series even in responsive options or when drawing is skipped", async () => {
	for (const option of [
		'{ series: { type: "gauge" } }',
		'{ series: [{ type: "gauge" }] }',
		'{ baseOption: { series: [{ type: "gauge" }] } }',
		'{ options: [{ series: [{ type: "gauge" }] }] }',
		'{ media: [{ query: { maxWidth: 639 }, option: { series: [{ type: "gauge" }] } }] }',
	]) {
		const { result } = await packMdx(
			dir,
			"unsupported",
			`import { Chart } from "kit";

# Unsupported

<Chart label="Unsupported" height="50%" option={${option}} />
`,
		);
		expect(result.code).toBe(1);
		expect(result.stderr.trim()).toBe(
			'pack failed:\nECharts series type "gauge" is not bundled; use line, bar, scatter, pie, heatmap, treemap, sankey, sunburst, radar, boxplot, custom instead.',
		);
	}
});

test("pack rejects unbundled series in a non-initial Explore frame, with own or shared controls", async () => {
	for (const shared of [false, true]) {
		const { result } = await packMdx(
			dir,
			"unsupported-frame",
			`import { Explore, Controls } from "kit";

export const frame = (on) => ({ chart: { series: [{ type: on ? "funnel" : "pie", data: [1, 2] }] } });

# Explore

${shared ? '<Controls id="mode" controls={[{ id: "on", label: "Other", toggle: true }]} />' : ""}

<Explore label="Switch" ${shared ? 'use="mode"' : 'controls={[{ id: "on", label: "Other", toggle: true }]}'} frame={frame} />
`,
		);
		expect(result.code).toBe(1);
		expect(result.stderr).toContain('ECharts series type "funnel" is not bundled;');
	}
});

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
