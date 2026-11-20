import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { pageDrawer } from "../skills/explainer/src/mdx/draw.ts";
import { runStep } from "../skills/explainer/src/steps.ts";
import { withTestPage } from "./browser.ts";
import { inPage, packedMdx, scratch, WIDTHS } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/** A Chart with a legend, a tooltip and a token colour, and a Plot with a legend, written as authors write them. */
const PAGE = `import { Chart, Plot } from "kit";

# Drawn

<Chart id="bars" label="Load by day" option={{ legend: {}, tooltip: { trigger: "axis" }, xAxis: { type: "category", data: ["Mon", "Tue"] }, yAxis: {}, series: [{ name: "Load", type: "bar", data: [1, 2], itemStyle: { color: "var(--c3)" } }] }} />

<Plot id="lines" label="Two lines" option={{ legend: true, series: [{ name: "Rising", data: [[0, 0], [1, 2]] }, { name: "Flat", data: [[0, 1], [1, 1]] }] }} />
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
	return withTestPage(async (cdp) => {
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
/** A Plot with a legend of the names: four take one row from half a column up, and two on a phone. */
const LEGEND_PLOT = (names: string[]) =>
	`{ legend: true, series: [${names.map((name, i) => `{ name: "${name}", data: [[0, ${i}], [1, ${i + 1}]] }`).join(", ")}] }`;

test("only stable dataset and styled legends keep their drawings", async () => {
	const names = ["Northwest region", "Northeast region", "Southwest region", "Southeast region"];
	const series = names.map((name) => ({ name, type: "bar", data: [1, 3] }));
	const option = { legend: {}, xAxis: { type: "category", data: ["a", "b"] }, yAxis: {}, series };
	// Names short enough for one row at every width, so only the thick stroke can keep the drawing out.
	const lines = {
		...option,
		series: ["One", "Two", "Three", "Four"].map((name) => ({ name, type: "line", data: [1, 3] })),
	};
	const dataset = {
		...option,
		dataset: {
			source: [
				// Short enough to keep one row at the label size down to the narrowest phone.
				["Category", "One", "Two", "Three", "Four"],
				["a", 1, 2, 3, 4],
			],
		},
		series: Array.from({ length: 4 }, () => ({ type: "bar" })),
	};
	const figures = drawnFigures(
		await packedMdx(
			dir,
			"chart-legends",
			`import { Chart } from "kit";

# Chart legends

<Chart id="wraps" label="Wraps" option={${JSON.stringify(option)}} />
<Chart id="dataset" label="Dataset" option={${JSON.stringify(dataset)}} />
<Chart id="dataset-wraps" label="Dataset wraps" option={${JSON.stringify({ ...dataset, legend: { textStyle: { fontSize: 36 } } })}} />
<Chart id="stroke" label="Thick legend lines" option={${JSON.stringify({ ...lines, legend: { lineStyle: { width: 40 } } })}} />
<Chart id="thin" label="Legend lines" option={${JSON.stringify(lines)}} />
<Chart id="hidden" label="Hidden legend" option={${JSON.stringify({ ...option, legend: { show: false } })}} />
`,
		),
	);
	for (const id of ["wraps", "dataset-wraps", "stroke"]) {
		expect(figures.get(id), id).toBeUndefined();
	}
	expect(figures.get("dataset")).toContain("Three");
	expect(figures.get("hidden")).toContain("chart-drawn");
	expect(figures.get("thin")).toContain("chart-drawn");
}, 30_000);

test("documented numeric formats retain their drawings, including locale spaces and euros", () => {
	const drawer = pageDrawer("sl", []);
	for (const format of [{ unit: "min" }, { currency: "EUR" }, { percent: true }]) {
		const svg = drawer.chart(
			{
				xAxis: { type: "category", data: ["a", "b"] },
				yAxis: { axisLabel: { formatter: format } },
				series: [{ type: "bar", data: [1, 2] }],
			},
			{ classes: ["chart"], id: undefined, height: undefined },
		);
		expect(svg).toContain("chart-drawn");
	}
});

test("each SSR copy lays out the effective legend and keeps explicit scroll legends drawn", async () => {
	const base = {
		legend: {},
		grid: [{}],
		xAxis: [{ type: "category", data: ["a", "b"] }],
		yAxis: [{}],
		series: ["Load"].map((name) => ({
			name,
			type: "bar",
			data: [1, 3],
		})),
	};
	const path = await packedMdx(
		dir,
		"effective-drawn-legends",
		`import { Chart } from "kit";

# Effective legends

<Chart id="inherited" height="520px" label="Inherited" option={${JSON.stringify({ ...base, textStyle: { fontSize: 60 } })}} />
<Chart id="media" height="520px" label="Responsive" option={${JSON.stringify({ baseOption: { ...base, textStyle: { fontSize: 60 } }, media: [{ query: { minWidth: 440 }, option: { textStyle: { fontSize: 12 } } }] })}} />
<Chart id="unknown" label="Unknown glyphs" option={${JSON.stringify({ ...base, series: [{ name: "東京", type: "bar", data: [1, 3] }] })}} />
<Chart id="scroll" label="Explicit scroll legend" option={${JSON.stringify({ ...base, grid: { top: 64, left: 8, right: 24, bottom: 8 }, legend: { type: "scroll", top: 8, left: 8, right: 8 } })}} />
`,
	);
	const figures = drawnFigures(path);
	expect(figures.get("scroll")).toContain("chart-drawn");
	expect(figures.get("unknown")).toBeUndefined();
	for (const id of ["inherited", "media"]) {
		expect(viewBoxes(figures.get(id))).toEqual(["1054x520", "527x520", "356x520"]);
	}
	const gaps = await withTestPage(async (cdp) => {
		await Promise.all(["Page", "Runtime"].map((domain) => cdp.send(`${domain}.enable`)));
		await cdp.send("Emulation.setScriptExecutionDisabled", { value: true });
		await cdp.load(`file://${path}`);
		return cdp.evaluate<number[]>(
			`document.fonts.ready.then(() => {
			return [...document.querySelectorAll("#inherited .chart-drawn > svg, #media .chart-drawn > svg")].map(svg => {
				svg.style.cssText = "display:block;width:" + svg.viewBox.baseVal.width + "px;max-width:none;height:auto";
				const bar = svg.querySelector('path[style*="fill:var(--c1)"]');
				const legend = [...svg.querySelectorAll("text")].filter(t => t.textContent === "Load");
				return Math.min(...legend.map(t => t.getBoundingClientRect().top)) - bar.getBoundingClientRect().bottom;
			});
		})`,
			true,
		);
	});
	expect(gaps).toHaveLength(6);
	for (const gap of gaps) {
		expect(gap).toBeGreaterThanOrEqual(8);
	}
}, 30_000);

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

<Plot id="entities" height="300px" label="Entities" option={${LEGEND_PLOT(["&&&&", "&&&&", "&&&&"])}} />

<Plot id="many" label="Many" option={${LEGEND_PLOT(["Mean load on the main feeder", "Peak load on the main feeder", "Mean load on the spare feeder", "Peak load on the spare feeder", "Mean load on the backup", "Peak load on the backup"])}} />
`,
		);
		const figures = drawnFigures(legends);
		// One row of 30.2 px and 8 px of padding above the area.
		expect(viewBoxes(figures.get("one-row"))).toEqual(["1054x377.8", "527x377.8", "356x249.8"]);
		// Four names wrap on the narrowest phone but fit one row at 420 px, where the phone copy is shown as well.
		expect(figures.get("straddles")).toBeUndefined();
		// Rows are counted on the text a reader sees: "&&&&" is not "&#38;&#38;&#38;&#38;".
		expect(viewBoxes(figures.get("entities"))).toEqual(["1054x261.8", "527x261.8", "356x261.8"]);
		// Six long names take one row, two or three by the width the copy is shown at.
		expect(figures.get("many")).toBeUndefined();
		await expectFitted(legends, 2);
	}, 60_000);
});

test("draw nothing where a page sets the label size figures' text is drawn at (#190)", async () => {
	const figures = drawnFigures(
		await packedMdx(
			dir,
			"labelsize",
			`import { Chart, Plot } from "kit";
import "./labelsize.css";

# Label size

<Chart id="chart" label="Chart" option={${OPTION}} />

<Plot id="plot" label="Plot" option={{ series: [{ data: [[0, 0], [1, 1]] }] }} />
`,
			{ "labelsize.css": ".band { --size-label: 0.875rem; }\n" },
		),
	);
	expect(figures.get("chart")).toBeUndefined();
	expect(figures.get("plot")).toBeUndefined();
}, 30_000);

test("draw nothing where a page sets the lines a plot keeps for its marker labels, or a chart's title size (#190)", async () => {
	const figures = drawnFigures(
		await packedMdx(
			dir,
			"marklines",
			`import { Chart, Plot } from "kit";
import "./marklines.css";

# Mark lines

<Plot id="plot" label="Plot" option={{ categories: ["a"], horizontal: true, series: [{ type: "bar", data: [1] }], marks: [{ x: 0.5, label: "Half" }] }} />

<Chart id="titled" label="Titled" option={{ title: { text: "Title" }, ...${OPTION} }} />

<Chart id="plain" label="Plain" option={${OPTION}} />
`,
			{ "marklines.css": ".a { --plot-mark-lines: 3; }\n.b { --size-text: 1.25rem; }\n" },
		),
	);
	expect(figures.get("plot")).toBeUndefined();
	expect(figures.get("titled")).toBeUndefined();
	// A chart with no title has no text at the text size.
	expect(figures.get("plain")).toContain("chart-drawn");
}, 30_000);

/** Opens the page with scripts off at each width, and expects its `count` drawn copies showing to fit their elements at the drawn size. */
async function expectFitted(path: string, count: number): Promise<void> {
	// With scripts off, the copy showing fills its element at its drawn size, so its text is as large as the live chart's.
	const scales = await withTestPage(async (cdp) => {
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
	// The page's figures end with its main element: what follows is its scripts.
	const html = readFileSync(path, "utf8");
	const parts = html
		.slice(0, html.indexOf("</main>"))
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

test("SSR legend rows and plot bounds match the live chart's text metrics", async () => {
	const path = await packedMdx(
		dir,
		"legend-metrics",
		`import { Chart } from "kit";

# Legend metrics

<Chart id="metrics" height="520px" label="Metrics" option={{ grid: { bottom: 180 }, legend: { width: 280, textStyle: { fontSize: 36 } }, xAxis: { type: "category", data: ["a", "b"] }, yAxis: {}, series: ["First", "Second", "Third", "Fourth"].map(name => ({ name, type: "bar", data: [1, 2] })) }} />
<Chart id="explicit-metrics" height="520px" label="Explicit line height" option={{ grid: { bottom: 180 }, legend: { width: 280, textStyle: { fontSize: 36, lineHeight: 52 } }, xAxis: { type: "category", data: ["a", "b"] }, yAxis: {}, series: ["First", "Second", "Third", "Fourth"].map(name => ({ name, type: "bar", data: [1, 2] })) }} />
`,
	);
	const drawn = await withTestPage(async (cdp) => {
		await Promise.all(["Page", "Runtime"].map((domain) => cdp.send(`${domain}.enable`)));
		await cdp.send("Emulation.setScriptExecutionDisabled", { value: true });
		await cdp.load(`file://${path}`);
		return cdp.evaluate<{ advance: number; bottom: number }[]>(
			`document.fonts.ready.then(() => ["metrics", "explicit-metrics"].map(id => {
			const svg = document.querySelector('#' + id + ' svg[data-fit="phone"]');
			svg.style.cssText = "display:block;width:356px;height:auto";
			const texts = [...svg.querySelectorAll("text")];
			const y = name => texts.find(t => t.textContent === name).getBoundingClientRect().top;
			return { advance: y("Third") - y("First"), bottom: svg.querySelector('path[style*="fill:var(--c1)"]').getBoundingClientRect().bottom - svg.getBoundingClientRect().top };
		}))`,
			true,
		);
	});
	const live = await inPage(
		path,
		(cdp) =>
			cdp.evaluate<
				{ advance: number; bottom: number }[]
			>(`["metrics", "explicit-metrics"].map(id => {
		const chart = echarts.getInstanceByDom(document.getElementById(id));
		const model = chart.getModel();
		const items = chart.getViewOfComponentModel(model.getComponent("legend")).getContentGroup().children();
		const grid = model.getComponent("grid").coordinateSystem.getRect();
		return { advance: items[2].y - items[0].y, bottom: grid.y + grid.height };
	})`),
		{ width: 390, height: 844, mobile: false },
	);
	for (const [i, metric] of live.entries()) {
		expect(Math.abs((drawn[i]?.advance ?? 0) - metric.advance)).toBeLessThan(1);
		expect(Math.abs((drawn[i]?.bottom ?? 0) - metric.bottom)).toBeLessThan(1);
	}
	expect(live[1]?.advance).toBeCloseTo(60, 2);
}, 30_000);

test("a horizontal bar plot is as tall as its bars need, up to the tall 34rem, unless a height or tall is given (#190)", async () => {
	const bars = (n: number) =>
		`{ categories: ${JSON.stringify(Array.from({ length: n }, (_, i) => `Bar ${i + 1}`))}, horizontal: true, series: [{ type: "bar", data: ${JSON.stringify(Array.from({ length: n }, (_, i) => i + 1))} }] }`;
	const marked = (label: string) =>
		`{ categories: ["a", "b", "c"], horizontal: true, series: [{ type: "bar", data: [1, 2, 3] }], marks: [{ x: 1.5, label: ${JSON.stringify(label)} }] }`;
	const path = await packedMdx(
		dir,
		"bar-rows",
		`import { Plot } from "kit";

# Bar rows

<Plot id="three" label="Three" option={${bars(3)}} />

<Plot id="five" label="Five" option={${bars(5)}} />

<Plot id="nine" label="Nine" option={${bars(9)}} />

<Plot id="twenty" label="Twenty" option={${bars(20)}} />

<Plot id="given" height="200px" label="Given" option={${bars(3)}} />

<Plot id="tall" class="tall" label="Tall" option={${bars(3)}} />

<Plot id="named" label="Named" option={{ categories: ["a", "b"], horizontal: true, series: [{ name: "First series", type: "bar", data: [1, 2] }, { name: "Second series", type: "bar", data: [2, 1] }] }} />

<Plot id="legend" label="Legend" option={{ categories: ["a", "b"], horizontal: true, legend: true, series: [{ name: "First series", type: "bar", data: [1, 2] }, { name: "Second series", type: "bar", data: [2, 1] }] }} />

<Plot id="upright" label="Upright" option={{ categories: ["a", "b", "c"], series: [{ type: "bar", data: [1, 2, 3] }] }} />

<Plot id="marked" label="Marked" option={${marked("Payback")}} />

<Plot id="wraps" label="Wraps" option={${marked("16 years: cells rated for 6,000 cycles")}} />
`,
	);
	const figures = drawnFigures(path);
	// Three rows of 3.5rem (56 px) between 10 px above and 26 px of value labels below, under the empty legend's 8 px.
	expect(viewBoxes(figures.get("three"))).toEqual(["1054x204", "527x204", "356x204"]);
	// Five rows are 20.25rem; nine would pass the tall 34rem, and so would twenty: their rows share it.
	expect(viewBoxes(figures.get("five"))).toEqual(["1054x316", "527x316", "356x316"]);
	expect(viewBoxes(figures.get("nine"))).toEqual(["1054x536", "527x536", "356x536"]);
	expect(viewBoxes(figures.get("twenty"))).toEqual(["1054x536", "527x536", "356x536"]);
	expect(viewBoxes(figures.get("given"))).toEqual(["1054x192", "527x192", "356x192"]);
	expect(viewBoxes(figures.get("tall"))).toEqual(["1054x536", "527x536", "356x344"]);
	expect(viewBoxes(figures.get("upright"))).toEqual(["1054x408", "527x408", "356x280"]);
	// Bars side by side carry their names above the first row: a line each over the rows (#190, owner 2026-11-20).
	expect(viewBoxes(figures.get("named"))).toEqual(["1054x182", "527x182", "356x182"]);
	expect(readFileSync(path, "utf8")).toMatch(
		/<div class="chart plot" id="named" style="block-size:11.875rem;?"/,
	);
	// A legend an author asks for wraps into rows by the width, which one height cannot follow: the plot keeps the theme's height.
	expect(figures.get("legend")).toContain('viewBox="0 0 1054 ');
	expect(readFileSync(path, "utf8")).toMatch(/<div class="chart plot" id="legend" role="img"/);
	// The height takes the height prop's path, which the box gate sees, and no custom property sizes a figure.
	const html = readFileSync(path, "utf8");
	expect(html).toMatch(/<div class="chart plot" id="three" style="block-size:13.25rem;?"/);
	expect(html).not.toContain("--plot-height");
	// A marker's label takes a line of its own above the rows, which the height counts as plot.js lays it out at the width.
	expect(viewBoxes(figures.get("marked"))).toEqual(["1054x221", "527x221", "356x221"]);
	expect(html).toMatch(
		/<div class="chart plot" id="marked" style="block-size:calc\(13.25rem \+ var\(--plot-mark-lines, 1\) \* \(var\(--size-label\) \+ 4px\)\);?"/,
	);
	// A label that wraps into more lines on a phone than on a desktop has no one height to draw at: plot.js draws it.
	expect(figures.get("wraps")).toBeUndefined();
	await expectFitted(path, 10);
}, 60_000);

test("no custom property sizes a figure out of pack's sight: a bar plot's height takes the height prop's path", async () => {
	const path = await packedMdx(
		dir,
		"bar-rule",
		`import { Chart, Plot } from "kit";
import "./bar-rule.css";

# Bar rule

<Plot id="three" label="Three" option={{ categories: ["a", "b", "c"], horizontal: true, series: [{ type: "bar", data: [1, 2, 3] }] }} />

<Plot id="line" label="Line" option={{ series: [{ data: [[0, 0], [1, 1]] }] }} />

<Chart id="chart" label="Chart" option={${OPTION}} />
`,
		{ "bar-rule.css": ":is(#three, #line, #chart) { --plot-height: 200px; }" },
	);
	const figures = drawnFigures(path);
	expect(viewBoxes(figures.get("three"))).toEqual(["1054x204", "527x204", "356x204"]);
	expect(viewBoxes(figures.get("line"))).toEqual(["1054x408", "527x408", "356x280"]);
	const heights = await inPage(path, (cdp) =>
		cdp.evaluate<number[]>(
			`["three", "line", "chart"].map((id) => document.getElementById(id).getBoundingClientRect().height)`,
		),
	);
	expect(heights).toEqual([212, 416, 416]);
}, 30_000);

/** Page expression: the series names in chart #id as drawn (scripts off) or live, by text, as boxes relative to the element. */
const DRAWN_ENDS = (id: string) => `(() => {
	const svg = [...document.querySelectorAll("#${id} .chart-drawn > svg")].find((s) => s.getBoundingClientRect().width > 0);
	const at = document.getElementById("${id}").getBoundingClientRect();
	return Object.fromEntries([...svg.querySelectorAll("text")].filter((t) => /rising|flat/i.test(t.textContent)).map((t) => {
		const r = t.getBoundingClientRect();
		return [t.textContent, [r.left - at.left, r.top - at.top, r.width, r.height].map(Math.round)];
	}));
})()`;
const LIVE_ENDS = (id: string) => `(() => {
	const chart = echarts.getInstanceByDom(document.getElementById("${id}"));
	return Object.fromEntries(chart.getZr().storage.getDisplayList().filter((el) => /rising|flat/i.test(el.style?.text ?? "")).map((el) => {
		const r = el.getBoundingRect().clone();
		r.applyTransform(el.getComputedTransform());
		return [el.style.text, [r.x, r.y, r.width, r.height].map(Math.round)];
	}));
})()`;

/** The crowded chart's names stay at their lines' ends, apart, in its drawing (`drawn`) as live. */
function expectCrowdApart(live: Record<string, number[]>, drawn: Record<string, number[]>) {
	expect(Object.keys(live).sort()).toEqual(["Also rising", "Flat", "Rising"]);
	const { Rising: rising = [], "Also rising": also = [] } = live;
	expect(Math.abs((rising[1] ?? 0) - (also[1] ?? 0))).toBeGreaterThanOrEqual(12);
	expect(Math.abs((rising[0] ?? 0) - (also[0] ?? 0))).toBeLessThanOrEqual(1);
	for (const [name, box] of Object.entries(live)) {
		for (const [k, v] of box.entries()) {
			expect(Math.abs((drawn[name]?.[k] ?? -99) - v), name).toBeLessThanOrEqual(2);
		}
	}
}

test("a Chart's several named lines with no legend carry their names at their ends, inside it and drawn as live", async () => {
	const lines = `series: [{ name: "Rising", type: "line", data: [0, 1, 3] }, { name: "Also rising", type: "line", data: [1, 1.5, 2] }, { name: "Flat", type: "line", data: [0, 0, 0] }]`;
	const drawer = pageDrawer("en", []);
	const place = { classes: ["chart"], id: undefined, height: undefined };
	const axes = `xAxis: { type: "category", data: ["a", "b", "c"] }, yAxis: {}`;
	// Two lines that end at one value: their names would sit on each other, so each moves half a line apart, never into a legend.
	const crowd = `series: [{ name: "Rising", type: "line", data: [0, 1, 2] }, { name: "Also rising", type: "line", data: [1, 1.5, 2] }, { name: "Flat", type: "line", data: [0, 0, 0] }]`;
	const option = (extra: string) => new Function(`return { ${axes}, ${lines}${extra} }`)();
	// A legend the author shows or hides, or an end label of their own, keeps the chart as they wrote it.
	expect(drawer.chart(option(""), place)).toContain(">Also rising</text>");
	expect(drawer.chart(option(", legend: { show: false }"), place)).not.toContain(
		">Also rising</text>",
	);
	const path = await packedMdx(
		dir,
		"end-labels",
		`import { Chart } from "kit";

# End labels

<Chart id="ends" label="Ends" option={{ ${axes}, ${lines} }} />

<Chart id="crowd" label="Crowd" option={{ ${axes}, ${crowd} }} />
`,
	);
	const drawn = await withTestPage(async (cdp) => {
		await Promise.all(["Page", "Runtime"].map((domain) => cdp.send(`${domain}.enable`)));
		await cdp.send("Emulation.setScriptExecutionDisabled", { value: true });
		await cdp.send("Emulation.setDeviceMetricsOverride", { ...WIDTHS[0], deviceScaleFactor: 1 });
		await cdp.load(`file://${path}`);
		return cdp.evaluate<{ ends: Record<string, number[]>; crowd: Record<string, number[]> }>(
			`document.fonts.ready.then(() => ({ ends: ${DRAWN_ENDS("ends")}, crowd: ${DRAWN_ENDS("crowd")} }))`,
			true,
		);
	});
	const [lives, legendShown] = await inPage(path, async (cdp) => [
		await cdp.evaluate<{ ends: Record<string, number[]>; crowd: Record<string, number[]> }>(
			`({ ends: ${LIVE_ENDS("ends")}, crowd: ${LIVE_ENDS("crowd")} })`,
		),
		await cdp.evaluate<boolean>(
			`(echarts.getInstanceByDom(document.getElementById("crowd")).getOption().legend ?? []).length > 0`,
		),
	]);
	expect(Object.keys(drawn.ends).sort()).toEqual(["Also rising", "Flat", "Rising"]);
	expect(legendShown).toBe(false);
	expectCrowdApart(lives.crowd, drawn.crowd);
	const live = lives.ends;
	// ECharts' own text boxes (a 12 px line); the DOM's add the font's whole ascent and descent.
	const boxes = Object.values(live);
	for (const [i, [x = 0, y = 0, w = 0, h = 0]] of boxes.entries()) {
		expect(x + w).toBeLessThanOrEqual(1054);
		for (const [ox = 0, oy = 0, ow = 0, oh = 0] of boxes.slice(i + 1)) {
			expect(x + w <= ox || ox + ow <= x || y + h <= oy || oy + oh <= y).toBe(true);
		}
	}
	for (const [name, box] of Object.entries(live)) {
		for (const [k, v] of box.entries()) {
			expect(Math.abs((drawn.ends[name]?.[k] ?? -99) - v)).toBeLessThanOrEqual(2);
		}
	}
}, 60_000);
