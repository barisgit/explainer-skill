/* Plot's areas and notes: a line's fill, a region between two series, a point's and a region's label, a span on x, and value
   labels clear of the reference lines (#190, #212). */
import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { textWidth } from "../skills/explainer/src/geist.ts";
import { runKitPart } from "../skills/explainer/src/kit.ts";
import { JULY } from "./fixtures/mdx-all/july.ts";
import { lines, plotDraw } from "./plot-draw.ts";
import { packedMdx, packMdx, scratch } from "./support.ts";

/** A label's width as pack measures it: Geist at the label size, weight 500. */
const geist = (s: unknown) => textWidth(String(s), 13, 500);
const LINE = 17;

/** A July day, every half hour from 06:00 to 06:00: the roof's hump and the house's steps. */
const HOURS = Array.from({ length: 49 }, (_, i) => 6 + i / 2);
const roofAt = (t: number) => Math.max(0, 3 * Math.sin((Math.PI * (t - 6)) / 14));
const houseAt = (t: number) => 0.3 + (t >= 18 && t < 22 ? 0.85 : 0);
const roof = HOURS.map((t) => [t, roofAt(t)] as const);
const house = HOURS.map((t) => [t, houseAt(t)] as const);
const day = (marks: object[], fill?: string) => ({
	legend: false,
	series: [
		{ name: "Roof", data: roof, ...(fill ? { fill } : {}) },
		{ name: "House", data: house },
	],
	marks,
});
const render = (option: object, W = 1054, H = 416, texts = option) =>
	plotDraw.render(option, W, H, geist, [true, true], texts);

type Pt = readonly [number, number];
/** The vertices of a path written as M x,y L x,y ... or M x y L x y ... Z. */
const vertices = (d: string): Pt[] =>
	[...d.matchAll(/[ML]\s*([\d.-]+)[ ,]([\d.-]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
const pathsOf = (svg: string, cls: string) =>
	[...svg.matchAll(new RegExp(`<path class="${cls}"[^>]*? d="([^"]+)"`, "g"))].map(
		(m) => m[1] ?? "",
	);
/** The y of a polyline at x, by linear interpolation; undefined outside it. */
function yAt(line: Pt[], x: number) {
	for (const [i, [x1, y1]] of line.entries()) {
		const [x2, y2] = line[i + 1] ?? [Number.NaN, 0];
		if (x >= x1 - 0.05 && x <= x2 + 0.05) {
			return x2 === x1 ? y1 : y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
		}
	}
	return undefined;
}
/** Whether point p lies inside the polygon (even-odd), with a tolerance band at its edges. */
function inside(polygon: Pt[], [x, y]: Pt) {
	let odd = false;
	for (const [i, [x1, y1]] of polygon.entries()) {
		const [x2, y2] = polygon[(i + 1) % polygon.length] as Pt;
		if (y1 > y !== y2 > y && x < x1 + ((x2 - x1) * (y - y1)) / (y2 - y1)) {
			odd = !odd;
		}
	}
	return odd;
}

/** A text's box: its line centred on y, x by its anchor. */
interface Box {
	text: string;
	x0: number;
	x1: number;
	y0: number;
	y1: number;
}
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
/** Whether the segment from a to b passes through the box. */
function crosses(box: Box, a: Pt, b: Pt) {
	let t0 = 0;
	let t1 = 1;
	const d = [b[0] - a[0], b[1] - a[1]];
	for (const [p, q] of [
		[-(d[0] ?? 0), a[0] - box.x0],
		[d[0] ?? 0, box.x1 - a[0]],
		[-(d[1] ?? 0), a[1] - box.y0],
		[d[1] ?? 0, box.y1 - a[1]],
	] as const) {
		if (p === 0) {
			if (q < 0) {
				return false;
			}
		} else if (p < 0) {
			t0 = Math.max(t0, q / p);
		} else {
			t1 = Math.min(t1, q / p);
		}
	}
	return t0 <= t1;
}
const crossesLine = (box: Box, line: Pt[]) =>
	line.some((a, i) => i > 0 && crosses(box, line[i - 1] as Pt, a));

test("a line's fill is the area between it and zero, under the line, in a tint of its colour or one of the accent's states (#190)", () => {
	for (const fill of [true, "accent", "hollow", "hatch"]) {
		const svg = render({ series: [{ data: roof, fill }] });
		const [area] = pathsOf(svg, `area[^"]*`);
		const [line] = pathsOf(svg, "line");
		expect(area, String(fill)).toBeDefined();
		const polygon = vertices(area ?? "");
		const curve = vertices(line ?? "");
		// Its top edge is the line itself; the rest runs along zero, which is the plot's baseline.
		for (const p of curve) {
			expect(
				polygon.some((q) => Math.abs(q[0] - p[0]) < 0.11 && Math.abs(q[1] - p[1]) < 0.11),
			).toBe(true);
		}
		const [axis] = lines(svg, "axis");
		const zero = axis?.[2] ?? 0;
		for (const q of polygon) {
			const onLine = curve.some(
				(p) => Math.abs(q[0] - p[0]) < 0.11 && Math.abs(q[1] - p[1]) < 0.11,
			);
			expect(onLine || Math.abs(q[1] - zero) < 0.11).toBe(true);
		}
		// Under the line, so the line reads over it.
		expect(svg.indexOf('class="area')).toBeLessThan(svg.indexOf('class="line"'));
	}
	expect(render({ series: [{ data: roof, fill: true, color: "var(--c3)" }] })).toMatch(
		/<path class="area" style="--c:var\(--c3\)"/,
	);
	expect(render({ series: [{ data: roof, fill: "accent" }] })).toContain('class="area accent"');
	expect(render({ series: [{ data: roof, fill: "hollow" }] })).toContain('class="area hollow"');
	// Hatch: grey lines at 45 degrees, every one inside the area.
	const hatched = render({ series: [{ data: roof, fill: "hatch" }] });
	const polygon = vertices(pathsOf(hatched, "area hatch")[0] ?? "");
	const cuts = [
		...(pathsOf(hatched, "hatching")[0] ?? "").matchAll(
			/M([\d.-]+) ([\d.-]+)L([\d.-]+) ([\d.-]+)/g,
		),
	];
	expect(cuts.length).toBeGreaterThan(20);
	for (const [, x1, y1, x2, y2] of cuts) {
		expect(Number(x1) + Number(y1)).toBeCloseTo(Number(x2) + Number(y2), 0);
		const mid: Pt = [(Number(x1) + Number(x2)) / 2, (Number(y1) + Number(y2)) / 2];
		expect(inside(polygon, mid)).toBe(true);
	}
});

test("a region between two series over a span of x follows both lines, from the span's start to its end (#190)", () => {
	const svg = render(day([{ x: [8, 11.5], between: ["Roof", "House"], fill: "accent" }]));
	const [roofLine, houseLine] = pathsOf(svg, "line").map(vertices);
	const region = vertices(pathsOf(svg, "area accent")[0] ?? "");
	expect(region.length).toBeGreaterThan(6);
	// x = 8 and 11.5 are the 5th and 12th half hours, where both lines have a vertex.
	const from = roofLine?.[4]?.[0] ?? 0;
	const to = roofLine?.[11]?.[0] ?? 0;
	expect(Math.min(...region.map((p) => p[0]))).toBeCloseTo(from, 0);
	expect(Math.max(...region.map((p) => p[0]))).toBeCloseTo(to, 0);
	for (const p of region) {
		const onRoof = Math.abs((yAt(roofLine ?? [], p[0]) ?? -99) - p[1]) < 0.15;
		const onHouse = Math.abs((yAt(houseLine ?? [], p[0]) ?? -99) - p[1]) < 0.15;
		expect(onRoof || onHouse, `${p}`).toBe(true);
	}
	// A value may stand for a series: the region between the house and zero.
	const night = render(day([{ x: [22, 30], between: ["House", 0], fill: "hatch" }]));
	const [axis] = lines(night, "axis");
	const low = vertices(pathsOf(night, "area hatch")[0] ?? "");
	expect(Math.max(...low.map((p) => p[1]))).toBeCloseTo(axis?.[2] ?? 0, 0);
});

const NOTES = [
	{ x: [6.4, 11.5], between: ["Roof", "House"], fill: "accent" },
	{ x: [11.5, 17.6], between: ["Roof", "House"], label: "sold to the grid, 14.5 kWh" },
	{ at: [11.5, roofAt(11.5)], label: "battery full 11:31" },
	{ at: [15.7, roofAt(15.7)], label: "the roof makes 26.7 kWh" },
	{ at: [19, houseAt(19)], label: "the house uses 11.6 kWh" },
];

/** A note's box lies in the W x bottom drawing, crosses none of the lines and keeps apart from the other boxes. */
function expectClear(box: Box, others: Box[], curves: Pt[][], [W, bottom]: [number, number]) {
	expect(box.x0, `${W} px: ${box.text}`).toBeGreaterThanOrEqual(0);
	expect(box.x1, `${W} px: ${box.text}`).toBeLessThanOrEqual(W);
	expect(box.y0).toBeGreaterThanOrEqual(0);
	expect(box.y1).toBeLessThanOrEqual(bottom);
	for (const curve of curves) {
		expect(crossesLine(box, curve), `${W} px: ${box.text} on a line`).toBe(false);
	}
	for (const other of others) {
		const apart =
			box.x1 <= other.x0 || other.x1 <= box.x0 || box.y1 <= other.y0 || other.y1 <= box.y0;
		expect(apart, `${W} px: ${box.text} and ${other.text}`).toBe(true);
	}
}

test("notes sit beside their point or inside their region, clear of the lines and of each other, inside the plot from desktop to phone (#190)", () => {
	for (const W of [1054, 527, 326]) {
		const H = W > 600 ? 416 : 288;
		const svg = render(day(NOTES), W, H);
		const [roofLine = [], houseLine = []] = pathsOf(svg, "line").map(vertices);
		const said = boxes(svg, "note");
		const words = NOTES.flatMap((note) => note.label?.split(" ") ?? []);
		expect(
			said.flatMap((b) => b.text.split(" ")),
			`${W} px`,
		).toEqual(words);
		const [axis] = lines(svg, "axis");
		for (const [i, box] of said.entries()) {
			expectClear(box, said.slice(i + 1), [roofLine, houseLine], [W, axis?.[2] ?? H]);
		}
		// A point's label starts within a line of its point.
		const { x0 = 0, x1 = 0, y0 = 0, y1 = 0 } = said.find((b) => b.text.startsWith("battery")) ?? {};
		const [px = 0, py = 0] = roofLine[11] ?? [];
		const gap = Math.hypot(Math.max(x0 - px, px - x1, 0), Math.max(y0 - py, py - y1, 0));
		expect(gap, `${W} px`).toBeLessThan(LINE);
	}
});

test("a region's label sits inside it where it fits, and a note's data stretch the axes to it (#190)", () => {
	// On a desktop the region's label fits inside it: between the roof above and the house below.
	const svg = render(day(NOTES));
	const [roofLine = [], houseLine = []] = pathsOf(svg, "line").map(vertices);
	const sold = boxes(svg, "note").find((b) => b.text.startsWith("sold"));
	const mid = ((sold?.x0 ?? 0) + (sold?.x1 ?? 0)) / 2;
	expect(sold?.y0 ?? 0).toBeGreaterThan(yAt(roofLine, mid) ?? 0);
	expect(sold?.y1 ?? 0).toBeLessThan(yAt(houseLine, mid) ?? 0);
	// A note's data stretch the axes to it.
	const far = render(day([{ at: [40, 6], label: "far" }]));
	const [note] = boxes(far, "note");
	expect(note?.x0 ?? 0).toBeLessThan(1054);
	expect(note?.y0 ?? 0).toBeGreaterThan(0);
});

test("a note on a solid region is written against its colour, on a hollow or hatched one in ink on a halo (#190)", () => {
	const note = (fill: string) =>
		render(day([{ x: [10, 17], between: ["Roof", "House"], fill, label: "sold" }]));
	expect(note("accent")).toMatch(/<text class="note inside" [^>]*style="--c:var\(--accent\)"/);
	expect(note("hollow")).toMatch(/<text class="note" /);
});

test("a span on x is a bracket on top of the plot from its start to its end, its label in it, in the rows marker labels take (#190)", () => {
	const option = day([{ x: [20, 30], label: "on the battery all night" }]);
	for (const W of [1054, 326]) {
		const rows = plotDraw.markLines(option, W, 416, geist);
		expect(rows, `${W} px`).toBeGreaterThan(0);
		const svg = render(option, W);
		const [roofLine = []] = pathsOf(svg, "line").map(vertices);
		const span = lines(svg, "span");
		const xs = span.flatMap(([x1 = 0, x2 = 0]) => [x1, x2]);
		// 20:00 and 06:00 are the 29th and 49th half hours.
		expect(Math.min(...xs)).toBeCloseTo(roofLine[28]?.[0] ?? 0, 0);
		expect(Math.max(...xs)).toBeCloseTo(roofLine[48]?.[0] ?? 0, 0);
		const said = boxes(svg, "mark-label");
		expect(said.map((b) => b.text).join(" ")).toBe("on the battery all night");
		for (const box of said) {
			expect(box.x0).toBeGreaterThanOrEqual(0);
			expect(box.x1).toBeLessThanOrEqual(W);
			// On top: above every point of the plot.
			expect(box.y1).toBeLessThan(Math.min(...roofLine.map((p) => p[1])));
		}
	}
});

test("a bar's value label stays clear of a reference line: inside its bar's end where it fits, else past the line (#212)", () => {
	for (const [data, mark] of [
		[[10, 22], 12],
		[[1, 22], 2],
	] as const) {
		const option = {
			categories: ["first", "second"],
			horizontal: true,
			x: { min: 0, max: 24 },
			series: [{ type: "bar", data, label: { unit: "years" } }],
			marks: [{ x: mark, label: "Cells" }],
		};
		for (const W of [1054, 356]) {
			const rows = plotDraw.markLines(option, W, 148, geist);
			const svg = plotDraw.render(option, W, 148 + rows * LINE, geist, [true]);
			const [line] = lines(svg, "mark");
			const at = line?.[0] ?? 0;
			const values = [...boxes(svg, "value"), ...boxes(svg, "value inside")];
			expect(values, `${W} px`).toHaveLength(2);
			for (const v of values) {
				const clear = v.x1 + 2 <= at || at <= v.x0 - 2;
				expect(clear, `${W} px: ${v.text} at ${v.x0}..${v.x1}, line at ${at}`).toBe(true);
			}
		}
	}
});

const dir = scratch();
afterAll(dir.cleanup);

test("pack draws an annotated area plot into the page, the same as plot.js draws it (#190)", async () => {
	const option = JSON.stringify(day(NOTES, "hatch"));
	const output = await packedMdx(
		dir,
		"day",
		`import { Plot } from "kit";\n\n# A day\n\n<Plot label="A July day" option={${option}} />\n`,
	);
	const copies =
		readFileSync(output, "utf8").match(/<svg viewBox="0 0 [^"]+"[^>]*>.*?<\/svg>/gs) ?? [];
	expect(copies).toHaveLength(3);
	for (const svg of copies) {
		expect(svg).toContain('class="area accent"');
		expect(svg).toContain('class="area hatch"');
		expect(svg).toContain(">battery full");
	}
	const desktop = copies[0] ?? "";
	const W = Number(/viewBox="0 0 (\d+)/.exec(desktop)?.[1]);
	const H = Number(/viewBox="0 0 \d+ ([\d.]+)/.exec(desktop)?.[1]);
	expect(boxes(desktop, "note")).toEqual(boxes(render(day(NOTES, "hatch"), W, H), "note"));
});

test("pack fails on a region between a series the plot does not have, naming the lines it has (#190)", async () => {
	const option = JSON.stringify(day([{ x: [8, 11], between: ["Sun", "House"], fill: "accent" }]));
	const { result } = await packMdx(
		dir,
		"typo",
		`import { Plot } from "kit";\n\n# A day\n\n<Plot label="A July day" option={${option}} />\n`,
	);
	expect(result.code).not.toBe(0);
	expect(result.stderr).toContain('between "Sun"');
	expect(result.stderr).toContain('"Roof", "House"');
});

/** Every text of a drawing with its class ("" for tick labels) and box. */
const allTexts = (svg: string) =>
	[
		...svg.matchAll(
			/<text(?: class="([^"]*)")? x="([^"]+)" y="([^"]+)"[^>]*text-anchor="(\w+)"[^>]*>([^<]*)</g,
		),
	].map(([, cls = "", x = "0", y = "0", anchor, text = ""]) => {
		const w = geist(text);
		const x0 =
			anchor === "end" ? Number(x) - w : anchor === "middle" ? Number(x) - w / 2 : Number(x);
		return { cls, anchor, text, x0, x1: x0 + w, y0: Number(y) - 6.5, y1: Number(y) + 6.5 };
	});
/** The y axis's tick labels, as numbers, with their y. */
const yTicks = (svg: string) =>
	allTexts(svg)
		.filter((t) => !t.cls && t.anchor === "end")
		.map((t) => ({ value: Number(t.text.replace(/[^\d.-]/g, "")), y: (t.y0 + t.y1) / 2 }));

test("automatic ranges take in a filled line's zero and a region's bound by value; an axis the author bounds stays (#190)", () => {
	const filled = render({
		series: [
			{
				name: "A",
				data: [
					[0, 50],
					[10, 60],
				],
				fill: true,
			},
		],
	});
	const zero = yTicks(filled).find((t) => t.value === 0);
	expect(zero).toBeDefined();
	const [area = ""] = pathsOf(filled, 'area[^"]*');
	expect(Math.max(...vertices(area).map(([, y]) => y))).toBeCloseTo(zero?.y ?? 0, 0);
	const level = render({
		series: [
			{
				name: "A",
				data: [
					[0, 1],
					[10, 3],
				],
			},
		],
		marks: [{ x: [2, 8], between: ["A", 5], fill: "accent" }],
	});
	const five = yTicks(level).find((t) => t.value === 5);
	expect(five).toBeDefined();
	const [region = ""] = pathsOf(level, 'area[^"]*');
	expect(Math.min(...vertices(region).map(([, y]) => y))).toBeCloseTo(five?.y ?? 0, 0);
	const bounded = render({
		series: [
			{
				name: "A",
				data: [
					[0, 50],
					[10, 60],
				],
				fill: true,
			},
		],
		y: { min: 40 },
	});
	expect(yTicks(bounded).some((t) => t.value === 0)).toBe(false);
});

/** Whether two boxes share any area. */
const touch = (a: Box, b: Box) => !(a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0);
/** The notes of a drawing that cross a line or a marker, touch another text, or leave the drawing. */
function unclear(svg: string, W: number, H: number) {
	const curves = [
		...pathsOf(svg, "line").map(vertices),
		...lines(svg, "mark").map(([x1 = 0, x2 = 0, y1 = 0, y2 = 0]): Pt[] => [
			[x1, y1],
			[x2, y2],
		]),
	];
	const texts = allTexts(svg);
	return texts
		.filter((t) => t.cls.startsWith("note"))
		.filter(
			(note) =>
				note.x0 < 0 ||
				note.x1 > W ||
				note.y0 < 0 ||
				note.y1 > H ||
				curves.some((curve) => crossesLine(note, curve)) ||
				texts.some((other) => other !== note && touch(note, other)),
		)
		.map((note) => `${note.text} at ${W} px`);
}

test("the July fixture's notes keep clear of its lines, of each other and of every other text, desktop to the narrowest phone (#190)", () => {
	for (const [W, H] of [
		[1054, 416],
		[527, 288],
		[358, 280],
		[356, 288],
		[326, 288],
	] as const) {
		const svg = plotDraw.render(JULY, W, H, geist, [true, true]);
		expect(unclear(svg, W, H)).toEqual([]);
		expect(plotDraw.crowded()).toEqual([]);
	}
});

test("a note with no clear place is reported, never drawn over another text silently: six at one point, a word wider than the plot (#190)", () => {
	const six = day(
		["first", "second", "third", "fourth", "fifth", "sixth"].map((label) => ({
			at: [12, roofAt(12)],
			label: `${label} note`,
		})),
	);
	for (const [W, H] of [
		[1054, 416],
		[356, 288],
		[326, 160],
	] as const) {
		const svg = render(six, W, H);
		const crowded = plotDraw.crowded();
		// A note line drawn where it is not clear belongs to a note reported crowded.
		const silent = unclear(svg, W, H).filter(
			(line) => !crowded.some((label) => label.includes(line.replace(/ at \d+ px$/, ""))),
		);
		expect(silent).toEqual([]);
		expect(allTexts(svg).filter((t) => t.cls.startsWith("note")).length).toBeGreaterThanOrEqual(6);
	}
	render(
		day([
			{ at: [12, 2], label: "Donaudampfschifffahrtsgesellschaftskapitänswitwenrentenversicherung" },
		]),
		326,
		288,
	);
	expect(plotDraw.crowded()).toEqual([
		"Donaudampfschifffahrtsgesellschaftskapitänswitwenrentenversicherung",
	]);
});

test("a region goes, with its label, when the legend switches off a line it lies against (#190)", () => {
	const option = day([
		{ x: [11.5, 17.6], between: ["Roof", "House"], fill: "accent", label: "sold" },
	]);
	const hidden = plotDraw.render(option, 1054, 416, geist, [false, true]);
	expect(hidden).not.toContain('class="area');
	expect(hidden).not.toContain(">sold<");
	expect(plotDraw.render(option, 1054, 416, geist, [true, true])).toContain(">sold<");
});

test("pack fails on a region without a span or a mark mixing shapes, saying what to write (#190)", async () => {
	const cases = [
		[{ between: ["Roof", 0], fill: "accent", label: "x" }, "x: [from, to]"],
		[{ x: 5, between: ["Roof", "House"], fill: "accent" }, "x: [from, to]"],
		[{ x: 5, fill: "accent" }, "between"],
		[{ at: [12, 1], x: 5, label: "x" }, "of its own"],
	] as const;
	for (const [i, [mark, says]] of cases.entries()) {
		const option = JSON.stringify(day([mark]));
		const { result } = await packMdx(
			dir,
			`shape${i}`,
			`import { Plot } from "kit";\n\n# A day\n\n<Plot label="A July day" option={${option}} />\n`,
		);
		expect(result.code, JSON.stringify(mark)).not.toBe(0);
		expect(result.stderr).toContain(says);
	}
});

test("pack warns about a note it finds no clear place for, naming the note and the width (#190)", async () => {
	const option = JSON.stringify(
		day([
			{ at: [12, 2], label: "Donaudampfschifffahrtsgesellschaftskapitänswitwenrentenversicherung" },
		]),
	);
	const { result } = await packMdx(
		dir,
		"crowded",
		`import { Plot } from "kit";\n\n# A day\n\n<Plot label="A July day" option={${option}} />\n`,
	);
	expect(result.code).toBe(0);
	expect(result.stdout).toContain(
		'"Donaudampfschifffahrtsgesellschaftskapitänswitwenrentenversicherung"',
	);
	expect(result.stdout).toContain("356 px");
});

const { between } = (
	runKitPart("plot/tween.ts", "PlotTween") as () => {
		between(from: object, to: object, k: number): object;
	}
)();

test("a region and a note move with a tweened line, their texts the same at every step and their places without jumps (#190)", () => {
	const at = (scale: number) => ({
		...day(
			[
				{ x: [8, 15], between: ["Roof", "House"], fill: "accent", label: "charging" },
				{ at: [13, roofAt(13) * scale], label: `full at 13:00` },
			],
			"hatch",
		),
		series: [
			{ name: "Roof", data: roof.map(([t, y]) => [t, y * scale]), fill: "hatch" },
			{ name: "House", data: house },
		],
		y: { min: 0, max: 4 },
	});
	const [from, to] = [at(1), at(0.6)];
	// The texts, their lines included, are where the move goes from the first step on.
	const goal = boxes(render(to), "note(?: inside)?").map((b) => b.text);
	expect(goal.join(" ")).toContain("full at");
	let last: { region: string; note: Box; line: Pt[] } | undefined;
	for (let k = 0; k <= 10; k++) {
		// As plot.js draws a move: each step's option, with the texts of where it goes.
		const svg = k < 10 ? render(between(from, to, k / 10), 1054, 416, to) : render(to);
		const [region = ""] = pathsOf(svg, "area accent");
		const [line = ""] = pathsOf(svg, "line");
		const texts = boxes(svg, "note(?: inside)?");
		expect(texts.map((b) => b.text)).toEqual(goal);
		const note = texts.filter((b) => b.text !== "charging");
		// The region's top edge is the line as drawn at this step.
		const roofLine = vertices(line);
		for (const [x, y] of vertices(region).filter(([, y]) => y < 300)) {
			const expected = yAt(roofLine, x);
			if (expected !== undefined) {
				expect(Math.abs(y - expected)).toBeLessThan(1.5);
			}
		}
		const box = note.reduce((a, b) => ({
			text: a.text,
			x0: Math.min(a.x0, b.x0),
			x1: Math.max(a.x1, b.x1),
			y0: Math.min(a.y0, b.y0),
			y1: Math.max(a.y1, b.y1),
		}));
		if (last) {
			expect(region).not.toBe(last.region);
			// The note moves no further than the line under it does, rather than jumping to another place.
			const was = last.line;
			const step = Math.max(...roofLine.map(([, y], i) => Math.abs(y - (was[i]?.[1] ?? y))));
			expect(Math.abs(box.x0 - last.note.x0)).toBeLessThan(0.5);
			expect(Math.abs(box.y0 - last.note.y0)).toBeLessThanOrEqual(step + 0.5);
		}
		last = { region, note: box, line: roofLine };
	}
	expect(last?.region).toBe(pathsOf(render(to), "area accent")[0]);
});
