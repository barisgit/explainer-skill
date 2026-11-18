import { afterAll, expect, test } from "bun:test";
import { textWidth } from "../skills/explainer/src/geist.ts";
import { runKitPart } from "../skills/explainer/src/kit.ts";
import { pageDrawer } from "../skills/explainer/src/mdx/draw.ts";
import { inPage, packAndRun, packedMdx, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const drawer = pageDrawer("en", []);
const PLACE = { classes: ["chart"], id: undefined, height: undefined };

/** The drawn copy of a Chart for the desktop column, half of one or a phone. */
function copy(option: Record<string, unknown>, fit: "" | "half" | "phone") {
	const out = drawer.chart(option, PLACE);
	const at = fit ? out.indexOf(`data-fit="${fit}"`) : out.indexOf("<svg");
	return at < 0 ? "" : out.slice(at, out.indexOf("</svg>", at));
}

/** A drawn copy's texts with their place (the translate) and size. */
function texts(svg: string) {
	return [...svg.matchAll(/<text([^>]*)>([^<]*)<\/text>/g)].map(([, attrs = "", text = ""]) => {
		const [, x = "0", y = "0"] = /translate\(([\d.-]+) ([\d.-]+)\)/.exec(attrs) ?? [];
		const dy = Number(/ y="([\d.-]+)"/.exec(attrs)?.[1] ?? 0);
		return {
			text,
			x: Number(x),
			y: Number(y) + dy,
			anchor: /text-anchor="(\w+)"/.exec(attrs)?.[1],
			size: Number(/font-size:([\d.]+)px/.exec(attrs)?.[1] ?? 0),
		};
	});
}

/** Payback years by heating, the catalog's case: a category axis read top to bottom, a value axis with a unit, one marker. */
const PAYBACK = {
	yAxis: { type: "category", inverse: true, data: ["Heat pump", "Gas", "Oil"] },
	xAxis: { type: "value", max: 120, axisLabel: { formatter: "{value} years" } },
	series: [
		{
			type: "bar",
			data: [30, 60, 90],
			markLine: { data: [{ xAxis: 50, name: "Payback" }], label: { formatter: "{b}" } },
		},
	],
};

test("a Chart's text is set at the label size, as the theme's --size-label (#190)", () => {
	for (const fit of ["", "half", "phone"] as const) {
		expect(new Set(texts(copy(PAYBACK, fit)).map((t) => t.size))).toEqual(new Set([13]));
	}
});

test("value-axis labels with a unit leave out the ones that would overlap on a phone (#190)", () => {
	const ticks = texts(copy(PAYBACK, "phone"))
		.filter((t) => t.text.endsWith(" years"))
		.sort((a, b) => a.x - b.x);
	expect(ticks.length).toBeGreaterThan(1);
	for (const [i, tick] of ticks.slice(1).entries()) {
		const before = ticks[i] as (typeof ticks)[number];
		const half = (t: typeof tick) => textWidth(t.text, 13, 400) / 2;
		expect(tick.x - half(tick)).toBeGreaterThan(before.x + half(before));
	}
});

test("a marker's line is dashed ink, its label on top beside it, off the axis labels even on a reversed axis (#190)", () => {
	for (const fit of ["", "phone"] as const) {
		const svg = copy(PAYBACK, fit);
		const line = /<path d="M([\d.]+) ([\d.]+)L[\d.]+ ([\d.]+)"([^>]*stroke-dasharray[^>]*)>/.exec(
			svg,
		);
		expect(line?.[4]).toContain("stroke:var(--ink)");
		const [x = 0, y1 = 0, y2 = 0] = [line?.[1], line?.[2], line?.[3]].map(Number);
		const label = texts(svg).find((t) => t.text === "Payback");
		// Above the top of the line, starting at it rather than centred on it.
		expect(label?.y).toBeLessThan(Math.min(y1, y2));
		expect(label?.anchor).toBe("start");
		expect(label?.x).toBeGreaterThanOrEqual(x);
	}
	// A line across the plot carries its label above its end, inside the plot.
	const across = copy(
		{
			xAxis: { type: "category", data: ["a", "b"] },
			yAxis: {},
			series: [
				{
					type: "bar",
					data: [1, 3],
					markLine: { data: [{ yAxis: 2, name: "Target" }], label: { formatter: "{b}" } },
				},
			],
		},
		"",
	);
	const target = texts(across).find((t) => t.text === "Target");
	const line = /<path d="M([\d.]+) ([\d.]+)L([\d.]+) [\d.]+"[^>]*stroke-dasharray/.exec(across);
	expect(target?.y).toBeLessThan(Number(line?.[2]));
	expect(target?.x).toBeLessThanOrEqual(Number(line?.[3]));
});

test("default lines tell their slots apart by dash; an author's colour or line type keeps its own (#190)", () => {
	const lines = (series: object[]) =>
		copy({ xAxis: { type: "category", data: ["a", "b", "c"] }, yAxis: {}, series }, "");
	const strokes = (svg: string) =>
		[...svg.matchAll(/<path d="M[^"]*"([^>]*)>/g)]
			.map(([, attrs = ""]) => attrs)
			.filter((attrs) => /fill="none"/.test(attrs) && /stroke:var\(--c\d\)/.test(attrs));
	const drawn = strokes(
		lines([
			{ type: "line", data: [1, 2, 3] },
			{ type: "line", data: [2, 1, 2] },
			{ type: "line", data: [3, 3, 1] },
		]),
	);
	expect(drawn).toHaveLength(3);
	expect(drawn[0]).not.toContain("stroke-dasharray");
	const dashes = drawn.slice(1).map((attrs) => /stroke-dasharray="([^"]+)"/.exec(attrs)?.[1]);
	expect(dashes[0]).toBeDefined();
	expect(dashes[1]).toBeDefined();
	expect(dashes[0]).not.toBe(dashes[1]);
	// Set by the author: a colour (the finding) stays solid, a line type stays as written.
	const authored = lines([
		{ type: "line", data: [1, 2, 3] },
		{ type: "line", data: [2, 1, 2], lineStyle: { color: "var(--accent)" } },
		{ type: "line", data: [3, 3, 1], lineStyle: { type: "solid" } },
	]);
	expect(authored).toMatch(/fill="none"(?![^>]*stroke-dasharray)[^>]*stroke:var\(--accent\)/);
	expect(strokes(authored).every((attrs) => !attrs.includes("stroke-dasharray"))).toBe(true);
});

test("the accent's hollow and hatch states draw at pack time as the kit's tokens (#190)", () => {
	const svg = copy(
		{
			xAxis: { type: "category", data: ["Done", "Planned", "Estimated"] },
			yAxis: {},
			series: [
				{
					type: "bar",
					data: [
						{ value: 3, itemStyle: { color: "var(--accent)" } },
						{
							value: 2,
							itemStyle: { color: "var(--hollow)", borderColor: "var(--accent)", borderWidth: 1.5 },
						},
						{
							value: 4,
							itemStyle: {
								color: "transparent",
								borderColor: "var(--hatch)",
								borderWidth: 1,
								decal: {
									symbol: "rect",
									symbolSize: 1,
									dashArrayX: [1, 0],
									dashArrayY: [2, 4],
									rotation: -Math.PI / 4,
									color: "var(--hatch)",
								},
							},
						},
					],
				},
			],
		},
		"",
	);
	expect(svg).toContain("fill:var(--hollow)");
	expect(svg).toContain("stroke:var(--accent)");
	expect(svg).toMatch(/<pattern[^>]*>.*var\(--hatch\)/s);
	expect(svg).toMatch(/fill="url\(#[^)]+\)"|fill:url\(#[^)]+\)/);
});

test("live, a Chart sets its text at the label size and its marker label where pack drew it (#190)", async () => {
	const path = await packedMdx(
		dir,
		"payback",
		`import { Chart } from "kit";\n\n# Payback\n\n<Chart id="payback" label="Payback" option={${JSON.stringify(PAYBACK)}} />\n`,
	);
	const drawn = texts(copy(PAYBACK, "")).find((t) => t.text === "Payback");
	const live = await inPage(path, (cdp) =>
		cdp.evaluate<{ sizes: (number | string)[]; label: number[] }>(`(() => {
			const chart = echarts.getInstanceByDom(document.getElementById("payback"));
			const texts = chart.getZr().storage.getDisplayList().filter((el) => el.style?.text);
			const label = texts.find((el) => el.style.text === "Payback");
			return {
				sizes: [...new Set(texts.map((el) => el.style.fontSize ?? el.style.font))],
				label: (() => {
					const r = label.getBoundingRect().clone();
					r.applyTransform(label.getComputedTransform());
					return [r.x, r.y + r.height / 2];
				})(),
			};
		})()`),
	);
	expect(live.sizes.every((size) => String(size).includes("13"))).toBe(true);
	expect(Math.abs((live.label[0] ?? 0) - (drawn?.x ?? 0))).toBeLessThanOrEqual(2);
	expect(Math.abs((live.label[1] ?? 0) - (drawn?.y ?? 0))).toBeLessThanOrEqual(2);
}, 30_000);

test("Charts and Plots write money as Table does: thousands always grouped, a whole amount without cents (#202)", () => {
	type Format = { currency?: string; digits?: number; percent?: boolean };
	type Write = (format: Format) => (v: number) => string;
	const plot = (
		runKitPart("plot/format.ts", "PlotFormat") as (env: object) => { formatter: Write }
	)({
		lang: () => "en",
	});
	const charts = (
		runKitPart("charts/option.ts", "ChartsOption") as (env: object) => {
			resolveOption(option: object): { axisLabel: { formatter: (v: number) => string } };
		}
	)({ color: (c: string) => c, lang: () => "en", size: () => 13 });
	const chartText: Write = (format) =>
		charts.resolveOption({ axisLabel: { formatter: format } }).axisLabel.formatter;
	for (const write of [plot.formatter, chartText]) {
		expect([4200, 4200.5, 12345].map(write({ currency: "EUR" }))).toEqual([
			"€4,200",
			"€4,200.50",
			"€12,345",
		]);
		expect(write({ currency: "EUR", digits: 2 })(4200)).toBe("€4,200.00");
		// A percent stays a percent beside a currency, as Table writes it.
		expect(write({ percent: true, currency: "EUR" })(0.5)).toBe("50%");
		// A plain number still groups from five digits, so a year stays 2024.
		expect(write({})(2024)).toBe("2024");
	}
});

/** The dash of each line a drawn copy has, by its stroke, "" for a solid one. */
const lineDashes = (svg: string) =>
	[...svg.matchAll(/<path d="M[^"]*"([^>]*)>/g)]
		.map(([, attrs = ""]) => attrs)
		.filter((attrs) => /fill="none"/.test(attrs) && /stroke:var\(--(c\d|accent)\)/.test(attrs))
		.map((attrs) => /stroke-dasharray="([^"]+)"/.exec(attrs)?.[1] ?? "");
const LINE = { type: "line", data: [1, 2, 3] };
const ABC = { type: "category", data: ["a", "b", "c"] };

test("the kit's line dashes reach series in a baseOption and in media options, where an author's colour drops them (#190)", () => {
	const option = {
		baseOption: { xAxis: ABC, yAxis: {}, series: [LINE, { ...LINE, data: [3, 2, 1] }] },
		media: [
			{
				query: { maxWidth: 500 },
				option: { series: [{}, { lineStyle: { color: "var(--accent)" } }] },
			},
		],
	};
	const wide = lineDashes(copy(option, ""));
	expect(wide).toHaveLength(2);
	expect(wide[0]).toBe("");
	expect(wide[1]).not.toBe("");
	expect(lineDashes(copy(option, "phone"))).toEqual(["", ""]);
});

test("live, a Chart's generated dashes follow its option through updates: a colour drops one, an added line gets its slot's (#190)", async () => {
	const page = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><main class="page"><div class="chart" id="c"></div></main>
<script src="kit:echarts.js"></script><script src="kit:charts.js"></script><script>
const dash = (chart, i) => {
	let found = "none";
	chart.getViewOfSeriesModel(chart.getModel().getSeriesByIndex(i)).group.traverse((el) => {
		if (el.type === "ec-polyline") found = JSON.stringify(el.style.lineDash ?? null);
	});
	return found;
};
var contract = new Promise((ready) => {
	const handle = Charts.make(document.getElementById("c"), {
		xAxis: ${JSON.stringify(ABC)}, yAxis: {},
		series: [${JSON.stringify(LINE)}, { type: "line", data: [3, 2, 1] }],
	}, (chart) => setTimeout(() => ready([handle, chart])));
}).then(([handle, chart]) => {
	const failures = [];
	const expect = (what, got, want) => { if (got !== want) failures.push(what + ": " + got + ", not " + want); };
	expect("the second line at first", dash(chart, 1), "[6,4]");
	handle.set({ series: [{}, { lineStyle: { color: "var(--accent)" } }] });
	// ECharts writes a solid line's dash as null or "solid".
	expect("the second line once coloured", ["null", '"solid"'].includes(dash(handle.chart, 1)), true);
	handle.set({ series: [{}, {}, { type: "line", data: [2, 2, 2] }] });
	expect("an added third line", dash(handle.chart, 2), "[1,4]");
	return failures;
});
</script></body></html>`;
	expect(
		await packAndRun(dir, "dash-updates", page, {
			widths: [{ width: 1440, height: 900, mobile: false }],
		}),
	).toEqual([]);
}, 30_000);

test("a Chart's title takes a heading's text size, its subtext the label size; an author's size wins (#190)", () => {
	const titled = (title: object) => texts(copy({ ...PAYBACK, title }, ""));
	const own = titled({ text: "Heating", subtext: "Years to pay back" });
	expect(own.find((t) => t.text === "Heating")?.size).toBe(17);
	expect(own.find((t) => t.text === "Years to pay back")?.size).toBe(13);
	expect(
		titled({ text: "Heating", textStyle: { fontSize: 24 } }).find((t) => t.text === "Heating")
			?.size,
	).toBe(24);
});

test("a marker line's label stays inside the figure, left of its line past the axis' middle; an author's align and offset win (#190)", () => {
	const marked = (markLine: object) => ({
		...PAYBACK,
		series: [{ ...PAYBACK.series[0], markLine: { label: { formatter: "{b}" }, ...markLine } }],
	});
	const atMax = marked({ data: [{ xAxis: 120, name: "Most years" }] });
	for (const [fit, W] of [
		["", 1054],
		["half", 527],
		["phone", 356],
	] as const) {
		const label = texts(copy(atMax, fit)).find((t) => t.text === "Most years");
		expect(label?.anchor, fit).toBe("end");
		const left = (label?.x ?? 0) - textWidth("Most years", 13, 500);
		expect(left, fit).toBeGreaterThanOrEqual(0);
		expect(label?.x ?? W, fit).toBeLessThanOrEqual(W);
	}
	// Before the middle, the label starts beside the line, as the payback marker's does.
	expect(texts(copy(PAYBACK, "phone")).find((t) => t.text === "Payback")?.anchor).toBe("start");
	// The author's align and offset, for all of a series' markers or for one, stay as written.
	const centred = marked({
		data: [{ xAxis: 50, name: "Payback" }],
		label: { formatter: "{b}", align: "center", offset: [0, -4] },
	});
	expect(texts(copy(centred, "")).find((t) => t.text === "Payback")?.anchor).toBe("middle");
	const one = marked({ data: [{ xAxis: 110, name: "Late", label: { align: "left" } }] });
	expect(texts(copy(one, "")).find((t) => t.text === "Late")?.anchor).toBe("start");
});

/** The fills and strokes of a drawn copy's filled shapes: bars, slices and areas. */
const filled = (svg: string) =>
	[...svg.matchAll(/<path d="[^"]*"([^>]*)>/g)]
		.map(([, attrs = ""]) => attrs)
		.filter((attrs) => /fill:var\(--c\d\)/.test(attrs))
		.map((attrs) => /stroke:(var\(--[\w-]+\))/.exec(attrs)?.[1] ?? "");

test("touching filled segments, stacked or in a pie, part by a line in the tone under the chart; an author's border wins (#190)", () => {
	const two = { xAxis: { type: "category", data: ["a", "b"] }, yAxis: {} };
	const stacked = (extra: object) =>
		filled(
			copy(
				{
					...two,
					series: [
						{ type: "bar", stack: "all", data: [1, 2], ...extra },
						{ type: "bar", stack: "all", data: [2, 1], ...extra },
					],
				},
				"",
			),
		);
	expect(stacked({})).toEqual(Array(4).fill("var(--under)"));
	expect(stacked({ itemStyle: { borderColor: "var(--ink)", borderWidth: 2 } })).toEqual(
		Array(4).fill("var(--ink)"),
	);
	const pie = filled(
		copy({ series: [{ type: "pie", data: [{ value: 1 }, { value: 2 }, { value: 3 }] }] }, ""),
	);
	expect(pie).toEqual(Array(3).fill("var(--under)"));
	// A stacked area's own line is the parting line, solid: its fill tells it apart, not a dash.
	const area = { type: "line", stack: "all", areaStyle: {}, data: [1, 2] };
	const areas = copy({ ...two, series: [area, { ...area, data: [2, 1] }] }, "");
	const lines = [...areas.matchAll(/<path d="M[^"]*"([^>]*)>/g)]
		.map(([, attrs = ""]) => attrs)
		.filter((attrs) => /fill="none"/.test(attrs) && /stroke:var\(--under\)/.test(attrs));
	expect(lines.length).toBe(2);
	expect(lines.some((attrs) => attrs.includes("stroke-dasharray"))).toBe(false);
	// Its points, and so its legend entry, are filled in the series' colour, which the line no longer shows.
	expect(areas).toMatch(/<path d="[^"]*A[^"]*"[^>]*style="fill:var\(--c1\)/);
	// Side by side, bars do not touch: no line.
	const apart = filled(
		copy(
			{
				...two,
				series: [
					{ type: "bar", data: [1, 2] },
					{ type: "bar", data: [2, 1] },
				],
			},
			"",
		),
	);
	expect(apart).toEqual(Array(4).fill(""));
});

test("live, a Chart takes the label size its own element inherits, as a Plot does (#190)", async () => {
	const path = await packedMdx(
		dir,
		"band-size",
		`import { Chart } from "kit";
import "./big.css";

# Band

<div className="big">
<Chart id="big" label="Payback" option={${JSON.stringify(PAYBACK)}} />
</div>
`,
		{ "big.css": ".big { --size-label: 1rem; }\n" },
	);
	const sizes = await inPage(path, (cdp) =>
		cdp.evaluate<string[]>(`(() => {
			const chart = echarts.getInstanceByDom(document.getElementById("big"));
			const texts = chart.getZr().storage.getDisplayList().filter((el) => el.style?.text);
			return [...new Set(texts.map((el) => String(el.style.fontSize ?? el.style.font)))];
		})()`),
	);
	expect(sizes.length).toBeGreaterThan(0);
	expect(sizes.every((size) => size.includes("16"))).toBe(true);
}, 30_000);

test("responsive series keep the palette slot matched by id or name, not their override order", () => {
	const defaults = runKitPart("charts/defaults.ts", "ChartsDefaults") as {
		defaults(option: object): {
			media: { option: { series: { lineStyle?: { type?: unknown } }[] } }[];
		};
	};
	for (const key of ["id", "name"]) {
		const result = defaults.defaults({
			series: ["A", "B"].map((value) => ({ [key]: value, type: "line", data: [1, 2] })),
			media: [{ option: { series: ["B", "A"].map((value) => ({ [key]: value, data: [2, 3] })) } }],
		});
		expect(result.media[0]?.option.series.map((s) => s.lineStyle?.type)).toEqual([
			[6, 4],
			undefined,
		]);
	}
});
