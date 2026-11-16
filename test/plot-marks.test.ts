import { expect, test } from "bun:test";
import { textWidth } from "../skills/explainer/src/geist.ts";
import { draw, lines, plotDraw, rects, texts, width } from "./plot-draw.ts";

test("a labelled reference marker is a dashed line with its label on top beside it, wrapping inside the plot on a phone (#190)", () => {
	const label = "16 years: cells rated for 6,000 cycles";
	const option = {
		categories: ["first", "second", "third"],
		horizontal: true,
		series: [{ type: "bar", data: [10, 62, 165] }],
		marks: [{ x: 16, label }],
	};
	const wide = plotDraw.render(option, 600, 221, width, [true]);
	const [line] = lines(wide, "mark");
	const [x1 = 0, x2 = 0, top = 0, bottom = 0] = line ?? [];
	expect(x1).toBe(x2);
	const [first] = rects(wide, "bar");
	const [said] = texts(wide, "mark-label");
	expect(texts(wide, "mark-label")).toHaveLength(1);
	expect(said?.text).toBe(label);
	expect(said?.x).toBeCloseTo(x1 + 6, 0);
	// On top: above the first bar, and the line starts where the label does.
	expect(said?.y ?? 0).toBeLessThan(first?.[1] ?? 0);
	expect(top).toBeLessThan(said?.y ?? 0);
	expect(bottom).toBeGreaterThan((first?.[1] ?? 0) + 25);
	// The rows keep 56 px: the label's line is room of its own.
	expect(first?.[3]).toBeCloseTo(25, 0);
	// A phone: the label wraps into lines that all start beside the line and end inside the plot.
	const narrow = texts(plotDraw.render(option, 240, 260, width, [true]), "mark-label");
	expect(narrow.length).toBeGreaterThan(1);
	expect(new Set(narrow.map((t) => t.x)).size).toBe(1);
	for (const t of narrow) {
		expect(t.x + width(t.text)).toBeLessThanOrEqual(240);
	}
	expect(narrow.map((t) => t.text).join(" ")).toBe(label);
	// A marker past the data stretches the axis to it.
	const past = lines(
		plotDraw.render({ ...option, marks: [{ x: 300, label: "far" }] }, 600, 221, width, [true]),
		"mark",
	);
	expect(past[0]?.[0]).toBeLessThanOrEqual(600 - 16);
	// y holds a marker across the plot, its label on top at the line's end.
	const across = draw({
		series: [
			{
				data: [
					[0, 0],
					[1, 10],
				],
			},
		],
		marks: [{ y: 5, label: "half" }],
	} as never);
	const [flat] = lines(across, "mark");
	expect(flat?.[2]).toBe(flat?.[3]);
	expect(across).toMatch(
		/<text class="mark-label" x="[^"]+" y="[^"]+" dy="0.35em" text-anchor="end">half</,
	);
	expect(texts(across, "mark-label")[0]?.y ?? 0).toBeLessThan(flat?.[2] ?? 0);
});

/** A label's width as pack measures it: Geist at the label size, weight 500. */
const geist = (s: unknown) => textWidth(String(s), 13, 500);
/** px: a bar plot's area around its rows, 10 above and 26 below, and a marker label's line. */
const AROUND = 36;
const LINE = 17;

test("a bar plot's marker labels take the lines they wrap into at its width, on top of its 56 px rows (#190)", () => {
	const option = {
		categories: ["Battery"],
		horizontal: true,
		series: [{ type: "bar", data: [20] }],
		marks: [{ x: 16, label: "16 years: cells rated for 6,000 cycles" }],
	};
	for (const W of [1054, 356, 326, 288]) {
		const lines = plotDraw.markLines(option, W, 56 + AROUND, geist);
		const svg = plotDraw.render(option, W, 56 + AROUND + lines * LINE, geist, [true]);
		const [bar] = rects(svg, "bar");
		expect(bar?.[3], `${W} px`).toBeCloseTo(25, 0);
		const said = texts(svg, "mark-label");
		expect(said, `${W} px`).toHaveLength(lines);
		expect(Math.min(...said.map((t) => t.y))).toBeGreaterThan(0);
	}
	expect(plotDraw.markLines(option, 1054, 92, geist)).toBe(1);
	expect(plotDraw.markLines(option, 288, 92, geist)).toBeGreaterThan(1);
});

test("marker labels on top never overlap: a label too close to another takes the other side, else a row of its own (#190)", () => {
	const option = {
		categories: ["One"],
		horizontal: true,
		x: { min: 0, max: 100 },
		series: [{ type: "bar", data: [100] }],
		marks: [
			{ x: 60, label: "Payback" },
			{ x: 98, label: "Break even" },
		],
	};
	for (const W of [1054, 326]) {
		const lines = plotDraw.markLines(option, W, 56 + AROUND, geist);
		const svg = plotDraw.render(option, W, 56 + AROUND + lines * LINE, geist, [true]);
		const boxes = [
			...svg.matchAll(
				/<text class="mark-label" x="([^"]+)" y="([^"]+)"[^>]*text-anchor="(\w+)">([^<]*)</g,
			),
		].map(([, x = "0", y = "0", anchor, text]) => {
			const w = geist(text);
			const x0 = anchor === "end" ? Number(x) - w : Number(x);
			return { text, x0, x1: x0 + w, y: Number(y) };
		});
		expect(boxes.map((b) => b.text).sort()).toEqual(["Break even", "Payback"]);
		for (const [i, a] of boxes.entries()) {
			for (const b of boxes.slice(i + 1)) {
				const apart = a.x1 <= b.x0 || b.x1 <= a.x0 || Math.abs(a.y - b.y) >= LINE;
				expect(apart, `${W} px: ${a.text} and ${b.text}`).toBe(true);
			}
			expect(a.x0).toBeGreaterThanOrEqual(0);
			expect(a.x1).toBeLessThanOrEqual(W);
		}
		expect(rects(svg, "bar")[0]?.[3]).toBeCloseTo(25, 0);
	}
});
