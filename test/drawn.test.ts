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

const OPTION = `{ xAxis: { type: "category", data: ["a", "b"] }, yAxis: {}, series: [{ type: "bar", data: [1, 3] }] }`;
const CHART = (extra: string) =>
	`{ xAxis: { type: "category", data: ["a", "b"] }, yAxis: {}, ${extra} }`;
/** A Plot whose legend has four names: it takes one row from half a column up, and two on a phone. */
const LEGEND_PLOT = (names: string[]) =>
	`{ series: [${names.map((name, i) => `{ name: "${name}", data: [[0, ${i}], [1, ${i + 1}]] }`).join(", ")}] }`;

describe("what pack draws is exact, or nothing", () => {
	test("a colour pack cannot read back exactly leaves its figure to the live chart", async () => {
		const figures = drawnFigures(
			await packedMdx(
				dir,
				"unreadable",
				`import { Chart } from "kit";
import { paint } from "./paint.tsx";

# Unreadable

<Chart id="to-literal" label="Token to literal" option={{ xAxis: { type: "category", data: ["a", "b"] }, yAxis: { type: "category", data: ["x"] }, visualMap: { min: 0, max: 10, inRange: { color: ["var(--c2)", "#ff0000"] } }, series: [{ type: "heatmap", data: [[0, 0, 0], [1, 0, 3]] }] }} />

<Chart id="callback" label="Callback" option={${CHART('series: [{ type: "bar", data: [1, 3], itemStyle: { color: paint } }]')}} />

<Chart id="lightness" label="Lightness" option={${CHART('visualMap: { show: false, min: 0, max: 10, inRange: { colorLightness: [0.2, 0.8] } }, series: [{ type: "bar", data: [1, 3], itemStyle: { color: "var(--c2)" } }]')}} />

<Chart id="alpha-replaced" label="Alpha replaced" option={${CHART('visualMap: { show: false, min: 0, max: 10, inRange: { colorAlpha: [0.4, 0.4] } }, series: [{ type: "bar", data: [1, 3], itemStyle: { color: "color-mix(in srgb, var(--c2) 50%, transparent)" } }]')}} />

<Chart id="alpha-restored" label="Alpha restored" option={${CHART('visualMap: { show: false, min: 0, max: 10, inRange: { colorAlpha: [1, 1] } }, series: [{ type: "bar", data: [1, 3], itemStyle: { color: "color-mix(in srgb, var(--c2) 50%, transparent)" } }]')}} />

<Chart id="translucent-mix" label="Translucent mix" option={{ xAxis: { type: "category", data: ["a", "b"] }, yAxis: { type: "category", data: ["x"] }, visualMap: { min: 0, max: 10, inRange: { color: ["var(--c2)", "color-mix(in srgb, var(--c5) 30%, transparent)"] } }, series: [{ type: "heatmap", data: [[0, 0, 0], [1, 0, 3]] }] }} />

<Chart id="mark-area" label="Mark area" option={${CHART('series: [{ type: "bar", data: [1, 3], itemStyle: { color: "color-mix(in srgb, var(--c2) 50%, transparent)" }, markArea: { data: [[{ xAxis: "a" }, { xAxis: "b" }]] } }]')}} />

<Chart id="mark-area-token" label="Mark area, opaque token" option={${CHART('series: [{ type: "bar", data: [1, 3], itemStyle: { color: "var(--c2)" }, markArea: { data: [[{ xAxis: "a" }, { xAxis: "b" }]] } }]')}} />

<Chart id="multiplied-alpha" label="Multiplied alpha" option={${CHART('series: [{ type: "line", data: [1, 3], areaStyle: { color: "color-mix(in srgb, var(--c2) 50%, transparent)", opacity: 0.4 } }]')}} />

<Chart id="literal" label="Literal" option={${CHART('series: [{ type: "bar", data: [1, 3], itemStyle: { color: "#ed5c93" } }]')}} />
`,
				{ "paint.tsx": `"use client";\nexport const paint = () => "#b26d3c";\n` },
			),
		);
		// A token mixed with a literal or a translucent colour, a colour function, a transform of alpha or lightness and a
		// markArea over a colour that may be translucent are colours no CSS expression gives exactly.
		for (const id of [
			"to-literal",
			"callback",
			"lightness",
			"alpha-replaced",
			"alpha-restored",
			"translucent-mix",
			"mark-area",
		]) {
			expect(figures.get(id), id).toBeUndefined();
		}
		// An opaque token under a markArea, and an opacity over an expression's own alpha (which multiplies it, as on the canvas), are exact.
		expect(figures.get("mark-area-token")).toContain("var(--c2)");
		expect(figures.get("multiplied-alpha")).toMatch(
			/fill-opacity="0.4" style="fill:color-mix\(in srgb, var\(--c2\) 50%, transparent\)"/,
		);
		// A colour the option writes as it is stays that colour, never a stand-in's expression.
		expect(figures.get("literal")).toContain('fill="#ed5c93"');
		expect(figures.get("literal")).not.toContain("var(--under)");
	}, 30_000);

	test("take the height from the kit: the theme's, tall, or the height prop; with scripts off the drawing fits its element", async () => {
		const sized = await packedMdx(
			dir,
			"sized",
			`import { Chart, Plot } from "kit";

# Sized

<Chart id="theme" label="Theme" option={${OPTION}} />

<Chart id="tall" class="tall" label="Tall" option={${OPTION}} />

<Chart id="short" height="100px" label="Short" option={${OPTION}} />

<Chart id="clamped" height="clamp(10rem, 20vw, 14rem)" label="Clamped" option={${OPTION}} />

<Plot id="plot" height="200px" label="Plot" option={{ series: [{ data: [[0, 0], [1, 1]] }] }} />

<Chart id="percent" height="50%" label="Percent" option={${OPTION}} />
`,
		);
		const figures = drawnFigures(sized);
		// The Plot's area is its 200 px less the legend's padding; a height that is no plain length is the live chart's to draw.
		expect(viewBoxes(figures.get("theme"))).toEqual(["1054x416", "527x416", "356x288"]);
		expect(viewBoxes(figures.get("tall"))).toEqual(["1054x544", "527x544", "356x352"]);
		expect(viewBoxes(figures.get("short"))).toEqual(["1054x100", "527x100", "356x100"]);
		expect(viewBoxes(figures.get("clamped"))).toEqual(["1054x224", "527x224", "356x160"]);
		expect(viewBoxes(figures.get("plot"))).toEqual(["1054x192", "527x192", "356x192"]);
		expect(figures.get("percent")).toBeUndefined();
		await expectFitted(sized, 5);
	}, 60_000);

	test("draw nothing where a page rule may change the element's box", async () => {
		const figures = drawnFigures(
			await packedMdx(
				dir,
				"unsized",
				`import { Chart, Plot } from "kit";
import "./unsized.css";

# Unsized

<Chart id="sized" label="Sized" option={${OPTION}} />

<Chart id="nested" label="Nested" option={${OPTION}} />

<Chart id="queried" class="queried" label="Queried" option={${OPTION}} />

<Chart id="padded" class="padded" label="Padded" option={${OPTION}} />

<Chart id="bordered" class="bordered" label="Bordered" option={${OPTION}} />

<Chart id="reset" class="reset" label="Reset" option={${OPTION}} />

<Chart id="animated" class="animated" label="Animated" option={${OPTION}} />

<Plot id="relative" class="relative" label="Relative" option={{ series: [{ data: [[0, 0], [1, 1]] }] }} />

<Chart id="free" label="Free" option={${OPTION}} />
`,
				{
					"unsized.css": `#sized { block-size: 100px; }
.chart { color: red; }
.page #nested { block-size: 5rem; }
@media (min-width: 60rem) { .queried { block-size: 30rem; } }
.padded { padding: 2rem; }
.bordered { border: 1px solid; }
.reset { all: revert-layer; }
.animated { animation: grow 1s forwards; }
@keyframes grow { to { block-size: 30rem; } }
.relative { block-size: 50%; }
.key svg { block-size: 1rem; padding: 1rem; }
[data-step] { inline-size: max-content; }
`,
				},
			),
		);
		for (const id of [
			"sized",
			"nested",
			"queried",
			"padded",
			"bordered",
			"reset",
			"animated",
			"relative",
		]) {
			expect(figures.get(id), id).toBeUndefined();
		}
		// No rule that sets a size or a border reaches this one (an svg or a [data-step] is not a chart; a colour changes no box): the theme's height stands.
		expect(viewBoxes(figures.get("free"))).toEqual(["1054x416", "527x416", "356x288"]);
	}, 30_000);

	test("draw nothing where a page rule may set the root font size rem is read against", async () => {
		const figures = drawnFigures(
			await packedMdx(
				dir,
				"rootfont",
				`import { Chart } from "kit";
import "./rootfont.css";

# Root font

<Chart id="chart" label="Chart" option={${OPTION}} />
`,
				{ "rootfont.css": ":root { font-size: 20px; }\n" },
			),
		);
		expect(figures.get("chart")).toBeUndefined();
	}, 30_000);

	test("count the rows a plot's legend wraps into at each width, and draw nothing where they are not the same across a copy's widths", async () => {
		const legends = await packedMdx(
			dir,
			"legends",
			`import { Plot } from "kit";

# Legends

<Plot id="one-row" label="One row" option={${LEGEND_PLOT(["Load", "Peak"])}} />

<Plot id="straddles" height="300px" label="Straddles" option={${LEGEND_PLOT(["Voltage", "Current", "Power draw", "Efficiency"])}} />


<Plot id="many" label="Many" option={${LEGEND_PLOT(["Mean load on the main feeder", "Peak load on the main feeder", "Mean load on the spare feeder", "Peak load on the spare feeder", "Mean load on the backup", "Peak load on the backup"])}} />
`,
		);
		const figures = drawnFigures(legends);
		// One row of 30.2 px and 8 px of padding above the area.
		expect(viewBoxes(figures.get("one-row"))).toEqual(["1054x377.8", "527x377.8", "356x249.8"]);
		// Four names wrap on the narrowest phone but fit one row at 420 px, where the phone copy is shown as well.
		expect(figures.get("straddles")).toBeUndefined();
		// Six long names take one row, two or three by the width the copy is shown at.
		expect(figures.get("many")).toBeUndefined();
		await expectFitted(legends, 2);
	}, 60_000);
});

/** Opens the page with scripts off at each width, and expects its `count` drawn copies showing to fit their elements at the drawn size. */
async function expectFitted(path: string, count: number): Promise<void> {
	// With scripts off, the copy showing fills its element at its drawn size, so its text is as large as the live chart's.
	const scales = await withPage(async (cdp) => {
		await Promise.all(["Page", "Runtime"].map((domain) => cdp.send(`${domain}.enable`)));
		await cdp.send("Emulation.setScriptExecutionDisabled", { value: true });
		const found: number[] = [];
		for (const viewport of WIDTHS) {
			await cdp.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1 });
			await cdp.load(`file://${path}`);
			found.push(...(await cdp.evaluate<number[]>(DRAWN_SCALES)));
		}
		return found;
	});
	expect(scales).toHaveLength(WIDTHS.length * count);
	for (const scale of scales) {
		expect(scale).toBeGreaterThan(0.98);
		expect(scale).toBeLessThan(1.02);
	}
}

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
	[...(drawn ?? "").matchAll(/<svg viewBox="0 0 ([\d.]+) ([\d.]+)"/g)].map(
		(m) => `${m[1]}x${m[2]}`,
	);

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
