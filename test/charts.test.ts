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

test("a wrapped horizontal legend leaves the grid clear on phones", async () => {
	const page = PAGE.replace(
		/var contract =[\s\S]*<\/script>/,
		`var contract = new Promise((done) => Charts.make(document.getElementById("c"), {
		legend: { textStyle: { fontSize: 36 } },
		xAxis: { type: "category", data: ["a", "b"] }, yAxis: {},
		series: ["First", "Second", "Third", "Fourth"].map(name => ({ name, type: "bar", data: [1, 2] }))
	}, chart => {
		const model = chart.getModel();
		const view = chart.getViewOfComponentModel(model.getComponent("legend"));
		const bounds = view.group.getBoundingRect();
		const bottom = bounds.y + bounds.height + view.group.y;
		const grid = model.getComponent("grid").coordinateSystem.getRect();
		const top = bounds.y + view.group.y;
		done(model.getComponent("legend").get("bottom") === 15 &&
			(grid.y >= bottom + 8 || top >= grid.y + grid.height + 8) ? [] :
			["legend " + top + "–" + bottom + " overlaps grid " + grid.y + "–" + (grid.y + grid.height)]);
	}));</script>`,
	);
	expect(await packAndRun(dir, "legend-room", page)).toEqual([]);
	const dataset = page.replace(
		'series: ["First", "Second", "Third", "Fourth"].map(name => ({ name, type: "bar", data: [1, 2] }))',
		'dataset: { source: [["Category", "First", "Second", "Third", "Fourth"], ["a", 1, 2, 3, 4], ["b", 2, 3, 4, 5]] }, series: Array.from({length:4}, () => ({type:"bar"}))',
	);
	expect(await packAndRun(dir, "dataset-legend-room", dataset)).toEqual([]);
}, 30_000);

test("legend room follows resize and patches without replacing an author's layout", async () => {
	const output = await packedMdx(
		dir,
		"legend-resize",
		`import { Chart } from "kit";

# Legend resizing

<Chart id="auto" label="Automatic" option={{ grid: { show: true, backgroundColor: "var(--surface)" }, legend: { textStyle: { fontSize: 36 } }, xAxis: { type: "category", data: ["a", "b"] }, yAxis: {}, series: ["First", "Second", "Third", "Fourth"].map(name => ({ name, type: "bar", data: [1, 2] })) }} />
`,
	);
	await inPage(output, async (cdp) => {
		const margin =
			"echarts.getInstanceByDom(document.getElementById('auto')).getOption().grid[0].bottom";
		expect(await cdp.evaluate(margin)).toBe(80);
		await cdp.send("Emulation.setDeviceMetricsOverride", {
			width: 390,
			height: 844,
			mobile: false,
			deviceScaleFactor: 1,
		});
		expect(await until(cdp, `${margin} > 100`)).toBe(true);
		await cdp.send("Emulation.setDeviceMetricsOverride", {
			width: 1440,
			height: 900,
			mobile: false,
			deviceScaleFactor: 1,
		});
		expect(await until(cdp, `${margin} === 80`)).toBe(true);
		expect(
			await cdp.evaluate(
				"echarts.getInstanceByDom(document.getElementById('auto')).getOption().grid[0].backgroundColor.startsWith('rgb')",
			),
		).toBe(true);
		const result = await cdp.evaluate(
			`(async () => {
			const el = document.getElementById("auto");
			const option = { legend: { textStyle: { fontSize: 48 } }, xAxis: { type: "category", data: ["a", "b"] }, yAxis: {}, series: [{ name: "Load", type: "bar", data: [1, 2] }] };
			let ready;
			const mounted = new Promise(done => ready = done);
			const h = Charts.make(el, option, ready);
			await mounted;
			const bottom = () => h.chart.getOption().grid[0].bottom;
			const initial = bottom();
			const untouched = !('grid' in option);
			h.set({ legend: { textStyle: { fontSize: 12 } } });
			const smaller = bottom();
			h.set({ grid: { top: 20, height: 100 } });
			const grid = h.chart.getOption().grid[0];
			const explicit = { top: grid.top, height: grid.height };
			h.set({ legend: { bottom: 25, textStyle: { fontSize: 48 } } });
			const positionedGrid = h.chart.getOption().grid[0];
			const positioned = { top: positionedGrid.top, height: positionedGrid.height, legendBottom: h.chart.getOption().legend[0].bottom };
			h.set({ grid: [{ bottom: 24, top: 20 }, { bottom: 12, top: 220, height: 100 }] });
			return { initial: initial > 80, smaller, explicit, positioned, untouched, bottoms: h.chart.getOption().grid.map(g => g.bottom) };
		})()`,
			true,
		);
		expect(result).toEqual({
			initial: true,
			smaller: 80,
			explicit: { top: 20, height: 100 },
			positioned: { top: 20, height: 100, legendBottom: 25 },
			untouched: true,
			bottoms: [24, 12],
		});
	});
}, 30_000);

test("effective inherited and responsive legends leave singleton grids clear", async () => {
	const page = PAGE.replace(
		/var contract =[\s\S]*<\/script>/,
		`var contract = (async () => {
		const base = { legend: {}, xAxis: { type: "category", data: ["a", "b"] }, yAxis: {}, grid: {},
			series: ["First", "Second", "Third", "Fourth"].map(name => ({ name, type: "bar", data: [1, 2] })) };
		const cases = [
			{ ...base, textStyle: { fontSize: 60 } },
			{ ...base, media: [{ query: { maxWidth: 500 }, option: { legend: { textStyle: { fontSize: 60 } } } }, { option: { legend: { textStyle: { fontSize: 12 } } } }] },
			{ baseOption: { ...base, xAxis: [base.xAxis], yAxis: [{}], grid: [{}], textStyle: { fontSize: 60 } } },
		];
		const failures = [];
		for (const [index, option] of cases.entries()) {
			const el = document.createElement("div");
			el.style.cssText = "width:356px;height:520px";
			document.querySelector("main").append(el);
			const chart = await new Promise(done => Charts.make(el, option, done));
			for (const width of [356, 1054, 356]) {
				el.style.width = width + "px";
				chart.resize();
				const model = chart.getModel(), legend = model.getComponent("legend");
				const group = chart.getViewOfComponentModel(legend).group;
				const box = group.getBoundingRect().clone();
				box.applyTransform(group.getComputedTransform());
				const grid = model.getComponent("grid").coordinateSystem.getRect();
				if (box.y < grid.y + grid.height + 8) failures.push(index + " at " + width + ": legend " + box.y + " overlaps grid " + (grid.y + grid.height));
			}
			chart.setOption({ grid: [{ top: 20, height: 100 }] });
			const grid = chart.getOption().grid[0];
			if (grid.top !== 20 || grid.height !== 100) failures.push(index + ": direct author layout was overwritten");
		}
		return failures;
	})();</script>`,
	);
	expect(await packAndRun(dir, "effective-legends", page)).toEqual([]);
}, 30_000);

test("legacy legend placement aliases opt out just like right and bottom", async () => {
	const page = PAGE.replace(
		/var contract =[\s\S]*<\/script>/,
		`var contract = (async () => {
		const failures = [];
		for (const key of ["right", "x2", "bottom", "y2"]) {
			const el = document.createElement("div");
			el.style.cssText = "width:356px;height:520px";
			document.querySelector("main").append(el);
			const chart = await new Promise(done => Charts.make(el, {
				legend: { [key]: 25, textStyle: { fontSize: 36 } },
				xAxis: { type: "category", data: ["a", "b"] }, yAxis: {},
				series: ["Region A", "Region B", "Region C", "Region D"].map(name => ({ name, type: "bar", data: [1, 2] }))
			}, done));
			const bottom = chart.getOption().grid[0].bottom;
			if (bottom !== 80) failures.push(key + " changed bottom to " + bottom);
		}
		return failures;
	})();</script>`,
	);
	expect(await packAndRun(dir, "legend-aliases", page)).toEqual([]);
}, 30_000);

test("legend layout preserves silent and deferred ECharts updates", async () => {
	const page = PAGE.replace(
		/var contract =[\s\S]*<\/script>/,
		`var contract = (async () => {
		const el = document.getElementById("c");
		el.style.cssText = "width:356px;height:520px";
		let handle;
		const chart = await new Promise(done => { handle = Charts.make(el, {
			xAxis: { type: "category", data: ["a", "b"] }, yAxis: {},
			series: ["First", "Second", "Third", "Fourth"].map(name => ({ name, type: "bar", data: [1, 2] }))
		}, done); });
		const failures = [];
		try { chart.setOption({ legend: { textStyle: { fontSize: 36 } } }, { lazyUpdate: true, silent: true }); }
		catch (error) { failures.push("lazy legend addition: " + error.message); }
		const frames = async () => { for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame); };
		await frames();
		let renders = 0;
		const rendered = () => renders++;
		chart.getZr().on("rendered", rendered);
		for (const args of [[{ lazyUpdate: true }], [false, true]]) {
			renders = 0;
			chart.setOption({ legend: { textStyle: { fontSize: 48 } } }, ...args);
			if (renders) failures.push("lazy update rendered " + renders + " times before return: " + JSON.stringify(args));
			await frames();
		}
		chart.getZr().off("rendered", rendered);
		const lazyModel = chart.getModel();
		const lazyGroup = chart.getViewOfComponentModel(lazyModel.getComponent("legend")).group;
		const lazyBox = lazyGroup.getBoundingRect().clone(); lazyBox.applyTransform(lazyGroup.getComputedTransform());
		const lazyGrid = lazyModel.getComponent("grid").coordinateSystem.getRect();
		if (lazyBox.y < lazyGrid.y + lazyGrid.height + 8) failures.push("lazy update after reservation overlaps plot");
		let updates = 0;
		const count = () => updates++;
		chart.on("updated", count);
		chart.setOption({ legend: { textStyle: { fontSize: 60 } } }, { silent: true });
		chart.resize({ silent: true });
		chart.off("updated", count);
		if (updates) failures.push("silent changes emitted " + updates + " updates");
		let queued = false;
		chart.on("updated", () => { if (!queued) { queued = true;
			chart.setOption({ legend: { textStyle: { fontSize: 60 } } }, { lazyUpdate: true, silent: true });
		} });
		chart.setOption({ legend: { textStyle: { fontSize: 12 } } }, false, true);
		await frames();
		const model = chart.getModel();
		const group = chart.getViewOfComponentModel(model.getComponent("legend")).group;
		const box = group.getBoundingRect().clone(); box.applyTransform(group.getComputedTransform());
		const grid = model.getComponent("grid").coordinateSystem.getRect();
		if (box.y < grid.y + grid.height + 8) failures.push("deferred legend overlaps plot");
		handle.dispose();
		const warn = console.warn; console.warn = () => {};
		try { chart.setOption({}); chart.resize(); }
		catch (error) { failures.push("disposed chart: " + error.message); }
		finally { console.warn = warn; }
		return failures;
	})();</script>`,
	);
	expect(await packAndRun(dir, "legend-update-semantics", page)).toEqual([]);
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
	// Guard against ECharts shipped uncompressed or twice, not a page-size budget.
	expect(statSync(output).size).toBeLessThan(1_000_000);
	const state = await inPage(output, (cdp) =>
		cdp.evaluate(`({
			live: Boolean(echarts.getInstanceByDom(document.querySelector(".chart"))),
			drawn: document.querySelectorAll(".chart-drawn").length,
		})`),
	);
	expect(state).toEqual({ live: true, drawn: 0 });
}, 30_000);
