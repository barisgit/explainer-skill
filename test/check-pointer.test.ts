import { afterAll, beforeAll, expect, test } from "bun:test";
import type { CheckResult } from "../skills/explainer/src/check.ts";
import { CheckedPage } from "../skills/explainer/src/checked-page.ts";
import { withPage } from "../skills/explainer/src/chrome.ts";
import { report } from "../skills/explainer/src/report.ts";
import { runStep, stepError } from "../skills/explainer/src/steps.ts";
import { packedMdx, packHtml, runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);
let chartFile: string;
beforeAll(async () => {
	chartFile = await packedMdx(
		dir,
		"zoom",
		`import { Chart } from "kit";
import "./zoom.css";

# Canvas gestures

<Chart id="zoom" label="Zoom test" height="300px" option={{
	xAxis: {type: "value", min: 0, max: 100},
	yAxis: {},
	dataZoom: [{type: "slider", left: 40, right: 40, bottom: 10, height: 30, start: 20, end: 80}],
	series: [{type: "line", data: Array.from({length: 101}, (_, i) => [i, Math.sin(i / 10)])}]
}} />`,
		{ "zoom.css": "#zoom { width: 600px; margin-top: 1200px; margin-bottom: 400px; }" },
	);
});

test("drag moves a real ECharts dataZoom slider selection after hover centres a below-fold chart", async () => {
	await withPage(async (cdp) => {
		const page = new CheckedPage(cdp, `file://${chartFile}`);
		await page.start();
		await page.screen({ theme: "light", name: "desktop", vp: { width: 800, height: 600 } });
		await page.open();
		expect((await runStep(cdp, "hover:#zoom", () => "unused")).problem).toBeUndefined();
		const geometry = await cdp.evaluate<{ x: number; y: number; scroll: number }>(`(() => {
			const b = document.querySelector('#zoom canvas').getBoundingClientRect();
			return {x: Math.round(b.left + 40 + (b.width - 80) * .5), y: Math.round(b.bottom - 25), scroll: scrollY};
		})()`);
		expect(geometry.scroll).toBeGreaterThan(500);
		const start = () =>
			cdp.evaluate<number>(
				"echarts.getInstanceByDom(document.getElementById('zoom')).getOption().dataZoom[0].start",
			);
		expect(await start()).toBe(20);
		const step = `drag:${geometry.x},${geometry.y}-${geometry.x + 80},${geometry.y}`;
		const result = await runStep(cdp, step, () => "unused");
		expect(result.problem).toBeUndefined();
		expect(await start()).toBeGreaterThan(25);
		expect(result.note).toContain("canvas in div#zoom.chart");
		expect(result.note).toContain("datazoom");
		const blank = await cdp.evaluate<{ x: number; y: number }>(`(() => {
			const b = document.querySelector('#zoom canvas').getBoundingClientRect();
			return {x: Math.round(b.left + 10), y: Math.round(b.top + 10)};
		})()`);
		const missed = await runStep(cdp, `click:${blank.x},${blank.y}`, () => "unused");
		expect(missed.note).toContain("canvas in div#zoom.chart; chart events: none observed");
		const mark = await cdp.evaluate<{ x: number; y: number }>(`(() => {
			const el = document.getElementById('zoom');
			const b = el.querySelector('canvas').getBoundingClientRect();
			const p = echarts.getInstanceByDom(el).convertToPixel({xAxisIndex: 0, yAxisIndex: 0}, [50, Math.sin(5)]);
			return {x: Math.round(b.left + p[0]), y: Math.round(b.top + p[1])};
		})()`);
		const hit = await runStep(cdp, `click:${mark.x},${mark.y}`, () => "unused");
		expect(hit.note).toContain("canvas in div#zoom.chart; chart events:");
		expect(hit.note).toMatch(/chart events: .*\bclick\b/);
		expect(page.problems).toEqual([]);
	});
}, 30_000);

test("click notes say what the point and DOM click hit, with navigation feedback in JSON", async () => {
	const file = dir.write(
		"hits.html",
		`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
	<button id="go" style="position:fixed;left:20px;top:20px;width:80px;height:40px" onclick="location.hash='opened'"><span id="label">Go</span></button>`,
	);
	const result = await runCli([
		"check",
		file,
		"--quick",
		"--view",
		"none",
		"--do",
		"click:60,40",
		"--do",
		"click:#go",
		"--do",
		"drag:60,40-70,40",
		"--json",
		"--out",
		dir.path("hits"),
	]);
	expect(result.code).toBe(0);
	const { stepNotes } = JSON.parse(result.stdout) as CheckResult;
	expect(
		stepNotes.some(
			(n) =>
				n.startsWith("click:60,40: hit span#label") &&
				n.includes("#opened") &&
				n.endsWith("[light desktop]"),
		),
	).toBe(true);
	expect(stepNotes).toContain("click:#go: hit button#go [light narrow]");
	expect(stepNotes.some((n) => n.startsWith("drag:60,40-70,40: hit"))).toBe(true);
	expect(stepNotes.every((n) => n.length < 200)).toBe(true);
}, 30_000);

test("a full-document navigation preserves the outgoing hit without leaking it into the next step", async () => {
	const destination = dir.write(
		"destination.html",
		'<!doctype html><button id="after">After</button>',
	);
	const file = dir.write(
		"navigate.html",
		`<!doctype html><a id="next" href="file://${destination}" style="display:block;position:fixed;left:20px;top:20px;width:80px;height:40px">Next</a>`,
	);
	await withPage(async (cdp) => {
		const page = new CheckedPage(cdp, `file://${file}`);
		await page.start();
		await page.open();
		const first = await runStep(cdp, "click:60,40", () => "unused");
		expect(first.note).toContain("hit a#next");
		const second = await runStep(cdp, "click:#after", () => "unused");
		expect(second.note).toBe("click:#after: hit button#after");
		expect(page.problems).toEqual([]);
	});
}, 30_000);

test("an observed click keeps its hit note beside a settle failure in JSON and text", async () => {
	const file = dir.path("unsettled.html");
	const packed = await packHtml(
		dir.write(
			"unsettled-source.html",
			`<!doctype html><html><head>
		<meta name="viewport" content="width=device-width, initial-scale=1">
		<link rel="stylesheet" href="kit:theme.css">
		<style>@media(max-width:600px) { #never { display:none; } }</style></head><body>
		<main><div data-overview><a id="open" href="#detail">Open chart</a></div>
		<section class="view" data-view="detail"><h1>Undrawn chart</h1><div id="never" class="chart"></div></section></main>
		<script src="kit:echarts.js"></script><script src="kit:views.js"></script></body></html>`,
		),
		file,
	);
	expect(packed.error).toBe("");
	const result = await runCli([
		"check",
		file,
		"--quick",
		"--view",
		"none",
		"--do",
		"click:#missing",
		"--do",
		"click:#open",
		"--json",
		"--out",
		dir.path("unsettled-shots"),
	]);
	expect(result.code).toBe(1);
	expect(result.stderr).toBe("");
	const checked = JSON.parse(result.stdout) as CheckResult;
	const problem =
		"--do click:#open: still waiting after 10 s for charts to be drawn: div#never.chart";
	expect(checked.shots.find((s) => s.viewport.startsWith("desktop"))?.problems).toContain(problem);
	expect(
		checked.stepNotes.some(
			(n) => n.startsWith("click:#open: hit a#open") && n.endsWith("[light desktop]"),
		),
	).toBe(true);
	expect(checked.stepNotes.some((n) => n.startsWith("click:#missing:"))).toBe(false);
	const text = report(file, checked.shots, checked.views, checked.stepNotes);
	expect(text).toContain(problem);
	expect(text).toMatch(/--do click:#open: hit a#open[^\n]*\[light desktop\]/);
}, 60_000);

test.each(["drag:#zoom", "drag:1,2", "drag:1,2-3", "drag:1,2-3,4@all"])(
	"%s fails with a copyable drag form",
	(step) => {
		expect(stepError(step)).toContain("drag:<x,y>-<x,y>");
	},
);
