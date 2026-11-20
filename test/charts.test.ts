import { afterAll, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { runKitPart } from "../skills/explainer/src/kit.ts";
import { pageDrawer } from "../skills/explainer/src/mdx/draw.ts";
import { runStep } from "../skills/explainer/src/steps.ts";
import {
	act,
	DESKTOP,
	FRAMES,
	inPage,
	packAndRun,
	packedMdx,
	packHtml,
	packMdx,
	pageContract,
	scratch,
	until,
} from "./support.ts";

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

test("colour tokens resolve where the chart is, so a block that sets its own accent keeps it after the live chart mounts", async () => {
	const page = PAGE.replace(
		'<div class="chart" id="c"></div>',
		'<div style="--accent: #123456"><div class="chart" id="c"></div></div>',
	)
		.replace('itemStyle: { color: "var(--c3)" }', 'itemStyle: { color: "var(--accent)" }')
		.replace("/^rgba?\\(/.test(color) ? []", 'color.replace(/\\s/g, "") === "rgb(18,52,86)" ? []');
	expect(page).toContain("rgb(18,52,86)");
	expect(await packAndRun(dir, "scoped", page)).toEqual([]);
}, 30_000);

test("a chart in a block with its own ink still remounts when the page's scheme changes", async () => {
	const page = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><main><h1>Charts</h1><div style="--ink: #123456"><div class="chart" id="c"></div></div></main>
<script src="kit:echarts.js"></script><script src="kit:charts.js"></script>
<script>
let mounts = 0;
var contract = new Promise((found) => Charts.make(document.getElementById("c"), {
	xAxis: { type: "category", data: ["a", "b"] },
	yAxis: { type: "value" },
	series: [{ type: "bar", data: [1, 2] }],
}, () => {
	mounts += 1;
	const html = document.documentElement;
	if (mounts === 1) {
		html.dataset.scheme = matchMedia("(prefers-color-scheme: dark)").matches ? "light" : "dark";
		setTimeout(() => {
			html.dataset.scheme = html.dataset.scheme === "dark" ? "light" : "dark";
			setTimeout(() => found(mounts === 3 ? [] : ["two scheme changes remounted the chart " + (mounts - 1) + " times"]), 500);
		}, 500);
	}
}));
</script></body></html>`;
	expect(await packAndRun(dir, "scheme-own-ink", page, { widths: [DESKTOP] })).toEqual([]);
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
			// An author's bottom smaller than the legend's room would put the legend over the axis labels (#257): the room wins.
			h.set({ grid: { bottom: 24 } });
			const authored = bottom();
			// A larger bottom as a percentage stays as written.
			h.set({ grid: { bottom: "40%" } });
			const percent = bottom();
			h.set({ grid: { top: 20, height: 100 } });
			const grid = h.chart.getOption().grid[0];
			const explicit = { top: grid.top, height: grid.height };
			// Clearing the height gives the legend its room back.
			h.set({ grid: { top: 65, height: null, bottom: 12 } });
			const cleared = bottom();
			h.set({ grid: { top: 20, height: 100 } });
			h.set({ legend: { bottom: 25, textStyle: { fontSize: 48 } } });
			const positionedGrid = h.chart.getOption().grid[0];
			const positioned = { top: positionedGrid.top, height: positionedGrid.height, legendBottom: h.chart.getOption().legend[0].bottom };
			h.set({ grid: [{ bottom: 24, top: 20 }, { bottom: 12, top: 220, height: 100 }] });
			return { initial: initial > 80, smaller, authored, percent, explicit, cleared, positioned, untouched, bottoms: h.chart.getOption().grid.map(g => g.bottom) };
		})()`,
			true,
		);
		expect(result).toEqual({
			initial: true,
			smaller: 80,
			authored: 51,
			percent: "40%",
			cleared: 51,
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

/**
 * A client component that steps a Chart through a day, its series a different length per step, as the mdx-all Day does.
 */
const STEPPED_CHART = `"use client";
import { Chart, Stepper } from "kit";
import { useState } from "preact/hooks";

const DATA = [3, 5, 8, 6, 4, 2];
const ENDS = [2, 4, 6];

export function Stepped() {
	const [step, setStep] = useState(ENDS.length);
	const shown = DATA.slice(0, ENDS[step - 1]);
	return (
		<Stepper label="Stepped" onStep={setStep} captions={ENDS.map((end) => \`To \${end}\`)}>
			<Chart label="Stepped" option={{ xAxis: { type: "category", data: DATA.map(String) }, yAxis: {}, series: [{ name: "Charge", type: "line", data: shown }, { type: "bar", data: shown }] }} />
		</Stepper>
	);
}
`;

test("a step keeps the chart's series views, so ECharts tweens from the shown state instead of drawing them in again", async () => {
	const output = await packedMdx(
		dir,
		"stepped",
		`import { Stepped } from "./stepped.tsx";\n\n# Stepped\n\n<Stepped />\n`,
		{ "stepped.tsx": STEPPED_CHART },
	);
	await inPage(output, async (cdp) => {
		// A series view is kept, and its marks tween, while the series keeps the id ECharts gave it; a new view draws in from nothing.
		const views = `(() => { const chart = echarts.getInstanceByDom(document.querySelector(".chart")); return chart.getModel().getSeries().map((s) => chart.getViewOfSeriesModel(s).group.id + ":" + s.getData().count()); })()`;
		const before = await cdp.evaluate<string[]>(views);
		const after = await act<string[]>(
			cdp,
			`document.querySelector('[data-go="-1"]').click()`,
			views,
		);
		expect(before.map((s) => s.split(":")[1])).toEqual(["6", "6"]);
		expect(after).toEqual(before.map((s) => s.replace(/:6$/, ":4")));
	});
}, 30_000);

/** A page with a Chart, so it carries the charts runtime. */
const WITH_CHART = `import { Chart } from "kit";\n\n# Charts\n\n<Chart label="Bars" option={{ xAxis: { type: "category", data: ["a"] }, yAxis: {}, series: [{ type: "bar", data: [1] }] }} />\n`;

/**
 * Page functions: `made`, a Charts.make handle on a new element once its chart has mounted, and `quiet`, which runs `fn` without
 * the one error ECharts logs for any baseOption (it sets baseOption.timeline, a component the kit does not bundle).
 */
const MADE = `const quiet = async (fn) => {
	const error = console.error;
	console.error = (...args) => String(args[0]).includes("Component timeline is used but not imported") || error(...args);
	try { return await fn(); } finally { console.error = error; }
};
const made = (option) => new Promise((done) => {
	const el = document.createElement("div");
	el.className = "chart";
	document.querySelector("main").append(el);
	const handle = Charts.make(el, option, () => done(handle));
});`;

test("a replaced series list draws what a fresh mount of the saved option draws", async () => {
	const output = await packedMdx(dir, "replaced", WITH_CHART);
	const result = await inPage(output, (cdp) =>
		cdp.evaluate(
			`(async () => {
			${MADE}
			const axes = { xAxis: { type: "category", data: ["a", "b"] }, yAxis: {} };
			const cases = [
				[{ ...axes, series: [{ type: "line", name: "A", areaStyle: {}, stack: "s", data: [1, 2] }] },
					{ series: [{ type: "line", data: [3, 4] }] }],
				[{ ...axes, dataset: { source: [["x", "Sales", "Cost"], ["a", 1, 2], ["b", 3, 4]] }, series: [{ type: "bar" }, { type: "bar" }] },
					{ dataset: { source: [["x", "Profit", "Tax"], ["a", 5, 6], ["b", 7, 8]] }, series: [{ type: "bar" }, { type: "bar" }] }],
			];
			const failures = [];
			for (const [initial, patch] of cases) {
				const live = await made(structuredClone(initial));
				live.set(structuredClone(patch), ["series"]);
				const fresh = await made({ ...structuredClone(initial), ...structuredClone(patch) });
				const shown = live.chart.getOption();
				const mounted = fresh.chart.getOption();
				for (const key of new Set([...Object.keys(shown), ...Object.keys(mounted)])) {
					const [a, b] = [JSON.stringify(shown[key]), JSON.stringify(mounted[key])];
					if (a !== b) {
						failures.push(key + ": " + a + " but a mount draws " + b);
					}
				}
			}
			// A step of a baseOption chart keeps its series views as a root option's does.
			const base = (data) => ({ baseOption: { ...axes, series: [{ type: "line", data }, { type: "bar", data }] } });
			const views = (handle) => handle.chart.getModel().getSeries().map((s) => handle.chart.getViewOfSeriesModel(s).group.id);
			await quiet(async () => {
				const stepped = await made(base([1, 2]));
				const before = views(stepped);
				stepped.set(base([3]), ["series"]);
				if (views(stepped).join() !== before.join()) {
					failures.push("baseOption views " + before + " became " + views(stepped));
				}
			});
			return failures;
		})()`,
			true,
		),
	);
	expect(result).toEqual([]);
}, 30_000);

test("a replaced series list keeps what the reader toggled and zoomed", async () => {
	const output = await packedMdx(dir, "reader-state", WITH_CHART);
	const result = await inPage(output, (cdp) =>
		cdp.evaluate(
			`(async () => {
			${MADE}
			const series = (data) => [{ name: "A", type: "bar", data }, { name: "B", type: "bar", data }];
			const handle = await made({ legend: {}, dataZoom: [{ type: "inside" }], xAxis: { type: "category", data: ["a", "b", "c", "d"] }, yAxis: {}, series: series([1, 2, 3, 4]) });
			handle.chart.dispatchAction({ type: "legendUnSelect", name: "A" });
			handle.chart.dispatchAction({ type: "dataZoom", start: 25, end: 75 });
			handle.set({ series: series([4, 3, 2, 1]) }, ["series"]);
			const shown = handle.chart.getOption();
			return { selected: shown.legend[0].selected, zoom: [shown.dataZoom[0].start, shown.dataZoom[0].end] };
		})()`,
			true,
		),
	);
	expect(result).toEqual({ selected: { A: false, B: true }, zoom: [25, 75] });
}, 30_000);

test("the saved option takes an update as ECharts does, so a later redraw replays what was shown", async () => {
	const output = await packedMdx(dir, "saved-merge", WITH_CHART);
	const result = await inPage(output, (cdp) =>
		cdp.evaluate(
			`(async () => {
			${MADE}
			const handle = await made({ legend: {}, xAxis: { type: "category", data: ["a", "b"] }, yAxis: {}, series: [{ name: "A", type: "bar", data: [1, 2] }, { name: "B", type: "bar", data: [3, 4] }] });
			const data = () => handle.chart.getOption().series.map((s) => s.name + "=" + s.data.join(","));
			handle.set({ series: [{ name: "B", data: [5, 6] }] });
			const merged = data();
			handle.set({ legend: { show: false } }, ["legend"]);
			return [merged, data()];
		})()`,
			true,
		),
	);
	expect(result).toEqual([
		["A=1,2", "B=5,6"],
		["A=1,2", "B=5,6"],
	]);
}, 30_000);

test("a redraw keeps an untouched value zoom in values, a reader's zoom in percent, a visualMap range and a legend's scroll", async () => {
	const output = await packedMdx(dir, "reader-modes", WITH_CHART);
	const result = await inPage(output, (cdp) =>
		cdp.evaluate(
			`(async () => {
			${MADE}
			const categories = (n) => Array.from({ length: n }, (_, i) => "c" + i);
			const grow = (n) => ({ xAxis: { data: categories(n) }, series: [{ type: "bar", data: categories(n).map((_, i) => i) }] });
			const zoomed = (dataZoom) => made({ dataZoom: [dataZoom], xAxis: { type: "category", data: categories(20) }, yAxis: {}, series: grow(20).series });
			const zoomOf = (handle) => { const z = handle.chart.getOption().dataZoom[0]; return [z.startValue, z.endValue, z.start, z.end]; };
			const untouched = await zoomed({ type: "inside", startValue: 2, endValue: 10 });
			untouched.set(grow(40), ["series"]);
			const read = await zoomed({ type: "inside", startValue: 2, endValue: 10 });
			read.chart.dispatchAction({ type: "dataZoom", start: 25, end: 75 });
			read.set(grow(40), ["series"]);

			const names = Array.from({ length: 30 }, (_, i) => "Series " + i);
			const series = (k) => names.map((name) => ({ name, type: "scatter", data: [[k, k]] }));
			const mapped = await made({ legend: { type: "scroll" }, visualMap: [{ type: "continuous", min: 0, max: 100, dimension: 1 }, { type: "continuous", min: 0, max: 100, dimension: 0 }],
				xAxis: {}, yAxis: {}, series: series(1) });
			mapped.chart.dispatchAction({ type: "selectDataRange", visualMapIndex: 0, selected: [20, 60] });
			mapped.chart.dispatchAction({ type: "legendScroll", scrollDataIndex: 12 });
			mapped.set({ visualMap: [{}, { max: 200 }], series: series(2) }, ["series"]);
			const shown = mapped.chart.getOption();
			const kept = { ranges: shown.visualMap.map((v) => v.range), scroll: shown.legend[0].scrollDataIndex };
			mapped.set({ visualMap: [{ range: [10, 30] }], series: series(3) }, ["series"]);
			return { untouched: zoomOf(untouched).slice(0, 2), read: zoomOf(read).slice(2), kept, authored: mapped.chart.getOption().visualMap[0].range };
		})()`,
			true,
		),
	);
	expect(result).toEqual({
		untouched: [2, 10],
		read: [25, 75],
		kept: {
			ranges: [
				[20, 60],
				[0, 200],
			],
			scroll: 12,
		},
		authored: [10, 30],
	});
}, 30_000);

test("a set without replace targets series as ECharts does: by id, name, else position", async () => {
	const output = await packedMdx(dir, "partial", WITH_CHART);
	const result = await inPage(output, (cdp) =>
		cdp.evaluate(
			`(async () => {
			${MADE}
			const pie = await made({ series: [{ id: "authored", type: "pie", data: [1, 2] }] });
			pie.set({ series: [{ data: [3, 4] }] });
			const axes = { xAxis: { type: "category", data: ["a", "b"] }, yAxis: {} };
			const pair = await made({ ...axes, series: [{ name: "A", type: "bar", data: [1, 2] }, { name: "B", type: "bar", data: [3, 4] }] });
			pair.set({ series: [{ name: "B", data: [5, 6] }] });
			// An author id that looks like a position is the author's own, not a clash.
			const named = await made({ ...axes, series: [{ type: "bar", data: [1, 2] }, { id: "kit-series-0", type: "bar", data: [3, 4] }] });
			const data = (handle) => handle.chart.getOption().series.map((s) => (s.name ?? "") + "=" + s.data.map((d) => d.value ?? d).join(","));
			return [data(pie), data(pair), data(named).length];
		})()`,
			true,
		),
	);
	expect(result).toEqual([["=3,4"], ["A=1,2", "B=5,6"], 2]);
}, 30_000);

test("a chart arrives drawn: no entrance animation, even where motion is allowed, and its own animation setting stays", async () => {
	const drawn = await packedMdx(
		dir,
		"arrival-drawn",
		`import { Chart } from "kit";\n\n# Arrival\n\n<Chart label="Base" option={{ baseOption: { animation: true, animationDuration: 1000, xAxis: { type: "category", data: ["a"] }, yAxis: {}, series: [{ type: "line", data: [1] }] } }} />\n\n<Chart label="Root" option={{ animation: true, xAxis: { type: "category", data: ["a"] }, yAxis: {}, series: [{ type: "line", data: [1] }] }} />\n`,
	);
	// pack's drawings are still: no entrance keyframes, whatever the option asks for.
	expect(readFileSync(drawn, "utf8")).not.toContain("@keyframes");
	const output = await packedMdx(dir, "arrival", WITH_CHART);
	// A chart made after load has no drawing in front of it, as one in a client component or a hidden view may not.
	const result = await inPage(output, async (cdp) => {
		await cdp.send("Emulation.setEmulatedMedia", {
			features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
		});
		return cdp.evaluate(
			`(async () => {
			${MADE}
			const axes = { xAxis: { type: "category", data: ["a", "b"] }, yAxis: {} };
			const series = [{ type: "line", data: [1, 2] }, { type: "bar", data: [2, 1] }];
			const options = [
				{ ...axes, series },
				{ baseOption: { ...axes, series, animation: true, animationDuration: 1000 } },
				{ baseOption: { ...axes, series, animation: false } },
			];
			const found = [];
			await quiet(async () => {
				for (const option of options) {
					const el = document.createElement("div");
					el.className = "chart";
					document.querySelector("main").append(el);
					found.push(await new Promise((done) => Charts.make(el, option, (chart) =>
						done({ arriving: !chart.getZr().animation.isFinished(), animation: chart.getOption().animation }))));
				}
			});
			return found;
		})()`,
			true,
		);
	});
	expect(result).toEqual([
		{ arriving: false, animation: true },
		{ arriving: false, animation: true },
		{ arriving: false, animation: false },
	]);
}, 30_000);

test("names at the line ends follow updates: a legend or one named line takes them away, a second named line brings them", async () => {
	const page = PAGE.replace(
		/var contract =[\s\S]*<\/script>/,
		`const line = (name, data) => ({ name, type: "line", data });
		const ends = (chart) => chart.getOption().series.filter((s) => s.endLabel?.show).length;
		var contract = new Promise((done) => {
			const handle = Charts.make(document.getElementById("c"), {
				xAxis: { type: "category", data: ["a", "b"] }, yAxis: {},
				series: [line("One", [1, 2]), line("Two", [2, 1])],
			}, (chart) => {
				const found = [];
				const expectEnds = (label, n) => { if (ends(chart) !== n) found.push(label + ": " + ends(chart) + " end labels, not " + n); };
				expectEnds("two named lines", 2);
				handle.set({ legend: {} });
				expectEnds("a legend set by a later patch", 0);
				handle.set({}, ["legend"]);
				expectEnds("the legend replaced by none", 2);
				handle.set({ series: [line("One", [1, 2])] }, ["series"]);
				expectEnds("one named line", 0);
				handle.set({ series: [line("One", [1, 2]), line("Two", [2, 1])] });
				expectEnds("a second named line merged in", 2);
				done(found);
			});
		});
		</script></body></html>`,
	);
	expect(await packAndRun(dir, "end-labels", page)).toEqual([]);
}, 30_000);

test("names that would end less than a line apart move apart at their ends, never into a legend, spread again when the chart's height changes (#190)", async () => {
	const page = PAGE.replace(
		'<div class="chart" id="c">',
		'<div class="chart" id="c" style="height:160px">',
	).replace(
		/var contract =[\s\S]*<\/script>/,
		`const line = (name, data) => ({ name, type: "line", data });
		const named = (chart) => chart.getOption().series.filter((s) => s.endLabel?.show).length;
		const legends = (chart) => (chart.getOption().legend ?? []).length;
		const offsets = (chart) => chart.getOption().series.map((s) => s.endLabel?.offset?.[1] ?? 0);
		const el = document.getElementById("c");
		var contract = new Promise((done) => {
			// Ends 1 apart on an axis of 0 to 10: about 8 px in a 160 px chart, over 40 px in a 600 px one.
			const handle = Charts.make(el, {
				xAxis: { type: "category", data: ["a", "b"] }, yAxis: {},
				series: [line("One", [0, 5]), line("Two", [10, 6])],
			}, (chart) => {
				const found = [];
				// "Two" ends above "One": it moves up and "One" down, by half of what they lack of a line each.
				const [one, two] = offsets(chart);
				if (named(chart) !== 2 || legends(chart) !== 0 || !(one > 0 && two < 0)) found.push("crowded: " + named(chart) + " end labels, " + legends(chart) + " legends, offsets " + [one, two]);
				el.style.height = "600px";
				// A saved-option redraw arrives before ResizeObserver updates the renderer's height.
				handle.set({ title: { text: "Updated", show: false } });
				if (chart.getHeight() !== 160) found.push("redraw did not precede the resize");
				setTimeout(() => {
					if (chart.getHeight() !== 600 || named(chart) !== 2 || legends(chart) !== 0 || offsets(chart).some((v) => v !== 0)) found.push("taller: " + chart.getHeight() + " px, " + named(chart) + " end labels, " + legends(chart) + " legends, offsets " + offsets(chart));
					done(found);
				}, 300);
			});
		});
		</script></body></html>`,
	);
	expect(await packAndRun(dir, "crowded-ends", page)).toEqual([]);
}, 30_000);

test("names at the line ends spread again when only the chart's width changes, since ECharts samples a line by its width, keeping what setup added (#190)", async () => {
	const page = PAGE.replace(
		'<div class="chart" id="c">',
		'<div class="chart" id="c" style="height:400px;width:326px">',
	).replace(
		/var contract =[\s\S]*<\/script>/,
		`const apart = (chart) => chart.getOption().series.slice(0, 2).map((s) => s.endLabel?.offset?.[1] ?? 0).join(",");
		const ownOffset = (chart) => chart.getOption().series.find((s) => s.id === "author").endLabel.offset.join(",");
		const el = document.getElementById("c");
		const after = (ms) => new Promise((go) => setTimeout(go, ms));
		// "Peak" ends on 30 points at 10 after 19,970 at 0, averaged in buckets as wide as the plot is narrow: about 10 when
		// the chart is wide and the buckets small, far less when it is narrow. "Level" ends at 10, so only wide do they crowd.
		const peak = Array.from({ length: 20000 }, (_, i) => (i >= 19970 ? 10 : 0));
		var contract = new Promise((done) => {
			Charts.make(el, {
				xAxis: { type: "category" }, yAxis: { max: 12 },
				series: [
					{ name: "Peak", type: "line", sampling: "average", data: peak },
					{ name: "Level", type: "line", data: peak.map(() => 10) },
				],
			}, async (chart) => {
				const found = [];
				// What setup adds stays through every resize.
				chart.setOption({ title: { text: "kept" }, series: [
					{ id: "author", name: "Level", type: "line", data: [1, 2], endLabel: { show: true, offset: [25, 70] } },
				] });
				const narrow = apart(chart);
				el.style.width = "1200px";
				await after(300);
				const wide = apart(chart);
				if (ownOffset(chart) !== "25,70") found.push("setup's offset after widening: " + ownOffset(chart));
				el.style.width = "326px";
				await after(300);
				const again = apart(chart);
				if (narrow !== "0,0" || wide === "0,0" || again !== "0,0") found.push("offsets narrow " + narrow + ", wide " + wide + ", narrow again " + again);
				if (ownOffset(chart) !== "25,70") found.push("setup's offset after narrowing: " + ownOffset(chart));
				if (chart.getOption().title?.[0]?.text !== "kept") found.push("setup's title lost on resize");
				done(found);
			});
		});
		</script></body></html>`,
	);
	expect(await packAndRun(dir, "width-ends", page)).toEqual([]);
}, 30_000);

test("a patch that brings a second named line keeps the reader's zoom and visualMap range", async () => {
	const page = PAGE.replace(
		/var contract =[\s\S]*<\/script>/,
		`const line = (name, data) => ({ name, type: "line", data });
		const axes = { xAxis: { type: "category", data: ["a", "b", "c", "d", "e"] }, yAxis: {} };
		var contract = Promise.all([
			new Promise((done) => {
				const handle = Charts.make(document.getElementById("c"), { ...axes, dataZoom: [{ type: "inside", start: 0, end: 100 }], series: [line("One", [1, 2, 3, 4, 5])] }, (chart) => {
					chart.dispatchAction({ type: "dataZoom", start: 20, end: 40 });
					handle.set({ series: [line("One", [1, 2, 3, 4, 5]), line("Two", [5, 4, 3, 2, 1])] });
					const { start, end } = chart.getOption().dataZoom[0];
					done(start === 20 && end === 40 ? [] : ["zoom after a second line: " + start + " to " + end]);
				});
			}),
			new Promise((done) => {
				const el = document.createElement("div");
				el.className = "chart";
				document.querySelector("main").append(el);
				const handle = Charts.make(el, { ...axes, visualMap: { type: "continuous", min: 0, max: 10, range: [0, 10], dimension: 1 }, series: [line("One", [1, 2, 3, 4, 5])] }, (chart) => {
					chart.dispatchAction({ type: "selectDataRange", selected: [2, 5] });
					handle.set({ series: [line("One", [1, 2, 3, 4, 5]), line("Two", [5, 4, 3, 2, 1])] });
					const ends = chart.getOption().series.filter((s) => s.endLabel?.show).length;
					const range = chart.getOption().visualMap[0].range;
					done(ends === 2 && String(range) === "2,5" ? [] : ["visualMap after a second line: " + ends + " end labels, range " + range]);
				});
			}),
		]).then((found) => found.flat());
		</script></body></html>`,
	);
	expect(await packAndRun(dir, "ends-keep-state", page)).toEqual([]);
}, 30_000);

const TREEMAP = `import { Chart } from "kit";

# Sizes

<Chart label="Sizes" option={{ series: [{ type: "treemap", width: "100%", height: "100%", left: 0, top: 0, data: [{ name: "a", value: 3, children: [{ name: "a1", value: 2, children: [{ name: "a1x", value: 1 }, { name: "a1y", value: 1 }] }, { name: "a2", value: 1 }] }, { name: "b", value: 2, itemStyle: { color: "var(--accent)" } }] }] }} />
`;

test("a data-only treemap's labels pass AA on their tiles in both schemes, an accent tile included, and tiles stay apart", async () => {
	const output = await packedMdx(dir, "treemap", TREEMAP);
	const html = readFileSync(output, "utf8");
	const start = html.indexOf('class="chart-drawn"');
	const svg = html.slice(html.indexOf("<svg", start), html.indexOf("</svg>", start) + 6);
	const page = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><main class="page"><div id="box" style="position:relative;width:1054px;height:416px">${svg.replace("<svg", '<svg style="display:block;width:100%;height:100%"')}</div></main>
<script>
const luminance = (rgb) => rgb.match(/[\\d.]+/g).slice(0, 3).map(Number).map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const pixel = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
const rgb = (css) => { pixel.clearRect(0, 0, 1, 1); pixel.fillStyle = css; pixel.fillRect(0, 0, 1, 1); return "rgb(" + [...pixel.getImageData(0, 0, 1, 1).data.slice(0, 3)].join(", ") + ")"; };
const labels = () => [...document.querySelectorAll("text")].map((text) => {
	const box = text.getBoundingClientRect();
	const tile = document.elementsFromPoint(box.x + box.width / 2, box.y + box.height / 2).find((el) => el.tagName === "path");
	return { name: text.textContent, ratio: contrast(rgb(getComputedStyle(text).fill), rgb(getComputedStyle(tile).fill)), halo: getComputedStyle(text).strokeWidth };
});
const inScheme = (scheme) => { document.documentElement.dataset.scheme = scheme; return labels(); };
const passes = (scheme) => inScheme(scheme).length >= 3 && inScheme(scheme).every((l) => l.ratio >= 4.5);
const fills = () => new Set([...document.querySelectorAll("path")].map((p) => getComputedStyle(p).fill));
${pageContract({
	"light: every label passes AA on its tile": `passes("light")`,
	"dark: every label passes AA on its tile": `passes("dark")`,
	"the accent tile and the muted tiles differ": `fills().size >= 3`,
	"tiles are separated by the page's tone": `[...document.querySelectorAll("path")].some((p) => getComputedStyle(p).fill === rgb(getComputedStyle(document.body).backgroundColor))`,
})}</script></body></html>`;
	expect(await packAndRun(dir, "treemap-contrast", page, { widths: [DESKTOP] })).toEqual([]);
}, 30_000);

test("a treemap's click does not zoom unless the author sets nodeClick", async () => {
	for (const [name, extra] of [
		["plain", ""],
		["zoom", ', nodeClick: "zoomToNode"'],
	] as const) {
		const output = await packedMdx(
			dir,
			`treemap-click-${name}`,
			TREEMAP.replace('type: "treemap"', `type: "treemap"${extra}`),
		);
		const moved = await inPage(output, async (cdp) => {
			const layouts = `(() => {
				const data = echarts.getInstanceByDom(document.querySelector(".chart")).getModel().getSeriesByIndex(0).getData();
				return JSON.stringify(data.mapArray((i) => JSON.stringify(data.getItemLayout(i))));
			})()`;
			const before = await cdp.evaluate<string>(layouts);
			const point = await cdp.evaluate<{ x: number; y: number }>(`(() => {
				const b = document.querySelector(".chart").getBoundingClientRect();
				return { x: b.x + b.width / 8, y: b.y + b.height / 3 };
			})()`);
			await runStep(cdp, `click:${Math.round(point.x)},${Math.round(point.y)}`, () => "");
			await cdp.evaluate(FRAMES, true);
			return before !== (await cdp.evaluate<string>(layouts));
		});
		expect([name, moved]).toEqual([name, name === "zoom"]);
	}
}, 60_000);

const ACCENT_DATA = [{ name: "Finding", value: 4, itemStyle: { color: "var(--accent)" } }];

test("treemap accent labels follow responsive, base and later data, without changing an author's colour", async () => {
	const output = await packedMdx(dir, "treemap-overrides", WITH_CHART);
	const result = await inPage(output, (cdp) =>
		cdp.evaluate(
			`(async () => {
			${MADE}
			const data = ${JSON.stringify(ACCENT_DATA)};
			const base = { series: [{ type: "treemap", data: [{ name: "Muted", value: 1 }] }] };
			const patch = { series: [{ data }] };
			const cases = [
				{ ...base, media: [{ query: { minWidth: 0 }, option: patch }] },
				{ baseOption: base, media: [{ query: { minWidth: 0 }, option: patch }] },
				{ baseOption: { series: [{ type: "treemap", data }] } },
			];
			const failures = [];
			const check = (handle, name) => {
				const model = handle.chart.getModel().getSeriesByIndex(0);
				const node = model.getData().getItemModel(1);
				const color = node.getModel("label").get("color");
				const probe = document.createElement("i"); probe.style.color = "var(--accent-ink)"; document.body.append(probe);
				if (color !== getComputedStyle(probe).color) failures.push(name + ": " + color);
				probe.remove();
			};
			for (const [i, option] of cases.entries()) {
				const handle = await quiet(() => made(option)); check(handle, "override " + i); handle.dispose();
			}
			const sparse = await made({ series: [{ id: "other", type: "pie", data: [1] }, { ...base.series[0], id: "tree" }], media: [{ query: { minWidth: 0 }, option: { series: [{ id: "tree", data }] } }] });
			const sparseColor = sparse.chart.getOption().series[1].data[0].label?.color;
			if (!sparseColor || sparseColor === "#fff") failures.push("sparse media missed label");
			sparse.dispose();
			const fromBase = await made({ baseOption: base });
			fromBase.set(patch); check(fromBase, "root set after baseOption"); fromBase.dispose();
			const handle = await made(base);
			handle.set(patch); check(handle, "set data");
			handle.set({ series: [{ data: [{ ...data[0], label: { color: "#123456" } }] }] });
			if (handle.chart.getOption().series[0].data[0].label.color !== "#123456") failures.push("authored label lost");
			handle.dispose(); return failures;
		})()`,
			true,
		),
	);
	expect(result).toEqual([]);
}, 30_000);

test("pack draws accent label ink in media treemap data and defaults cover timeline options", () => {
	const drawer = pageDrawer("en", []);
	const base = { series: [{ type: "treemap", data: [{ name: "Muted", value: 1 }] }] };
	const patch = { series: [{ data: ACCENT_DATA }] };
	for (const option of [
		{ ...base, media: [{ query: { minWidth: 0 }, option: patch }] },
		{ baseOption: base, media: [{ query: { minWidth: 0 }, option: patch }] },
	]) {
		const drawn = drawer.chart(option, { classes: ["chart"], id: undefined, height: undefined });
		expect(drawn).toContain("fill:var(--accent-ink)");
	}
	// Timeline is not bundled; its option still uses the same series traversal before ECharts sees it.
	const defaults = runKitPart("charts/defaults.ts", "ChartsDefaults") as {
		defaults(option: object): { options: { series: { data: { label: { color: string } }[] }[] }[] };
	};
	const result = defaults.defaults({ baseOption: base, options: [patch] });
	expect(result.options[0]?.series[0]?.data[0]?.label.color).toBe("var(--accent-ink)");
});
