import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Cdp } from "../skills/explainer/src/cdp.ts";
import { draw, lines, plotDraw, plotDrawAt, rects, texts, width } from "./plot-draw.ts";
import {
	act,
	inPage,
	packAndRun,
	packedMdx,
	packHtml,
	pageContract,
	runCli,
	scratch,
} from "./support.ts";

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

	const packed = await packHtml(input, output);
	const checked = await runCli([
		"check",
		output,
		"--quick",
		"--view",
		"none",
		"--out",
		dir.path("shots"),
	]);

	expect(packed.error).toBe("");
	expect(readFileSync(output, "utf8")).not.toContain("Apache ECharts");
	expect(checked.code).toBe(0);
}, 30_000);

const BARS = [100, 50, 0];
const BAR_PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><h1>Bars</h1>
<figure class="fig"><div class="chart" id="h"></div></figure>
<figure class="fig"><div class="chart" id="v"></div></figure>
<figure class="fig"><div class="chart" id="l"></div></figure>
<script src="kit:plot.js"></script>
<script>
const bars = { categories: ["A", "B", "C"], series: [{ type: "bar", data: ${JSON.stringify(BARS)}, label: true }] };
Plot.make(document.getElementById("h"), { ...bars, horizontal: true });
Plot.make(document.getElementById("v"), bars);
Plot.make(document.getElementById("l"), { series: [{ type: "line", data: [[NaN, 1], [Infinity, 2]] }] });
const inside = (id) => [...document.querySelectorAll("#" + id + " text.value")].every((t) => {
	const box = t.getBBox(), view = t.ownerSVGElement.viewBox.baseVal;
	return box.x >= 0 && box.y >= 0 && box.x + box.width <= view.width && box.y + box.height <= view.height;
});
const labels = (id) => [...document.querySelectorAll("#" + id + " text.value")].map((t) => t.textContent).join();
${pageContract({
	"horizontal bar labels stay inside the panel": 'inside("h") && labels("h") === "100,50,0"',
	"vertical bar labels stay inside the panel": 'inside("v") && labels("v") === "100,50,0"',
	"a zero bar keeps its title": 'document.querySelectorAll("#h .bar title").length === 3',
	"a line with no finite point draws nothing":
		'document.querySelectorAll("#l path.line").length === 0',
})}
</script></body></html>`;

test("bar labels stay inside the panel and keep zero bars; a line without finite points draws nothing", async () => {
	expect(await packAndRun(dir, "bars", BAR_PAGE)).toEqual([]);
}, 60_000);

const UNLABELLED_PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><h1>Unlabelled</h1>
<figure class="fig"><div class="chart" id="b"></div></figure>
<figure class="fig"><div class="chart" id="s"></div></figure>
<script src="kit:plot.js"></script>
<script>
const showValues = false;
Plot.make(document.getElementById("b"), { categories: ["A", "B"], series: [{ type: "bar", data: [1, 2], label: showValues }] });
Plot.make(document.getElementById("s"), { series: [{ type: "stem", data: [[0, 1], [1, 2]], label: showValues }] });
${pageContract({
	"label: false draws the marks without value text":
		'document.querySelectorAll("#b .bar").length === 2 && document.querySelectorAll("#s .dot").length === 2 && !document.querySelector("text.value")',
})}
</script></body></html>`;

test("label: false draws bars and stems without value text instead of throwing", async () => {
	expect(await packAndRun(dir, "unlabelled", UNLABELLED_PAGE)).toEqual([]);
}, 60_000);

test("a plot's axes carry labels and one quiet baseline at zero, with no gridlines or ticks", () => {
	const wave = draw({
		series: [
			{
				data: [
					[0, -1],
					[1, 1],
					[2, 0.5],
				],
			},
		],
	});
	const bars = draw({
		categories: ["A", "B"],
		horizontal: true,
		series: [{ type: "bar", data: [-1, 3] }],
	} as never);
	for (const svg of [wave, bars]) {
		expect(svg).not.toMatch(/class="(grid|zero)"/);
	}
	// The line plot's baseline runs across at y = 0, in the middle of -1..1; the bars' runs down at x = 0.
	const [across] = lines(wave, "axis");
	expect(lines(wave, "axis")).toHaveLength(1);
	expect(across?.[2]).toBe(across?.[3]);
	expect(across?.[2]).toBeCloseTo((10 + 274) / 2, 0);
	const [down] = lines(bars, "axis");
	expect(lines(bars, "axis")).toHaveLength(1);
	expect(down?.[0]).toBe(down?.[1]);
	// Tick labels stay.
	expect(wave).toContain(">-1<");
	expect(bars).toContain(">A<");
});

test("horizontal bars are 25 px in 56 px rows (#190)", () => {
	// 10 px above the rows and 26 below them: three rows of 56 px.
	const svg = plotDraw.render(
		{ categories: ["A", "B", "C"], horizontal: true, series: [{ type: "bar", data: [1, 2, 3] }] },
		600,
		204,
		width,
		[true],
	);
	const heights = [...svg.matchAll(/<rect class="bar"[^>]* height="([^"]+)"/g)].map((m) =>
		Number(m[1]),
	);
	expect(heights).toHaveLength(3);
	for (const h of heights) {
		expect(h).toBeCloseTo(25, 0);
	}
});

test("a plot's text takes the label size it is given, not a number of its own (#190)", () => {
	const option = {
		categories: ["A", "B"],
		horizontal: true,
		series: [{ type: "bar", data: [1, 2] }],
	};
	// The rows end above the value labels, a label's line and 13 px of gap from the bottom.
	for (const size of [13, 16]) {
		const [down] = lines(plotDrawAt(size).render(option, 600, 200, width, [true]), "axis");
		expect(down?.[3]).toBe(Math.floor(200 - 5 - size - 8));
	}
});

/** Each dash pattern of the lines drawn, "" for a solid one. */
const dashes = (svg: string) =>
	[...svg.matchAll(/<path class="line"([^>]*)>/g)].map(
		(m) => /stroke-dasharray="([^"]+)"/.exec(m[1] ?? "")?.[1] ?? "",
	);

test("default lines tell their slots apart by dash as well as lightness; an author's colour or dash keeps its own line (#190)", () => {
	const flat = (y: number) => [
		[0, y],
		[1, y],
	];
	const svg = draw({
		series: [
			...[0, 1, 2, 3, 4, 5].map((i) => ({ data: flat(i) })),
			{ data: flat(6), color: "var(--accent)" },
			{ data: flat(7), dash: false },
			{ data: flat(8), dash: true },
		],
	});
	const drawn = dashes(svg);
	expect(drawn[0]).toBe("");
	expect(new Set(drawn.slice(0, 6)).size).toBe(6);
	expect(drawn.slice(6)).toEqual(["", "", "6 4"]);
	expect(svg).toContain('style="--c:var(--c2)');
});

/** The segments of a path of M x y L x y pairs. */
const segments = (d: string) =>
	[...d.matchAll(/M([\d.-]+) ([\d.-]+)L([\d.-]+) ([\d.-]+)/g)].map((m) => m.slice(1).map(Number));

test("a bar takes one of the accent's three states, per series or per bar: solid, hollow or hatch (#190)", () => {
	const option = {
		categories: ["A", "B", "C"],
		horizontal: true,
		series: [
			{ type: "bar", data: [10, 62, 165], fill: ["accent", "hollow", "hatch"], label: true },
		],
	};
	const svg = plotDraw.render(option, 600, 204, width, [true]);
	expect(rects(svg, "bar")).toHaveLength(1);
	expect(svg).toMatch(/<rect class="bar" style="--c:var\(--accent\)"/);
	// Hollow: the tint inside an accent outline, drawn inside the bar's box; hatch: a grey outline round lines at 45 degrees.
	expect(rects(svg, "bar hollow")).toHaveLength(1);
	const [hatch] = rects(svg, "bar hatch");
	const [x = 0, y = 0, w = 0, h = 0] = hatch ?? [];
	const d = /<path class="hatching" d="([^"]+)"/.exec(svg)?.[1] ?? "";
	const cuts = segments(d);
	expect(cuts.length).toBeGreaterThan(5);
	const along = cuts.map(([x1 = 0, y1 = 0, x2 = 0, y2 = 0]) => {
		// "/" lines: x + y is the same at both ends, and both ends lie on the bar.
		expect(x1 + y1).toBeCloseTo(x2 + y2, 0);
		for (const [px, py] of [
			[x1, y1],
			[x2, y2],
		] as const) {
			expect(px).toBeGreaterThanOrEqual(x - 0.6);
			expect(px).toBeLessThanOrEqual(x + w + 0.6);
			expect(py).toBeGreaterThanOrEqual(y - 0.6);
			expect(py).toBeLessThanOrEqual(y + h + 0.6);
		}
		return x1 + y1;
	});
	// 6 px apart across the lines: 6 * sqrt(2) along x + y.
	for (const [i, c] of along.slice(1).entries()) {
		expect(c - (along[i] ?? 0)).toBeCloseTo(6 * Math.SQRT2, 0);
	}
	// These values fit outside their bars: ink on the page, not the solid bar's contrast colour.
	expect(svg).toContain('class="value" ');
	expect(svg).not.toContain("value inside");
	// One state for the whole series.
	const hollow = plotDraw.render(
		{ categories: ["A", "B"], series: [{ type: "bar", data: [1, 2], fill: "hollow" }] },
		600,
		300,
		width,
		[true],
	);
	expect(rects(hollow, "bar hollow")).toHaveLength(2);
});

test("a category may carry a muted second line under its name (#190)", () => {
	const note = "4,200 EUR / 410 EUR a year";
	const svg = plotDraw.render(
		{
			categories: [{ name: "first 5 kWh", note }, { name: "second 5 kWh" }, "third"],
			horizontal: true,
			series: [{ type: "bar", data: [10, 62, 165] }],
		},
		600,
		204,
		width,
		[true],
	);
	const names = texts(svg, "cat");
	const [under] = texts(svg, "note");
	expect(names.map((t) => t.text)).toEqual(["first 5 kWh", "second 5 kWh", "third"]);
	expect(under?.text).toBe(note);
	expect(under?.x).toBe(names[0]?.x);
	expect((under?.y ?? 0) - (names[0]?.y ?? 0)).toBeCloseTo(17, 0);
	// The rows start past the longer of the two lines.
	const [bar] = rects(svg, "bar");
	expect(bar?.[0] ?? 0).toBeGreaterThanOrEqual(width(note));
});

test("a bar series' legend swatch shows its state when every bar shares it, and the series' colour when they differ (#190)", () => {
	const legend = (fill: string[]) =>
		plotDraw.legendMarkup({
			categories: ["a", "b"],
			legend: true,
			series: [
				{ name: "Estimated", type: "bar", data: [1, 2], fill },
				{ name: "Measured", type: "bar", data: [2, 1] },
			],
		});
	expect(legend(["hatch", "hatch"])).toContain('<i class="bar hatch"');
	expect(legend(["accent", "accent"])).toContain('<i class="bar" style="--c:var(--accent)');
	const mixed = legend(["accent", "hatch"]);
	expect(mixed).toContain('<i class="bar" style="--c:var(--c1)');
	expect(mixed).not.toMatch(/class="bar (hatch|hollow)"/);
});

test("stacked segments are drawn as one group, which the theme parts by a line in the tone under the plot (#190)", () => {
	const svg = plotDraw.render(
		{
			categories: ["a", "b"],
			stack: true,
			series: [
				{ type: "bar", data: [1, 2] },
				{ type: "bar", data: [2, 1] },
			],
		},
		600,
		300,
		width,
		[true, true],
	);
	expect(svg).toMatch(/<g class="stack">(<rect class="bar"[^>]*>.*?<\/rect>){4}<\/g>/);
	// Side by side, bars do not touch, and take no line.
	expect(
		plotDraw.render(
			{
				categories: ["a"],
				series: [
					{ type: "bar", data: [1] },
					{ type: "bar", data: [2] },
				],
			},
			600,
			300,
			width,
			[true, true],
		),
	).not.toContain('class="stack"');
});

test("live, a narrow bar plot grows by its marker label's lines and keeps its 56 px row; stacked segments part in the tone under them (#190)", async () => {
	const output = await packedMdx(
		dir,
		"marked-bars",
		`import { Plot } from "kit";

# Marked bars

<div style={{ width: "288px" }}>
<Plot id="battery" label="Battery" option={{ categories: ["Battery"], horizontal: true, series: [{ type: "bar", data: [20] }], marks: [{ x: 16, label: "16 years: cells rated for 6,000 cycles" }] }} />
</div>

<Plot id="stacked" label="Stacked" option={{ categories: ["a", "b"], stack: true, series: [{ type: "bar", data: [1, 2] }, { type: "bar", data: [2, 1] }] }} />
`,
	);
	const state = await inPage(output, (cdp) =>
		cdp.evaluate<{
			height: number;
			bar: number;
			lines: number;
			stroke: string[];
			under: string;
		}>(`(() => {
			const el = document.getElementById("battery");
			const seg = getComputedStyle(document.querySelector("#stacked svg .stack .bar"));
			const probe = document.createElement("i");
			probe.style.color = "var(--under)";
			document.getElementById("stacked").append(probe);
			return {
				height: el.getBoundingClientRect().height,
				bar: el.querySelector("svg rect.bar").getBoundingClientRect().height,
				lines: el.querySelectorAll("svg text.mark-label").length,
				stroke: [seg.stroke, seg.strokeWidth],
				under: getComputedStyle(probe).color,
			};
		})()`),
	);
	expect(state.lines).toBeGreaterThan(1);
	expect(state.bar).toBeCloseTo(25, 0);
	// The legend's 8 px, 10 above the row and 26 below it, and the label's lines.
	expect(state.height).toBeCloseTo(8 + 56 + 36 + state.lines * 17, 0);
	expect(state.stroke).toEqual([state.under, "1px"]);
}, 30_000);

/** Reads the Plot's image and legend as Chrome exposes them, and checks that the buttons are not image descendants in HTML. */
async function expectPlotAccessibility(cdp: Cdp) {
	expect(
		await cdp.evaluate(
			`document.querySelector("#lines .plot-legend button").closest('[role="img"]') === null`,
		),
	).toBe(true);
	const { nodes } = await cdp.send<{
		nodes: { ignored: boolean; role?: { value: string }; name?: { value: string } }[];
	}>("Accessibility.getFullAXTree");
	const names = (role: string) =>
		nodes.filter((n) => !n.ignored && n.role?.value === role).map((n) => n.name?.value);
	expect(names("image")).toContain("Two lines");
	expect(names("button")).toEqual(expect.arrayContaining(["Rising", "Flat"]));
}

test("Plot exposes the named drawing and keyboard-operable legend as separate AX nodes (#241)", async () => {
	const output = await packedMdx(
		dir,
		"legend-accessibility",
		`import { Plot } from "kit";

# Plot legend

<Plot id="lines" label="Two lines" option={{ legend: true, series: [{ name: "Rising", data: [[0, 0], [1, 2]] }, { name: "Flat", data: [[0, 1], [1, 1]] }] }} />
`,
	);
	await inPage(output, async (cdp) => {
		await expectPlotAccessibility(cdp);
		const press = async (key: string, code: string, keyCode: number) => {
			for (const type of ["rawKeyDown", "keyUp"]) {
				await cdp.send("Input.dispatchKeyEvent", {
					type,
					key,
					code,
					windowsVirtualKeyCode: keyCode,
				});
			}
		};
		await press("Tab", "Tab", 9);
		const state = () =>
			cdp.evaluate(`[
			document.activeElement.textContent.trim(),
			document.activeElement.getAttribute("aria-pressed"),
			document.querySelectorAll("#lines .plot-area path.line").length,
		]`);
		expect(await state()).toEqual(["Rising", "true", 2]);
		await press(" ", "Space", 32);
		expect(await state()).toEqual(["Rising", "false", 1]);
		await press("Tab", "Tab", 9);
		expect(await state()).toEqual(["Flat", "true", 1]);
		await cdp.send("Emulation.setScriptExecutionDisabled", { value: true });
		await cdp.load(`file://${output}`);
		await expectPlotAccessibility(cdp);
	});
}, 30_000);

test("a series switched off in the legend shows again when the legend gives way to names at the ends", async () => {
	const page = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><h1>Plots</h1><div class="chart" id="p"></div>
<script src="kit:plot.js"></script>
<script>
const plot = Plot.make(document.getElementById("p"), {
	legend: true,
	series: [{ name: "A", type: "stem", data: [[0, 1]] }, { name: "B", data: [[0, 0], [1, 2]] }],
});
var contract = document.fonts.ready.then(() => {
	document.querySelector("#p .plot-legend button").click();
	plot.set({ legend: undefined, series: [{ name: "A", data: [[0, 1], [1, 1]] }, { name: "B", data: [[0, 0], [1, 2]] }] });
	const lines = document.querySelectorAll("#p svg .line").length;
	const legend = document.querySelectorAll("#p .plot-legend button").length;
	return lines === 2 && legend === 0 ? [] : [lines + " lines drawn and " + legend + " legend buttons, not 2 and 0"];
});
</script></body></html>`;
	expect(await packAndRun(dir, "off-legend", page)).toEqual([]);
}, 30_000);

/** A client component whose button replaces its horizontal bar plot's option with a patch, as an Explore frame may. */
const PATCHED_BARS = `"use client";
import { Plot } from "kit";
import { useState } from "preact/hooks";

export function Patched() {
	const [patched, setPatched] = useState(false);
	const option = patched
		? { horizontal: true, categories: ["a"] }
		: { horizontal: true, categories: ["a", "b"], x: { name: "X" }, y: { name: "Y" }, series: [{ type: "bar", data: [1, 2] }] };
	return (
		<div>
			<button type="button" id="patch" onClick={() => setPatched(true)}>Patch</button>
			<Plot id="bars" label="Bars" option={option} />
		</div>
	);
}
`;

test("a bar plot's height follows the option it shows, a patch merged in, with room for both axis names", async () => {
	const output = await packedMdx(
		dir,
		"patched-bars",
		`import { Patched } from "./patched.tsx";\n\n# Patched\n\n<Patched />\n`,
		{ "patched.tsx": PATCHED_BARS },
	);
	const state = `(() => { const el = document.getElementById("bars"); return [el.getBoundingClientRect().height, el.querySelectorAll("svg .bar").length > 0]; })()`;
	await inPage(output, async (cdp) => {
		// Two rows of 56 px, 44 px around them, 22 px for the x name and 18 px for the y name.
		expect(await cdp.evaluate<(number | boolean)[]>(state)).toEqual([196, true]);
		expect(
			await act<(number | boolean)[]>(cdp, `document.getElementById("patch").click()`, state),
		).toEqual([140, true]);
	});
}, 30_000);
