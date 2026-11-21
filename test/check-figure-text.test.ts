import { afterAll, expect, test } from "bun:test";
import { FIGURE_TEXT_JS, type FigureText } from "../skills/explainer/src/figure-text.ts";
import { withTestPage } from "./browser.ts";
import { packedMdx, runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const LINES = `series: [{ name: "Alpha", type: "line", data: [[0, 1], [60, 3]] }, { name: "Beta", type: "line", data: [[0, 2], [60, 1]] }, { name: "Gamma", type: "line", data: [[0, 3], [60, 2]] }]`;

/** Figures as authors wrote them in #203 and #257, and plain ones beside them that check must leave alone. */
const PAGE = `import { Chart, Plot } from "kit";
import "./big.css";

# Figure text

<Chart id="cut" label="A title past the edge" option={{ title: { text: "Battery full at 11:10", left: -60 }, xAxis: { type: "category", data: ["a", "b"] }, yAxis: {}, series: [{ type: "bar", data: [1, 2] }] }} />

<Chart id="dense" label="Ticks run together" option={{ xAxis: { type: "value", min: 0, max: 60, interval: 2, axisLabel: { formatter: "{value} years", hideOverlap: false } }, yAxis: {}, series: [{ type: "line", data: [[0, 1], [60, 2]] }] }} />

<Chart id="legend" label="A legend under an author's bottom" option={{ grid: { left: 8, bottom: 24 }, legend: { show: true }, xAxis: { type: "value", axisLabel: { formatter: "{value} years" } }, yAxis: {}, ${LINES} }} />

<Chart id="scroll" label="A title over a scrolling legend" option={{ title: { text: "Legend title here", top: 8, left: 8 }, grid: { top: 64, left: 8, right: 24, bottom: 8 }, legend: { type: "scroll", top: 8, left: 8, right: 8 }, xAxis: { type: "category", data: ["a", "b"] }, yAxis: {}, series: ["First series", "Second series", "Third series", "Fourth series", "Fifth series", "Sixth series", "Seventh series", "Eighth series"].map(name => ({ name, type: "bar", data: [1, 2] })) }} />

<Chart id="plain" label="Plain chart" option={{ legend: {}, xAxis: { type: "category", data: ["Mon", "Tue", "Wed"] }, yAxis: {}, series: [{ name: "Load", type: "bar", data: [1, 2, 3] }, { name: "Use", type: "bar", data: [2, 1, 3] }] }} />

<Plot id="big" label="Text a page rule made larger" option={{ series: [{ name: "Rising", data: [[0, 0], [1, 2]] }, { name: "Flat", data: [[0, 1], [1, 1]] }], x: { unit: " years" }, y: { unit: " kWh" } }} />

<Plot id="bigdrawn" label="Only the drawing's text made larger" option={{ series: [{ name: "Rising", data: [[0, 0], [1, 2]] }, { name: "Flat", data: [[0, 1], [1, 1]] }], x: { unit: " years" }, y: { unit: " kWh" } }} />

<Plot id="plot" label="Plain plot" option={{ series: [{ name: "Rising", data: [[0, 0], [1, 2]] }, { name: "Flat", data: [[0, 1], [1, 1]] }], x: { unit: " years" }, y: { unit: " kWh" } }} />
`;

/** The figure-text warning lines of a check report. */
const figureWarnings = (stdout: string) =>
	stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => / px wide: .*(cross the figure's box|overlap)/.test(line));

test("check names a Chart or Plot whose text crosses its box or overlaps other text, at desktop and phone, and leaves plain figures alone (#203)", async () => {
	// A page rule sets a Plot's text larger than the size plot.js placed it at: drawn and live, or in pack's drawing only.
	const page = await packedMdx(dir, "figures", PAGE, {
		"big.css": "#big text, #bigdrawn .chart-drawn text { font-size: 40px; }",
	});
	const result = await runCli([
		"check",
		page,
		"--quick",
		"--view",
		"none",
		"--out",
		dir.path("shots"),
	]);
	expect(result.code).toBe(0);
	const lines = figureWarnings(result.stdout);
	for (const width of [1440, 390]) {
		expect(lines).toContainEqual(
			expect.stringMatching(
				new RegExp(
					`^div#cut\\.chart "A title past the edge" as pack drew it at ${width} px wide: 1 text\\(s\\) cross the figure's box \\('Battery full at 11:10'\\)`,
				),
			),
		);
	}
	expect(lines).toContainEqual(
		expect.stringMatching(
			/^div#dense\.chart "Ticks run together" as pack drew it at 390 px wide: \d+ pair\(s\) of texts overlap \('\d+ years' and '\d+ years'/,
		),
	);
	for (const width of [1440, 390]) {
		expect(lines).toContainEqual(
			expect.stringMatching(
				new RegExp(
					`^div#big\\.chart "Text a page rule made larger" (as pack drew it and live| live) at ${width} px wide: .*overlap`,
				),
			),
		);
	}
	for (const width of [1440, 390]) {
		expect(lines).toContainEqual(
			expect.stringMatching(
				new RegExp(
					`^div#bigdrawn\\.chart "Only the drawing's text made larger" as pack drew it at ${width} px wide: .*overlap`,
				),
			),
		);
	}
	// A scrolling legend's visible item under the title overlaps it; the items its clip hides on later pages are no text.
	const scroll = lines.filter((line) => line.startsWith("div#scroll.chart"));
	expect(scroll.length).toBeGreaterThan(0);
	for (const line of scroll) {
		expect(line).toContain("'Legend title here' and 'First series'");
		expect(line).not.toContain("cross the figure's box");
	}
	// An author's grid bottom smaller than the legend's room keeps the legend clear of the axis labels (#257).
	expect(lines.filter((line) => /^div#(legend|plain|plot)\b/.test(line))).toEqual([]);
}, 60_000);

/** A figure as SVG by hand: `body` inside a 300 x 120 svg in a `.chart` with id `f`, monospace 16 px text, a clip `c` to x <= 45. */
const figure = (
	body: string,
) => `<!doctype html><div class="chart" id="f" style="width:300px;height:120px"><svg viewBox="0 0 300 120" width="300" height="120" style="font:16px monospace">
<defs><clipPath id="c"><rect x="0" y="0" width="45" height="120"/></clipPath></defs>${body}</svg></div>`;

test("figure text counts only what a clip lets through, once per halo, and rotated labels by their own outline", async () => {
	const cases = {
		// A run cut at x = 45, through its fourth character (38.4 to 48 px), beside a text from x = 47: apart on screen, though that
		// character's whole cell, whose centre the clip keeps, would reach it.
		clipped:
			'<g clip-path="url(#c)"><text x="10" y="40">MMMMMM</text></g><text x="47" y="40">MMMM</text>',
		// The same run beside a text from x = 30: they meet inside the clip.
		visible:
			'<g clip-path="url(#c)"><text x="10" y="40">MMMMMM</text></g><text x="30" y="40">MMMM</text>',
		// A label over its own halo copy, and labels a line apart.
		halo: '<text x="10" y="40" stroke="white" stroke-width="3">Label</text><text x="10" y="40">Label</text><text x="10" y="60">Label</text>',
		// Two labels turned 45 degrees side by side, whose upright boxes would overlap.
		rotated:
			'<text transform="translate(100 100) rotate(-45)">Monday</text><text transform="translate(116 100) rotate(-45)">Tuesday</text>',
	};
	const found = await withTestPage(async (cdp) => {
		await cdp.send("Page.enable");
		const out: Record<string, number[]> = {};
		for (const [name, body] of Object.entries(cases)) {
			await cdp.load(`data:text/html,${encodeURIComponent(figure(body))}`);
			const result = await cdp.evaluate<FigureText[]>(FIGURE_TEXT_JS(false));
			out[name] = result.map((f) => f.pairs + f.out);
		}
		return out;
	});
	expect(found).toEqual({ clipped: [], visible: [1], halo: [], rotated: [] });
}, 30_000);
