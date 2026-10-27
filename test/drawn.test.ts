import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { withPage } from "../skills/explainer/src/chrome.ts";
import { runStep } from "../skills/explainer/src/steps.ts";
import { inPage, packedMdx, scratch, WIDTHS } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/** A Chart with a legend, a tooltip and a token colour, and a Plot with a legend, written as authors write them. */
const PAGE = `import { Chart, Plot } from "kit";

# Drawn

<Chart id="bars" label="Load by day" option={{ legend: {}, tooltip: { trigger: "axis" }, xAxis: { type: "category", data: ["Mon", "Tue"] }, yAxis: {}, series: [{ name: "Load", type: "bar", data: [1, 2], itemStyle: { color: "var(--c3)" } }] }} />

<Plot id="lines" label="Two lines" option={{ series: [{ name: "Rising", data: [[0, 0], [1, 2]] }, { name: "Flat", data: [[0, 1], [1, 1]] }] }} />
`;

const output = await packedMdx(dir, "drawn", PAGE);

/**
 * Page expression, run with the page's scripts off: for each figure, how many drawn copies show and how wide the one showing is
 * against its element, its texts, and the colour of the bar against the colour --c3 has in the scheme.
 */
const DRAWN_STATE = `(() => {
	const shown = (id) => [...document.querySelectorAll("#" + id + " .chart-drawn > svg")].filter((svg) => svg.getBoundingClientRect().width > 0);
	const share = (id) => Math.round((shown(id)[0]?.getBoundingClientRect().width ?? 0) / document.getElementById(id).getBoundingClientRect().width * 10) / 10;
	const probe = document.createElement("i");
	probe.style.color = "var(--c3)";
	document.body.append(probe);
	const c3 = getComputedStyle(probe).color;
	probe.remove();
	const bar = shown("bars")[0]?.querySelector("path[style*='--c3']");
	return {
		copies: [shown("bars").length, shown("lines").length],
		widths: [share("bars"), share("lines")],
		texts: shown("bars").concat(shown("lines")).flatMap((svg) => [...svg.querySelectorAll("text")].map((t) => t.textContent)),
		bar: bar ? getComputedStyle(bar).fill : "none",
		c3,
	};
})()`;

interface DrawnState {
	copies: number[];
	widths: number[];
	texts: string[];
	bar: string;
	c3: string;
}

/** DRAWN_STATE at each width in light and dark, and as the page prints, with the page's scripts off. */
function drawnStates(): Promise<Record<string, DrawnState>> {
	return withPage(async (cdp) => {
		await Promise.all(["Page", "Runtime"].map((domain) => cdp.send(`${domain}.enable`)));
		await cdp.send("Emulation.setScriptExecutionDisabled", { value: true });
		const states: Record<string, DrawnState> = {};
		for (const viewport of WIDTHS) {
			await cdp.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1 });
			for (const media of ["screen", "print"]) {
				for (const scheme of ["light", "dark"]) {
					await cdp.send("Emulation.setEmulatedMedia", {
						media,
						features: [{ name: "prefers-color-scheme", value: scheme }],
					});
					await cdp.load(`file://${output}`);
					states[`${viewport.width} ${media} ${scheme}`] =
						await cdp.evaluate<DrawnState>(DRAWN_STATE);
				}
			}
		}
		return states;
	});
}

describe("a Chart and a Plot drawn at pack time", () => {
	test("show with scripts off at every width, in print, in light and dark, coloured by the scheme's tokens", async () => {
		const states = await drawnStates();
		const bars = new Set<string>();
		for (const [where, state] of Object.entries(states)) {
			expect({ where, copies: state.copies, bar: state.bar }).toEqual({
				where,
				copies: [1, 1],
				bar: state.c3,
			});
			expect({ where, narrowest: Math.min(...state.widths) >= 0.7 }).toEqual({
				where,
				narrowest: true,
			});
			expect(state.texts).toEqual(expect.arrayContaining(["Mon", "Tue", "Load"]));
			bars.add(state.bar);
		}
		// The bar follows the scheme: --c3 is a different colour in dark.
		expect(bars.size).toBe(2);
	}, 60_000);

	test("colours ECharts mixes from two tokens, as a visualMap does, are those tokens mixed; a fade to transparent keeps its hue", async () => {
		const mixed = await packedMdx(
			dir,
			"mixed",
			`import { Chart } from "kit";

# Mixed

<Chart label="Heat" option={{ xAxis: { type: "category", data: ["a", "b"] }, yAxis: { type: "category", data: ["x"] }, visualMap: { min: 0, max: 10, inRange: { color: ["var(--c2)", "var(--c5)"] } }, series: [{ type: "heatmap", data: [[0, 0, 0], [1, 0, 3]] }] }} />

<Chart label="Area" option={{ xAxis: { type: "category", data: ["a", "b"] }, yAxis: {}, series: [{ type: "line", data: [1, 3], areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "var(--c1)" }, { offset: 1, color: "transparent" }] } } }] }} />
`,
		);
		const html = readFileSync(mixed, "utf8");
		expect(html).toMatch(/fill:color-mix\(in srgb, var\(--c2\) 70(\.\d)?%, var\(--c5\)\)/);
		expect(html).toContain('<stop offset="100%" style="stop-color:var(--c1)" stop-opacity="0">');
		expect(html).not.toContain('stop-color="none"');
	}, 30_000);

	test("give way to the live chart and plot, whose tooltip and legends work", async () => {
		const state = await inPage(output, async (cdp) => {
			const step = async (name: string) =>
				(await runStep(cdp, name, () => dir.path("unused.png"))).problem ?? "";
			const live = await cdp.evaluate(LIVE_STATE);
			const hovered = await step("hover:#bars");
			const tooltip = await cdp.evaluate(TOOLTIP);
			const clicked = await step("click:#lines .plot-legend button");
			const legend = await cdp.evaluate(PLOT_LEGEND);
			return { live, hovered, tooltip, clicked, legend };
		});
		expect(state).toEqual({
			live: { drawn: 0, chart: true, plotLines: 2, onTop: true },
			hovered: "",
			tooltip: true,
			clicked: "",
			legend: { pressed: "false", lines: 1 },
		});
	}, 60_000);
});

describe("what pack draws is exact, or nothing", () => {
	test("a colour pack cannot read back exactly leaves its figure to the live chart", async () => {
		const figures = drawnFigures(
			await packedMdx(
				dir,
				"unreadable",
				`import { Chart } from "kit";

# Unreadable

<Chart id="to-literal" label="Token to literal" option={{ xAxis: { type: "category", data: ["a", "b"] }, yAxis: { type: "category", data: ["x"] }, visualMap: { min: 0, max: 10, inRange: { color: ["var(--c2)", "#ff0000"] } }, series: [{ type: "heatmap", data: [[0, 0, 0], [1, 0, 3]] }] }} />

<Chart id="lightness" label="Lightness" option={{ xAxis: { type: "category", data: ["a", "b"] }, yAxis: {}, visualMap: { show: false, min: 0, max: 10, inRange: { colorLightness: [0.2, 0.8] } }, series: [{ type: "bar", data: [1, 3], itemStyle: { color: "var(--c2)" } }] }} />

<Chart id="replaced-alpha" label="Replaced alpha" option={{ xAxis: { type: "category", data: ["a", "b"] }, yAxis: {}, visualMap: { show: false, min: 0, max: 10, inRange: { colorAlpha: [0.4, 0.4] } }, series: [{ type: "bar", data: [1, 3], itemStyle: { color: "color-mix(in srgb, var(--c2) 50%, transparent)" } }] }} />

<Chart id="multiplied-alpha" label="Multiplied alpha" option={{ xAxis: { type: "category", data: ["a", "b"] }, yAxis: {}, series: [{ type: "line", data: [1, 3], areaStyle: { color: "color-mix(in srgb, var(--c2) 50%, transparent)", opacity: 0.4 } }] }} />

<Chart id="literal" label="Literal" option={{ xAxis: { type: "category", data: ["a", "b"] }, yAxis: {}, series: [{ type: "bar", data: [1, 3], itemStyle: { color: "#ed5c93" } }] }} />
`,
			),
		);
		// A token mixed with a literal, a lightness change and a replaced alpha are colours no CSS expression gives exactly.
		expect(figures.get("to-literal")).toBeUndefined();
		expect(figures.get("lightness")).toBeUndefined();
		expect(figures.get("replaced-alpha")).toBeUndefined();
		// An opacity multiplies the expression's own alpha, in the drawing as on the canvas.
		expect(figures.get("multiplied-alpha")).toMatch(
			/fill-opacity="0.4" style="fill:color-mix\(in srgb, var\(--c2\) 50%, transparent\)"/,
		);
		// A colour the option writes as it is stays that colour, never a stand-in's expression.
		expect(figures.get("literal")).toContain('fill="#ed5c93"');
		expect(figures.get("literal")).not.toContain("var(--under)");
	}, 30_000);

	test("take the height the page's CSS gives the element, by specificity and !important, else no drawing", async () => {
		const sized = await packedMdx(
			dir,
			"sized",
			`import { Chart, Plot } from "kit";
import "./sized.css";

# Sized

<Chart id="small" label="Small" option={BARS} />

<Chart id="loud" class="loud" label="Loud" option={BARS} />

<Plot id="low" label="Low" option={{ series: [{ data: [[0, 0], [1, 1]] }] }} />

<Chart class="tall" label="Tall" option={BARS} />

export const BARS = { xAxis: { type: "category", data: ["a"] }, yAxis: {}, series: [{ type: "bar", data: [1] }] };
`,
			{
				"sized.css": `#small { block-size: 100px; }
.chart { block-size: 300px; }
.chart.loud { block-size: clamp(10rem, 20vw, 14rem) !important; }
#loud { block-size: 50px; }
#low { height: 200px; }
`,
			},
		);
		const figures = drawnFigures(sized);
		// The id outranks the later class; !important outranks the id (14rem on a desktop, 10rem on a phone); the Plot's area is
		// its 200 px less the padding; .tall takes the page's .chart, which outranks the theme's layer.
		expect(viewBoxes(figures.get("small"))).toEqual(["1054x100", "527x100", "356x100"]);
		expect(viewBoxes(figures.get("loud"))).toEqual(["1054x224", "527x224", "356x160"]);
		expect(viewBoxes(figures.get("low"))).toEqual(["1054x192", "527x192", "356x192"]);
		expect(viewBoxes(figures.get("figure-4"))).toEqual(["1054x300", "527x300", "356x300"]);
		// With scripts off, the copy showing fills its element at its drawn size, so its text is as large as the live chart's.
		const scales = await withPage(async (cdp) => {
			await Promise.all(["Page", "Runtime"].map((domain) => cdp.send(`${domain}.enable`)));
			await cdp.send("Emulation.setScriptExecutionDisabled", { value: true });
			const found: number[] = [];
			for (const viewport of WIDTHS) {
				await cdp.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1 });
				await cdp.load(`file://${sized}`);
				found.push(...(await cdp.evaluate<number[]>(DRAWN_SCALES)));
			}
			return found;
		});
		expect(scales).toHaveLength(WIDTHS.length * 4);
		for (const scale of scales) {
			expect(scale).toBeGreaterThan(0.9);
			expect(scale).toBeLessThan(1.1);
		}
	}, 60_000);

	test("draw nothing where a page rule might set the height and pack cannot tell what it comes to", async () => {
		const figures = drawnFigures(
			await packedMdx(
				dir,
				"unsized",
				`import { Chart, Plot } from "kit";
import "./unsized.css";

# Unsized

<Chart id="nested" label="Nested" option={BARS} />

<Chart id="queried" class="queried" label="Queried" option={BARS} />

<Plot id="relative" class="relative" label="Relative" option={{ series: [{ data: [[0, 0], [1, 1]] }] }} />

<Chart id="free" label="Free" option={BARS} />

export const BARS = { xAxis: { type: "category", data: ["a"] }, yAxis: {}, series: [{ type: "bar", data: [1] }] };
`,
				{
					"unsized.css": `.page #nested { block-size: 5rem; }
@media (min-width: 60rem) { .queried { block-size: 30rem; } }
.relative { block-size: 50%; }
.key svg { block-size: 1rem; }
`,
				},
			),
		);
		expect(figures.get("nested")).toBeUndefined();
		expect(figures.get("queried")).toBeUndefined();
		expect(figures.get("relative")).toBeUndefined();
		// No rule could reach this one (an svg is not a chart), so the theme's height stands.
		expect(viewBoxes(figures.get("free"))).toEqual(["1054x416", "527x416", "356x288"]);
	}, 30_000);
});

/**
 * The markup pack drew inside each figure of a packed page, by the figure's id ("figure-N", counted from 1, for one without),
 * and undefined for a figure it left undrawn.
 */
function drawnFigures(path: string): Map<string, string | undefined> {
	const parts = readFileSync(path, "utf8")
		.split(/(?=<div class="chart[ "])/)
		.slice(1);
	return new Map(
		parts.map((part, i): [string, string | undefined] => {
			const id = /^<div [^>]*\bid="([^"]+)"/.exec(part)?.[1] ?? `figure-${i + 1}`;
			const drawn =
				/^<div [^>]*>(?:<ul class="plot-legend">.*?<\/ul><div class="plot-area">)?(<div class="chart-drawn".*)/s.exec(
					part,
				);
			return [id, drawn?.[1]];
		}),
	);
}

/** The width and height of each copy's viewBox in a figure's drawn markup. */
const viewBoxes = (drawn: string | undefined) =>
	[...(drawn ?? "").matchAll(/<svg viewBox="0 0 (\d+) (\d+)"/g)].map((m) => `${m[1]}x${m[2]}`);

/** Page expression: for each drawn copy showing, how much it is scaled to fit its element (1 when drawn at the element's size). */
const DRAWN_SCALES = `[...document.querySelectorAll(".chart-drawn > svg")].filter((svg) => svg.getBoundingClientRect().width > 0).map((svg) => {
	const box = svg.parentElement.getBoundingClientRect();
	const [, , width, height] = svg.getAttribute("viewBox").split(" ").map(Number);
	return Math.min(box.width / width, box.height / height);
})`;

/**
 * Page expression: how many drawn copies are left, whether ECharts mounted the chart, the plot's live lines, and whether the
 * chart's middle reaches the live chart rather than a copy over it.
 */
const LIVE_STATE = `(() => {
	const chart = document.getElementById("bars");
	const box = chart.getBoundingClientRect();
	const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
	return {
		drawn: document.querySelectorAll(".chart-drawn").length,
		chart: Boolean(echarts.getInstanceByDom(chart)),
		plotLines: document.querySelectorAll("#lines svg path.line").length,
		onTop: hit?.tagName === "CANVAS" && chart.contains(hit),
	};
})()`;

/** Page expression: whether ECharts' tooltip shows the hovered day's bar. */
const TOOLTIP = `[...document.querySelectorAll("#bars div")].some((d) => getComputedStyle(d).display !== "none" && getComputedStyle(d).opacity !== "0" && /Load/.test(d.textContent) && /Mon|Tue/.test(d.textContent))`;

/** Page expression: the first legend button's state and the lines the plot draws after it was pressed. */
const PLOT_LEGEND = `({ pressed: document.querySelector("#lines .plot-legend button").getAttribute("aria-pressed"), lines: document.querySelectorAll("#lines svg path.line").length })`;
