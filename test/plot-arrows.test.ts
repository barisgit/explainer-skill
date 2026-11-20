/* Plot's arrow mark: a change from one data point to another, drawn with its head at the second, its label placed with the
   notes and every other label kept off it (#190). */
import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { textWidth } from "../skills/explainer/src/geist.ts";
import { runKitPart } from "../skills/explainer/src/kit.ts";
import { lines, plotDraw } from "./plot-draw.ts";
import { packedMdx, packMdx, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/** A label's width as pack measures it: Geist at the label size, weight 500. */
const geist = (s: unknown) => textWidth(String(s), 13, 500);

type Pt = readonly [number, number];
interface Box {
	cls: string;
	text: string;
	x0: number;
	x1: number;
	y0: number;
	y1: number;
}

/** Peaks of a sum near a jump, as the Fourier page draws them: each sum's first peak nearer the jump and lower. */
const peak = (k: number) => [Math.PI / (2 * k), 1.18 + 0.4 / k] as const;
const sum = (k: number) =>
	Array.from({ length: 61 }, (_, i) => {
		const x = (0.3 * i) / 60;
		const [px, py] = peak(k);
		return [x, x < px ? (py * x) / px : 1 + (py - 1) * Math.exp(-(x - px) * k)] as const;
	});
const ARROW = { from: peak(10), to: peak(100), label: "more terms" };
const option = (marks: object[] = [ARROW]) => ({
	series: [10, 30, 100].map((k) => ({ name: `${k} terms`, data: sum(k) })),
	legend: false,
	marks,
	x: { min: 0, max: 0.3 },
	y: { min: 0, max: 1.4 },
});
const render = (o: object, W = 1054, H = 416, texts = o) =>
	plotDraw.render(o, W, H, geist, [true, true, true], texts);

const vertices = (d: string): Pt[] =>
	[...d.matchAll(/[ML]\s*([\d.-]+)[ ,]([\d.-]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
const pathsOf = (svg: string, cls: string) =>
	[...svg.matchAll(new RegExp(`<path class="${cls}"[^>]*? d="([^"]+)"`, "g"))].map(
		(m) => m[1] ?? "",
	);
/** Every text with its class and box, by its anchor, a 13 px line centred on its y. */
const textsOf = (svg: string): Box[] =>
	[
		...svg.matchAll(
			/<text(?: class="([^"]*)")? x="([^"]+)" y="([^"]+)"[^>]*text-anchor="(\w+)"[^>]*>([^<]*)</g,
		),
	].map(([, cls = "", x = "0", y = "0", anchor, text = ""]) => {
		const w = geist(text);
		const x0 =
			anchor === "end" ? Number(x) - w : anchor === "middle" ? Number(x) - w / 2 : Number(x);
		return { cls, text, x0, x1: x0 + w, y0: Number(y) - 6.5, y1: Number(y) + 6.5 };
	});
/** Whether the segment from a to b passes through the box, sampled along it. */
const through = (b: Box, [a, c]: readonly [Pt, Pt]) =>
	Array.from({ length: 81 }, (_, k) => k / 80).some((t) => {
		const [x, y] = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t];
		return x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1;
	});
const touch = (a: Box, b: Box) => !(a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0);
/** The arrow's shaft as drawn, [from, to] in px. */
const shaft = (svg: string): [Pt, Pt] | undefined => {
	const [l] = lines(svg, "arrow");
	return l ? [[l[0] ?? 0, l[2] ?? 0] as const, [l[1] ?? 0, l[3] ?? 0] as const] : undefined;
};
const SIZES = [
	[1054, 416],
	[527, 416],
	[356, 288],
	[326, 288],
] as const;

test("an arrow runs from one data point to another, its head at the second, its label clear of every line and text, desktop to phone (#190)", () => {
	for (const [W, H] of SIZES) {
		const svg = render(option(), W, H);
		const arrow = shaft(svg);
		expect(arrow, `${W} px`).toBeDefined();
		const [head = ""] = pathsOf(svg, "arrow-head");
		const tip = vertices(head)[0];
		// The head points the way the shaft runs, its tip past the shaft's end and short of the point by a few px.
		const [a, b] = arrow as [Pt, Pt];
		const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
		const [tx = 0, ty = 0] = tip ?? [];
		expect((tx - b[0]) * dx + (ty - b[1]) * dy, `${W} px`).toBeGreaterThan(0);
		// The shaft runs from near 10 terms' peak to near 100 terms': down and to the left.
		expect(dx).toBeLessThan(0);
		expect(dy).toBeGreaterThan(0);
		const curves = pathsOf(svg, "line").map(vertices);
		const texts = textsOf(svg);
		const label = texts.filter((t) => t.cls === "note" && t.text.includes("more"));
		expect(label.map((t) => t.text).join(" "), `${W} px`).toBe("more terms");
		for (const box of label) {
			expect(through(box, arrow as [Pt, Pt]), `${W} px: label on its arrow`).toBe(false);
			for (const curve of curves) {
				const crossed = curve.some((p, i) => i > 0 && through(box, [curve[i - 1] as Pt, p]));
				expect(crossed, `${W} px: label on a line`).toBe(false);
			}
			for (const other of texts.filter((t) => t !== box && !label.includes(t))) {
				expect(touch(box, other), `${W} px: label on ${other.text}`).toBe(false);
			}
			expect(box.x0).toBeGreaterThanOrEqual(0);
			expect(box.x1).toBeLessThanOrEqual(W);
		}
		expect(plotDraw.crowded().notes, `${W} px`).toEqual([]);
	}
});

test("notes and line names keep off an arrow as they keep off the lines (#190)", () => {
	// A note at the arrow's middle would sit on it if nothing kept it off.
	const middle = [(ARROW.from[0] + ARROW.to[0]) / 2, (ARROW.from[1] + ARROW.to[1]) / 2] as const;
	const withNote = option([ARROW, { at: middle, label: "the peak moves" }]);
	const named = { ...withNote, legend: undefined };
	for (const [W, H] of SIZES) {
		for (const o of [withNote, named]) {
			const svg = render(o, W, H);
			const arrow = shaft(svg) as [Pt, Pt];
			const others = textsOf(svg).filter((t) => t.cls === "end" || t.text.includes("peak"));
			expect(others.length, `${W} px`).toBeGreaterThan(0);
			// With the legend unset the lines carry their names, which must be among what keeps off the arrow.
			if (o === named) {
				expect(others.filter((t) => t.cls === "end").length, `${W} px: names`).toBeGreaterThan(0);
			}
			for (const box of others) {
				expect(through(box, arrow), `${W} px: ${box.text} on the arrow`).toBe(false);
			}
		}
	}
});

const { between } = (
	runKitPart("plot/tween.ts", "PlotTween") as () => {
		between(from: object, to: object, k: number): object;
	}
)();

test("an arrow moves with a tween, its label carried along with it and its text the same at every step (#190)", () => {
	const from = option([{ from: peak(10), to: peak(30), label: "more terms" }]);
	const to = option([ARROW]);
	let last: { arrow: [Pt, Pt]; label: Box } | undefined;
	const goal = render(to);
	for (let k = 0; k <= 10; k++) {
		const svg = k < 10 ? render(between(from, to, k / 10), 1054, 416, to) : render(to);
		const arrow = shaft(svg) as [Pt, Pt];
		const [label] = textsOf(svg).filter((t) => t.cls === "note");
		expect(label?.text).toBe("more terms");
		if (last && label) {
			// The label moves no further than the arrow's middle does, rather than jumping to another side.
			const mid = (s: [Pt, Pt]) => [(s[0][0] + s[1][0]) / 2, (s[0][1] + s[1][1]) / 2];
			const [m0 = 0, m1 = 0] = mid(last.arrow);
			const [n0 = 0, n1 = 0] = mid(arrow);
			expect(Math.abs(label.x0 - last.label.x0 - (n0 - m0))).toBeLessThan(0.5);
			expect(Math.abs(label.y0 - last.label.y0 - (n1 - m1))).toBeLessThan(0.5);
			expect(arrow).not.toEqual(last.arrow);
		}
		if (label) {
			last = { arrow, label };
		}
	}
	expect(shaft(goal)).toEqual(last?.arrow);
});

test("an arrow's end on a moving line moves with the line, at every step of the tween (#190)", () => {
	// One sum whose peak moves as its terms go from 10 to 30, the arrow pointing at the peak: the line moves point by point,
	// so an end that went straight from peak to peak would leave the line mid-move and trail it.
	const at = (k: number) => ({
		series: [{ name: "sum", data: sum(k) }],
		legend: false,
		marks: [{ from: [0.25, 0.6], to: peak(k), label: "peak" }],
		x: { min: 0, max: 0.3 },
		y: { min: 0, max: 1.4 },
	});
	const [from, to] = [at(10), at(30)];
	const heightOver = (o: { series: { data: unknown }[]; marks: { to: readonly number[] }[] }) => {
		const line = o.series[0]?.data as Pt[];
		const [x = 0, y = 0] = o.marks[0]?.to ?? [];
		const j = line.findIndex((p) => p[0] >= x);
		const [a, b] = [line[j - 1] ?? line[0], line[j]] as [Pt, Pt];
		return y - (a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0] || 1));
	};
	const ends = [heightOver(from), heightOver(to)].map(Math.abs);
	for (let k = 0; k <= 10; k++) {
		const step = between(from, to, k / 10) as Parameters<typeof heightOver>[0];
		expect(Math.abs(heightOver(step)), `step ${k}`).toBeLessThanOrEqual(Math.max(...ends) + 1e-9);
	}
});

test("an arrow's end on a line that is new to the move, which the plot shows at once, is at its place at once too (#190)", () => {
	// A line renamed per frame has no counterpart, so it is drawn where it goes from the first step; so is the end on it.
	const at = (k: number) => ({
		series: [{ name: `${k} terms`, data: sum(k) }],
		marks: [{ from: [0.25, 0.6], to: peak(k), label: "peak" }],
		x: { min: 0, max: 0.3 },
		y: { min: 0, max: 1.4 },
	});
	const step = between(at(10), at(30), 0.1) as { marks: { from: number[]; to: number[] }[] };
	expect(step.marks[0]?.to).toEqual([...peak(30)]);
	// Its other end is on no line, and goes straight.
	expect(step.marks[0]?.from).toEqual([0.25, 0.6]);
});

/** The tip of a step's first arrow, and the height over series j of that step as drawn, read between its points. */
function tipOver(step: object, j: number) {
	const o = step as { series: { data: Pt[] }[]; marks: { to: Pt }[] };
	const line = o.series[j]?.data ?? [];
	const [x, y] = o.marks[0]?.to ?? [0, 0];
	const k = line.findIndex((p) => p[0] >= x);
	const [a, b] = [line[Math.max(k - 1, 0)] ?? [0, 0], line[k] ?? [0, 0]] as [Pt, Pt];
	const at = b[0] === a[0] ? b[1] : a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
	return { x, height: y - at, inside: k >= 0 && x >= (line[0]?.[0] ?? 0) };
}
const tweenOf = (series: object[], tip: Pt) => ({
	series,
	marks: [{ from: [0, 9], to: tip }],
	x: { min: 0, max: 20 },
	y: { min: 0, max: 12 },
});
const steps = (from: object, to: object) =>
	Array.from({ length: 9 }, (_, k) => between(from, to, (k + 1) / 10));

test("an end tweening onto a flat line stays on the line (#190)", () => {
	const from = tweenOf(
		[
			{
				name: "a",
				data: [
					[0, 0],
					[10, 10],
				],
			},
		],
		[5, 5],
	);
	const to = tweenOf(
		[
			{
				name: "a",
				data: [
					[0, 6],
					[10, 6],
				],
			},
		],
		[8, 6],
	);
	for (const step of steps(from, to)) {
		expect(Math.abs(tipOver(step, 0).height)).toBeLessThan(1e-9);
	}
});

test("an end on a line resampled to another number of points moves as the drawn line does (#190)", () => {
	const from = tweenOf(
		[
			{
				name: "a",
				data: [
					[0, 0],
					[10, 10],
				],
			},
		],
		[6, 6],
	);
	const ten = Array.from({ length: 6 }, (_, i) => [10 + 2 * i, 2 * i] as Pt);
	const to = tweenOf([{ name: "a", data: ten }], [15, 5]);
	for (const step of steps(from, to)) {
		const tip = tipOver(step, 0);
		expect(tip.inside, `x ${tip.x}`).toBe(true);
		expect(Math.abs(tip.height)).toBeLessThan(1e-9);
	}
});

test("an end rides the line it sits on most closely that goes on, not a new line listed first or a near one (#190)", () => {
	const from = tweenOf(
		[
			{
				name: "near",
				data: [
					[0, 0.3],
					[10, 10.1],
				],
			},
			{
				name: "on",
				data: [
					[0, 0],
					[10, 10],
				],
			},
		],
		[3, 3],
	);
	const to = tweenOf(
		[
			{
				name: "new",
				data: [
					[0, 5.2],
					[10, 3.2],
				],
			},
			{
				name: "near",
				data: [
					[0, 8.2],
					[10, 2.2],
				],
			},
			{
				name: "on",
				data: [
					[0, 8],
					[10, 2],
				],
			},
		],
		[7, 3.8],
	);
	for (const step of steps(from, to)) {
		expect(Math.abs(tipOver(step, 2).height)).toBeLessThan(1e-9);
	}
});

test("an end on a line that turns from a stem, which switches at once, is at its place at once (#190)", () => {
	const from = tweenOf(
		[
			{
				name: "a",
				type: "stem",
				data: [
					[0, 0],
					[10, 10],
				],
			},
		],
		[5, 5],
	);
	const to = tweenOf(
		[
			{
				name: "a",
				data: [
					[0, 8],
					[10, 2],
				],
			},
		],
		[5, 5],
	);
	expect((between(from, to, 0.1) as { marks: { to: Pt }[] }).marks[0]?.to).toEqual([5, 5]);
	const moved = tweenOf(
		[
			{
				name: "a",
				data: [
					[0, 8],
					[10, 2],
				],
			},
		],
		[7.5, 3.5],
	);
	expect((between(from, moved, 0.1) as { marks: { to: Pt }[] }).marks[0]?.to).toEqual([7.5, 3.5]);
});

test("pack draws an arrow into each copy, the same as plot.js draws it (#190)", async () => {
	const output = await packedMdx(
		dir,
		"arrow",
		`import { Plot } from "kit";\n\n# Peaks\n\n<Plot label="Peaks" option={${JSON.stringify(option())}} />\n`,
	);
	const copies =
		readFileSync(output, "utf8").match(/<svg viewBox="0 0 [^"]+"[^>]*>.*?<\/svg>/gs) ?? [];
	expect(copies).toHaveLength(3);
	for (const svg of copies) {
		const [, W = 0, H = 0] = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)?.map(Number) ?? [];
		const drawn = render(option(), W, H);
		expect(lines(svg, "arrow")).toEqual(lines(drawn, "arrow"));
		// pack writes paths with relative steps after their first point (shorterPaths): the tips match.
		const tips = (d: string) => vertices(d)[0];
		expect(pathsOf(svg, "arrow-head").map(tips)).toEqual(pathsOf(drawn, "arrow-head").map(tips));
		expect(textsOf(svg).filter((t) => t.cls === "note")).toEqual(
			textsOf(drawn).filter((t) => t.cls === "note"),
		);
	}
});

test("pack fails on an arrow without its end or mixed with another shape, saying what to write (#190)", async () => {
	const cases = [
		[{ from: [0.1, 1.2], label: "x" }, "to: [x, y]"],
		[{ to: [0.1, 1.2], label: "x" }, "from"],
		[{ from: [0.1, 1.2], to: [0.05, 1.1], at: [0.1, 1], label: "x" }, "of its own"],
		[{ from: [0.1, 1.2], to: null, label: "x" }, "to: [x, y]"],
		[{ from: [0.1, 1.2], to: [], label: "x" }, "to: [x, y]"],
		[{ from: [0.1, "1.2"], to: [0.05, 1.1], label: "x" }, "from: [x, y]"],
	] as const;
	for (const [i, [mark, says]] of cases.entries()) {
		const { result } = await packMdx(
			dir,
			`arrow${i}`,
			`import { Plot } from "kit";\n\n# Peaks\n\n<Plot label="Peaks" option={${JSON.stringify(option([mark]))}} />\n`,
		);
		expect(result.code, JSON.stringify(mark)).not.toBe(0);
		expect(result.stderr).toContain(says);
	}
});

test("a short arrow stays drawn on a phone, smaller, rather than leaving its label alone (#190)", () => {
	const short = {
		series: [
			{
				data: [
					[0, 0],
					[100, 100],
				],
			},
		],
		marks: [{ from: [50, 60], to: [54, 60], label: "a nudge" }],
		x: { min: 0, max: 100 },
	};
	for (const [W, H] of SIZES) {
		const svg = render(short, W, H);
		const drawn = shaft(svg);
		expect(drawn, `${W} px`).toBeDefined();
		expect(pathsOf(svg, "arrow-head"), `${W} px`).toHaveLength(1);
		// Its head still ends short of the point it points at, on the arrow's side of it.
		const [, to] = drawn as [Pt, Pt];
		const at = vertices(pathsOf(svg, "arrow-head")[0] ?? "")[0] ?? [0, 0];
		expect(to[0], `${W} px`).toBeLessThan(at[0]);
	}
});

test("pack fails on an arrow in a plot with categories, which has no point for it (#190)", async () => {
	const bars = {
		categories: ["a", "b"],
		series: [{ data: [1, 2] }],
		marks: [{ from: [0, 1], to: [1, 100] }],
	};
	const { result } = await packMdx(
		dir,
		"arrow-bars",
		`import { Plot } from "kit";\n\n# Bars\n\n<Plot label="Bars" option={${JSON.stringify(bars)}} />\n`,
	);
	expect(result.code).not.toBe(0);
	expect(result.stderr).toContain("an arrow needs two numeric axes");
	// Live, where pack's check does not reach, the ignored arrow leaves the value axis as the bars set it.
	const svg = render({ ...bars, series: [{ data: [1, 2] }] }, 527, 416);
	expect(svg).not.toContain(">100<");
});

test("pack warns about an arrow too short to read at a copy's width, naming it and the width (#190)", async () => {
	const tiny = {
		series: [
			{
				data: [
					[0, 0],
					[100, 100],
				],
			},
		],
		marks: [{ from: [50, 60], to: [51, 60], label: "a nudge" }],
		x: { min: 0, max: 100 },
	};
	const { result } = await packMdx(
		dir,
		"arrow-tiny",
		`import { Plot } from "kit";\n\n# Tiny\n\n<Plot label="Tiny" option={${JSON.stringify(tiny)}} />\n`,
	);
	expect(result.code).toBe(0);
	expect(result.stdout).toContain('Plot arrow "a nudge" is too short to read at 356 px wide');
	expect(result.stdout).not.toContain("1054 px wide");
});

test("pack fails on an arrow in any Explore frame of a plot with categories, naming the frame (#190)", async () => {
	const page = `import { Explore } from "kit";

# Frames

<Explore id="e" label="Frames" controls={[{ id: "k", label: "Frame", choice: ["one", "two"] }]} frame={(k) => ({ plot: { categories: ["a", "b"], series: [{ data: [1, 2] }], marks: k === "two" ? [{ from: [0, 1], to: [1, 2] }] : [] } })} />
`;
	const { result } = await packMdx(dir, "arrow-frame", page);
	expect(result.code).not.toBe(0);
	expect(result.stderr).toContain("an arrow needs two numeric axes");
	expect(result.stderr).toContain("two");
});

test("an arrow with an end past the axis puts its label at the middle of the shaft as drawn (#190)", () => {
	const label = (to: number[]) => {
		const svg = render(option([{ from: [0.1, 0.4], to, label: "past" }]));
		return { shaft: shaft(svg), note: textsOf(svg).find((t) => t.text === "past") };
	};
	const [clipped, edge] = [label([10, 0.4]), label([0.3, 0.4])];
	expect(clipped.shaft).toEqual(edge.shaft);
	expect(clipped.note?.x0).toBeCloseTo(edge.note?.x0 ?? Number.NaN, 1);
});

test("pack says what every Explore frame it samples would draw crowded or unnamed, naming the frame (#190)", async () => {
	const tiny = JSON.stringify({ from: [50, 60], to: [51, 60], label: "a nudge" });
	const chart = `{ chart: { xAxis: { type: "value" }, yAxis: {}, ...(k === "two" && { dataZoom: [{ type: "inside" }] }), series: [{ name: "Up", type: "line", data: [[0, 0], [1, 1]] }, { name: "Down", type: "line", data: [[0, 1], [1, 0]] }] } }`;
	const plot = `{ plot: { x: { min: 0, max: 100 }, series: [{ data: [[0, 0], [100, 100]] }], marks: k === "two" ? [${tiny}] : [] } }`;
	const explore = (id: string, frame: string) =>
		`<Explore id="${id}" label="Frames" controls={[{ id: "${id}k", label: "Frame", choice: ["one", "two"] }]} frame={(k) => (${frame})} />`;
	const page = `import { Explore } from "kit";\n\n# Frames\n\n${explore("p", plot)}\n\n${explore("c", chart)}\n`;
	const { result } = await packMdx(dir, "arrow-frame-warnings", page);
	expect(result.code).toBe(0);
	expect(result.stdout).toContain(
		'frame("two"): Plot arrow "a nudge" is too short to read at 356 px wide',
	);
	expect(result.stdout).toMatch(
		/frame\("two"\): Chart lines "Up", "Down" carry no names: .*dataZoom/,
	);
	expect(result.stdout).not.toContain('frame("one")');
});
