/* Plot's labels placed together: a line's end name and value clear of the markers, a grouped bar's value clear of its
   neighbours, a bar cut where it leaves the axis, and the value axis left out when every bar prints its value (#190). */
import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { textWidth } from "../skills/explainer/src/geist.ts";
import { runKitPart } from "../skills/explainer/src/kit.ts";
import { lines, plotDraw, rects } from "./plot-draw.ts";
import { packedMdx, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const geist = (s: unknown) => textWidth(String(s), 13, 500);
const render = (option: { series: object[]; [key: string]: unknown }, W: number, H: number) =>
	plotDraw.render(
		option,
		W,
		H,
		geist,
		option.series.map(() => true),
	);

interface Box {
	text: string;
	x0: number;
	x1: number;
	y0: number;
	y1: number;
}
/** Each text of a class as the box it takes. */
const boxes = (svg: string, cls: string): Box[] =>
	[
		...svg.matchAll(
			new RegExp(
				`<text class="${cls}" x="([^"]+)" y="([^"]+)"[^>]*text-anchor="(\\w+)"[^>]*>([^<]*)<`,
				"g",
			),
		),
	].map(([, x = "0", y = "0", anchor, text = ""]) => {
		const w = geist(text);
		const x0 =
			anchor === "end" ? Number(x) - w : anchor === "middle" ? Number(x) - w / 2 : Number(x);
		return { text, x0, x1: x0 + w, y0: Number(y) - 6.5, y1: Number(y) + 6.5 };
	});
/** Each label of a class as one box, its wrapped lines (one text each, a line apart at the same x) joined. */
function blocks(svg: string, cls: string): Box[] {
	const out: (Box & { x: string })[] = [];
	for (const m of svg.matchAll(
		new RegExp(`<text class="${cls}" x="([^"]+)" y="([^"]+)"[^>]*>([^<]*)<`, "g"),
	)) {
		const [line] = boxes(`${m[0]}/`, cls);
		const prev = out.at(-1);
		if (line && prev && prev.x === m[1] && Math.abs(line.y0 - prev.y1 - 4) < 1) {
			Object.assign(prev, {
				text: `${prev.text} ${line.text}`,
				x0: Math.min(prev.x0, line.x0),
				x1: Math.max(prev.x1, line.x1),
				y1: line.y1,
			});
		} else if (line) {
			out.push({ ...line, x: m[1] ?? "" });
		}
	}
	return out.map(({ x: _, ...box }) => box);
}
const overlap = (a: Omit<Box, "text">, b: Omit<Box, "text">) =>
	a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
/** Whether a line [x1, x2, y1, y2] passes through the box. */
const struck = (b: Box, [x1 = 0, x2 = 0, y1 = 0, y2 = 0]: number[]) =>
	x1 === x2
		? x1 > b.x0 && x1 < b.x1 && Math.max(y1, y2) > b.y0 && Math.min(y1, y2) < b.y1
		: y1 > b.y0 && y1 < b.y1 && Math.max(x1, x2) > b.x0 && Math.min(x1, x2) < b.x1;

/** I2C: volts on a 3.3 V bus t ns after release, until the line reads as high (0.7 VDD), for pull-up R on 100 pF. */
const HIGH = 0.7 * 3.3;
function rise(ohms: number) {
	const tau = ohms * 100e-12 * 1e9;
	const t30 = -tau * Math.log(0.7);
	const end = -tau * Math.log(0.3) - t30;
	return Array.from({ length: 41 }, (_, k) => {
		const t = (k / 40) * end;
		return [t, 3.3 * (1 - Math.exp(-(t + t30) / tau))] as const;
	});
}
const ns = (x: number) => `${Math.round(x)} ns`;
const i2c = {
	series: [
		{ name: "10 kΩ", data: rise(10000), color: "var(--accent)", dash: false, label: ns },
		{ name: "2.2 kΩ", data: rise(2200), dash: false, label: ns },
	],
	marks: [
		{ x: 300, label: "300 ns allowed at 400 kHz" },
		{ y: HIGH, label: "2.31 V reads as high" },
	],
	x: { min: 0, max: 1200, format: { unit: "ns" } },
	y: { min: 0.9, max: 2.6, step: 0.5, format: { digits: 1, unit: "V" } },
};

test("a line's end name carries its last value and keeps clear of the markers' lines and labels, desktop to phone (#190)", () => {
	for (const W of [1054, 527, 356]) {
		const svg = render(i2c, W, 320);
		const ends = blocks(svg, "end");
		expect(ends.map((b) => b.text).sort()).toEqual(["10 kΩ: 847 ns", "2.2 kΩ: 186 ns"]);
		const marked = lines(svg, "mark");
		const labels = boxes(svg, "mark-label");
		for (const end of ends) {
			expect({ W, end: end.text, struck: marked.filter((l) => struck(end, l)) }).toEqual({
				W,
				end: end.text,
				struck: [],
			});
			expect(labels.filter((l) => overlap(end, l))).toEqual([]);
			expect(end.x0).toBeGreaterThanOrEqual(0);
			expect(end.x1).toBeLessThanOrEqual(W);
		}
		expect(overlap(ends[0] as Box, ends[1] as Box)).toBe(false);
	}
});

/** The lines' paths as points. */
const paths = (svg: string) =>
	[...svg.matchAll(/<path class="line"[^>]* d="M([^"]+)"/g)].map((m) =>
		(m[1] ?? "").split("L").map((p) => p.split(",").map(Number) as [number, number]),
	);
/** Whether a polyline passes through the box, sampled along each segment. */
const through = (b: Box, line: [number, number][]) =>
	line.some(([x1, y1], i) => {
		const [x2, y2] = line[i + 1] ?? [x1, y1];
		return Array.from({ length: 41 }, (_, k) => k / 40).some((t) => {
			const [x, y] = [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
			return x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1;
		});
	});

/** kWh in a 10 kWh battery from 1 kWh at kw kW, slowing past 8, as the fixture's charge plot. */
function charge(kw: number) {
	const points: [number, number][] = [[0, 1]];
	for (let [t, e] = [0, 1]; e < 10; ) {
		[t, e] = [t + 0.25, e + Math.min(e < 8 ? kw / 4 : kw / 12, 10 - e)];
		points.push([t, e]);
	}
	return points.map(([x, y], i) => ({
		x,
		y,
		label: i === points.length - 1 ? `${x.toFixed(1)} h` : "",
	}));
}
const curve = (name: string, kw: number) => {
	const points = charge(kw);
	return { name, data: points.map(({ x, y }) => [x, y]), label: points.map((p) => p.label) };
};

test("a label across the plot keeps off the lines, and names far apart along the plot keep their ends (#190)", () => {
	const option = {
		series: [curve("3 kW", 3), curve("11 kW", 11)],
		marks: [{ y: 8, label: "80 %: charging slows" }],
		x: { min: 0, format: { unit: "h" } },
		y: { min: 0, max: 10, format: { unit: "kWh" } },
	};
	for (const W of [1054, 527, 356]) {
		const svg = render(option, W, 288);
		const [label] = boxes(svg, "mark-label");
		expect(label).toBeDefined();
		expect({ W, crossed: paths(svg).filter((line) => through(label as Box, line)).length }).toEqual(
			{ W, crossed: 0 },
		);
		expect(lines(svg, "leader")).toEqual([]);
		for (const end of blocks(svg, "end")) {
			expect(overlap(end, label as Box)).toBe(false);
		}
	}
});

test("one named line carries its name at its end, and a label alone puts its last value there (#190)", () => {
	const data = [
		[0, 1],
		[10, 4],
	];
	const named = render({ series: [{ name: "Change nothing", data }] }, 600, 300);
	expect(boxes(named, "end").map((b) => b.text)).toEqual(["Change nothing"]);
	const valued = render({ series: [{ data, label: { unit: "min" } }] }, 600, 300);
	expect(boxes(valued, "end").map((b) => b.text)).toEqual(["4\u00a0min"]);
	const legend = plotDraw.legendMarkup(
		{ legend: false, series: [{ name: "Wait", data }] },
		geist,
		300,
	);
	expect(legend).toBe("");
	expect(
		boxes(render({ legend: false, series: [{ name: "Wait", data }] }, 600, 300), "end"),
	).toEqual([]);
});

test("a line's end value keeps its text while the line tweens, its name and value from where the move goes (#190)", () => {
	const { between } = (
		runKitPart("plot/tween.ts", "PlotTween") as () => {
			between(from: object, to: object, k: number): object;
		}
	)();
	const at = (top: number) => ({
		series: [
			{
				name: "10 kΩ",
				data: [
					[0, 1],
					[10, top],
				],
				label: { unit: "ns" },
			},
			{
				name: "1 kΩ",
				data: [
					[0, 0.5],
					[10, top / 4],
				],
				label: { unit: "ns" },
			},
		],
	});
	const [from, to] = [at(400), at(847)];
	const texts = (svg: string) => boxes(svg, "end").map((b) => b.text);
	const goal = texts(render(to, 600, 300));
	expect(goal.join(" ")).toContain("847");
	for (let k = 0; k < 10; k++) {
		// As plot.js draws a move: each step's option, with the texts of where it goes.
		const svg = plotDraw.render(between(from, to, k / 10), 600, 300, geist, [true, true], to);
		expect(texts(svg)).toEqual(goal);
	}
});

test("a marker's label across a bar plot keeps off the bars and their values, desktop to phone (#190)", () => {
	const option = {
		categories: ["A", "B", "C", "D"],
		series: [
			{ name: "2023", type: "bar", data: [12, 18, 7, 22], label: true },
			{ name: "2024", type: "bar", data: [14, 16, 9, 25], label: true },
		],
		marks: [{ y: 20, label: "Lifetime 20" }],
	};
	for (const [W, H] of [
		[1054, 416],
		[527, 416],
		[356, 288],
	] as const) {
		const svg = render(option, W, H);
		const [label] = boxes(svg, "mark-label");
		expect(label?.text).toBe("Lifetime 20");
		const taken = [
			...rects(svg, "bar").map(([x = 0, y = 0, w = 0, h = 0]) => ({
				x0: x,
				x1: x + w,
				y0: y,
				y1: y + h,
			})),
			...boxes(svg, "value(?: inside)?"),
		];
		for (const other of taken) {
			const apart =
				label &&
				(label.x1 <= other.x0 ||
					other.x1 <= label.x0 ||
					label.y1 <= other.y0 ||
					other.y1 <= label.y0);
			expect(apart).toBe(true);
		}
	}
});

/** The world's added TWh, 2015 to 2024, and how much of it wind and solar added. */
const demand = [258, 690, 742, 1032, 371, -105, 1543, 650, 744, 1265];
const windSolar = [184, 205, 299, 262, 282, 333, 470, 527, 541, 669];
const lastOnly = (values: number[]) =>
	values.map((v, i) => (i === values.length - 1 ? v.toLocaleString("en") : ""));

test("a grouped bar's value label keeps off its neighbours' bars and labels, desktop to phone (#190)", () => {
	const option = {
		categories: Array.from({ length: 10 }, (_, i) => String(2015 + i)),
		series: [
			{ name: "demand", type: "bar", data: demand, label: lastOnly(demand) },
			{ name: "wind and solar", type: "bar", data: windSolar, label: lastOnly(windSolar) },
		],
		y: { step: 500 },
	};
	for (const W of [1054, 527, 356]) {
		const svg = render(option, W, 320);
		const values = boxes(svg, "value");
		expect(values.map((b) => b.text)).toEqual(["1,265", "669"]);
		const bars = rects(svg, "bar").map(([x = 0, y = 0, w = 0, h = 0]) => ({
			x0: x,
			x1: x + w,
			y0: y,
			y1: y + h,
		}));
		for (const v of values) {
			expect({ W, v: v.text, on: bars.filter((b) => overlap(v, b)) }).toEqual({
				W,
				v: v.text,
				on: [],
			});
		}
		expect(overlap(values[0] as Box, values[1] as Box)).toBe(false);
	}
});

test("a bar past the axis's end is cut there, with its true value printed (#190)", () => {
	const option = {
		horizontal: true,
		categories: ["first 5 kWh", "second 5 kWh", "third 5 kWh"],
		series: [{ type: "bar", data: [10, 62, 165], label: { unit: "years" } }],
		x: { min: 0, max: 70 },
	};
	for (const W of [1054, 356]) {
		const svg = render(option, W, 220);
		const bars = rects(svg, "bar");
		const ends = bars.map(([x = 0, , w = 0]) => x + w);
		const edge = Math.max(...ends);
		expect(ends[2]).toBe(edge);
		const cuts = [...svg.matchAll(/<path class="cut"[^>]* d="([^"]+)"/g)];
		expect(cuts.length).toBe(1);
		const xs = [...(cuts[0]?.[1] ?? "").matchAll(/([\d.]+)[ ,]([\d.]+)/g)].map((m) => Number(m[1]));
		expect(Math.min(...xs)).toBeGreaterThan(edge - 24);
		expect(Math.max(...xs)).toBeLessThanOrEqual(edge);
		expect(boxes(svg, "value(?: inside)?").map((b) => b.text)).toContain("165\u00a0years");
	}
	const within = render({ ...option, x: { min: 0, max: 200 } }, 1054, 220);
	expect(within).not.toContain('class="cut"');
	// A computed value a hair over a step, which the axis rounds its end down to, is not past it.
	const hair = render(
		{
			...option,
			data: undefined,
			series: [{ type: "bar", data: [3, 18 + 5e-10], label: true }],
			x: {},
		},
		1054,
		220,
	);
	expect(hair).not.toContain('class="cut"');
});

/** The tick labels of a drawing, categories included: texts without a class. */
const ticks = (svg: string) =>
	[...svg.matchAll(/<text x="[^"]+" y="[^"]+"[^>]*>([^<]*)</g)].map((m) => m[1]);

test("a bar plot whose every bar prints its value leaves out the value axis; one with any bar unprinted keeps it (#190)", () => {
	const base = {
		horizontal: true,
		categories: ["first", "second", "third"],
		series: [{ type: "bar", data: [10, 62, 165], label: { unit: "years" } }],
		marks: [{ x: 16, label: "16 years: cells rated for 6,000 cycles" }],
	};
	const printed = render(base, 1054, 220);
	expect(ticks(printed)).toEqual(base.categories);
	expect(lines(printed, "axis").length).toBe(1);
	const texts = render(
		{ ...base, series: [{ type: "bar", data: [10, 62, 165], label: ["a", "b", "c"] }] },
		1054,
		220,
	);
	expect(ticks(texts).length).toBeGreaterThan(5);
	const stacked = render(
		{
			...base,
			stack: true,
			series: [...base.series, { type: "bar", data: [1, 2, 3], label: true }],
		},
		1054,
		220,
	);
	expect(ticks(stacked).length).toBeGreaterThan(5);
	const vertical = render({ ...base, horizontal: false }, 600, 300);
	expect(ticks(vertical)).toEqual(base.categories);
});

test("a bar plot without its value axis keeps its 56 px rows, the axis's room given back (#190)", async () => {
	const option = {
		horizontal: true,
		categories: ["first", "second", "third"],
		series: [{ type: "bar", data: [10, 62, 165], label: { unit: "years" } }],
	};
	const output = await packedMdx(
		dir,
		"printed",
		`import { Plot } from "kit";\n\n# Printed\n\n<Plot label="Payback" option={${JSON.stringify(option)}} />\n`,
	);
	const [desktop = ""] =
		readFileSync(output, "utf8").match(/<svg viewBox="0 0 [^"]+"[^>]*>.*?<\/svg>/gs) ?? [];
	const heights = rects(desktop, "bar").map((r) => r[3] ?? 0);
	expect(heights).toHaveLength(3);
	for (const h of heights) {
		expect(h).toBeCloseTo(25, 0);
	}
});

test("a line's long last value wraps at its end, or is left out, and the plot still draws (#190)", () => {
	const data = [
		[0, 1],
		[10, 4],
	];
	const long = "This is a deliberately long point value label in words";
	for (const W of [1054, 527, 356]) {
		const svg = render({ series: [{ data, label: ["", long] }] }, W, 220);
		expect(paths(svg)).toHaveLength(1);
		expect(lines(svg, "axis").length).toBeGreaterThan(0);
		const wrapped = render(
			{ series: [{ data, label: ["", "about 4 kWh by the evening"] }] },
			W,
			220,
		);
		const end = blocks(wrapped, "end");
		expect(end.map((b) => b.text)).toEqual(["about 4 kWh by the evening"]);
		expect((end[0] as Box).x1).toBeLessThanOrEqual(W);
	}
});

test("labels across the plot keep off each other and the lines (#190)", () => {
	const option = {
		series: [
			{
				data: [
					[0, 4],
					[10, 4],
				],
			},
		],
		marks: [
			{ y: 2, label: "Reference A" },
			{ y: 3.5, label: "Reference B" },
		],
		x: { min: 0, max: 10 },
		y: { min: 0, max: 10 },
	};
	for (const W of [1054, 527, 356]) {
		const svg = render(option, W, 288);
		const labels = blocks(svg, "mark-label");
		expect(labels.map((b) => b.text).sort()).toEqual(["Reference A", "Reference B"]);
		expect({ W, overlap: overlap(labels[0] as Box, labels[1] as Box) }).toEqual({
			W,
			overlap: false,
		});
		for (const label of labels) {
			expect({ W, crossed: paths(svg).filter((line) => through(label, line)).length }).toEqual({
				W,
				crossed: 0,
			});
		}
	}
});

test("a reference mark keeps the value axis it is read against, and labels true or false wins (#190)", () => {
	const base = {
		horizontal: true,
		categories: ["first", "second", "third"],
		series: [{ type: "bar", data: [10, 62, 165], label: { unit: "years" } }],
	};
	const read = render({ ...base, marks: [{ x: 16, label: "Lifetime" }] }, 1054, 220);
	expect(ticks(read).length).toBeGreaterThan(5);
	const kept = render({ ...base, x: { labels: true } }, 1054, 220);
	expect(ticks(kept).length).toBeGreaterThan(5);
	const unprinted = { ...base, series: [{ type: "bar", data: [10, 62, 165] }] };
	const left = render({ ...unprinted, x: { labels: false } }, 1054, 220);
	expect(ticks(left)).toEqual(base.categories);
});

/** The x and y of a cut's corners. */
const cutPoints = (svg: string) =>
	[...svg.matchAll(/<path class="cut"[^>]* d="([^"]+)"/g)].map((m) =>
		[...(m[1] ?? "").matchAll(/(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((p) => [
			Number(p[1]),
			Number(p[2]),
		]),
	);

test("a bar is cut where its visible part meets the axis's end, and a cut bar always prints its value (#190)", () => {
	// A stacked segment past the end: cut inside its own visible part, never in the segment under it.
	const stack = render(
		{
			categories: ["a", "b"],
			stack: true,
			series: [
				{ type: "bar", data: [9.9, 2] },
				{ type: "bar", data: [50, 30] },
			],
			y: { min: 0, max: 10 },
		},
		600,
		300,
	);
	const segments = rects(stack, "bar").map(([x = 0, y = 0, w = 0, h = 0]) => ({ x, y, w, h }));
	const under = segments[0] as (typeof segments)[number];
	for (const cut of cutPoints(stack)) {
		const [x = 0, y = 0] = [0, 1].map(
			(k) => cut.reduce((sum, p) => sum + (p[k] ?? 0), 0) / cut.length,
		);
		const inUnder = x > under.x && x < under.x + under.w && y > under.y && y < under.y + under.h;
		expect(inUnder).toBe(false);
	}
	expect(boxes(stack, "value(?: inside)?").map((b) => b.text)).toEqual(["50", "30"]);
	// A zoomed range: a bar wholly under it has no cut over the category names, and both print their values inside the plot.
	const zoom = render(
		{
			categories: ["low", "high"],
			series: [{ type: "bar", data: [5, 25] }],
			y: { min: 10, max: 20 },
		},
		600,
		300,
	);
	const bottom = Math.max(...lines(zoom, "axis").map((l) => Math.max(l[2] ?? 0, l[3] ?? 0)));
	for (const cut of cutPoints(zoom)) {
		expect(Math.max(...cut.map(([, y = 0]) => y))).toBeLessThanOrEqual(bottom);
	}
	const values = boxes(zoom, "value(?: inside)?");
	expect(values.map((b) => b.text).sort()).toEqual(["25", "5"]);
	for (const v of values) {
		expect(v.y1).toBeLessThanOrEqual(bottom);
	}
});

test("a stack piles its negative values down from 0 and its positive ones up, each sign on its own", () => {
	const svg = render(
		{
			categories: ["day"],
			stack: true,
			series: [
				{ name: "made", type: "bar", data: [10] },
				{ name: "used", type: "bar", data: [-6], fill: "hatch" },
				{ name: "sold", type: "bar", data: [4], fill: "hollow" },
			],
		},
		600,
		300,
	);
	const [made = [], used = [], sold = []] = ["bar", "bar hatch", "bar hollow"].map(
		(cls) => rects(svg, cls)[0] ?? [],
	);
	const top = (b: number[]) => b[1] as number;
	const bottom = (b: number[]) => (b[1] as number) + (b[3] as number);
	const zero = bottom(made);
	// sold sits on made, not on what made and used leave; used hangs from 0, its full length below the axis.
	expect(Math.abs(bottom(sold) - top(made))).toBeLessThanOrEqual(1);
	expect(Math.abs(top(used) - zero)).toBeLessThanOrEqual(1);
	expect(Math.abs((used[3] as number) / (made[3] as number) - 0.6)).toBeLessThan(0.02);
	// The value axis reaches both piles' ends, -6 and 14, rounded out to its step.
	expect(ticks(svg).slice(1)).toEqual(["-10", "-5", "0", "5", "10", "15"]);
});
