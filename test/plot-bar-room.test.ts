/* A bar plot's room for its series' names: kept for a whole move, the layout drawn the one sized and picked in, and a stack's
   names never taking the plot's width (#190). */
import { expect, test } from "bun:test";
import { runKitPart } from "../skills/explainer/src/kit.ts";
import { bars, middle, names, overlap, SIZES } from "./bar-names-read.ts";
import { draw, lines, plotDraw, width } from "./plot-draw.ts";

/** A step of plot.js's tween between two options. */
const { between } = (
	runKitPart("plot/tween.ts", "PlotTween") as () => {
		between(from: object, to: object, k: number): { series: object[] };
	}
)();
const SERIES = ["Heat pump", "Gas boiler", "District heat"];

test("a move between grouped options keeps room for its start and its end, so no step draws a name on a bar (#190)", () => {
	const option = (a: number[], b: number[]) => ({
		categories: ["North", "South"],
		series: [
			{ name: "Alpha", type: "bar", data: a, label: true },
			{ name: "Beta", type: "bar", data: b, label: true },
		],
	});
	const [from, to] = [option([6, 10], [5, 10]), option([6, 2], [5, 1])];
	for (const [W, H] of SIZES) {
		for (const k of [0, 0.05, 0.3, 0.6]) {
			const step = between(from, to, k);
			const svg = plotDraw.render(step, W, H, width, [true, true], to, from);
			expect(plotDraw.crowded().names, `${W} at ${k}`).toEqual([]);
			expect(lines(svg, "leader").length, `${W} at ${k}: a leader per name`).toBeGreaterThanOrEqual(
				2,
			);
			for (const t of names(svg)) {
				for (const b of bars(svg)) {
					expect(overlap(t.box, b.box), `${W} at ${k}: ${t.text} on a bar`).toBe(false);
				}
			}
		}
	}
});

test("a bar plot's marker rows are counted in the layout it is drawn in, also where the room for names does not fit (#190)", () => {
	const option = {
		horizontal: true,
		categories: ["Only"],
		series: [
			{ name: "Heat pump", type: "bar", data: [9.5] },
			{ name: "Gas boiler", type: "bar", data: [9] },
		],
		marks: [1, 3, 5, 7, 9].map((v, i) => ({ x: [v, v + 1], label: `S${i}xxxx` })),
		x: { min: 0, max: 10 },
	};
	for (const H of [110, 130, 300]) {
		const svg = plotDraw.render(option, 356, H, width, [true, true]);
		const rows = new Set(
			[...svg.matchAll(/<text class="mark-label"[^>]* y="([^"]+)"/g)].map((m) => m[1]),
		).size;
		expect(plotDraw.markLines(option, 356, H, width), `${H}`).toBe(rows);
	}
});

test("stacked columns use the full plot width when their names fit inside (#261)", () => {
	const option = {
		categories: ["North", "South", "East"],
		stack: true,
		series: ["A", "B"].map((name, j) => ({ name, type: "bar", data: [3 + j, 4, 5 - j] })),
	};
	const svg = draw(option, 356, 288);
	expect(
		names(svg)
			.filter((t) => t.inside)
			.map((t) => t.text),
	).toEqual(["A", "B"]);
	expect(bars(svg)).toEqual(bars(draw({ ...option, legend: false }, 356, 288)));
});

test("a move between stacks cannot spend the destination categories' label space (#261)", () => {
	const categories = ["North", "East", "South", "West", "Centre"];
	const to = {
		stack: true,
		categories: categories.map((name) => ({ name, note: "Sites" })),
		series: SERIES.map((name, j) => ({
			name,
			type: "bar",
			data: categories.map((_, i) => 3 + ((i * 7 + j * 5) % 9)),
		})),
		y: { format: (v: number) => `${String(v).padStart(2, "0")} kg` },
	};
	const from = {
		stack: to.stack,
		categories: categories.slice(0, 3),
		series: to.series.map((s) => ({ ...s, data: s.data.slice(0, 3) })),
	};
	for (const k of [0, 0.5, 1]) {
		const svg = plotDraw.render(
			between(from, to, k),
			356,
			280,
			width,
			[true, true, true],
			to,
			from,
		);
		const ticks = [...svg.matchAll(/<text class="cat"[^>]*>([^<]+)<\/text>/g)].map((m) => m[1]);
		expect(ticks, `move at ${k}`).toEqual(categories);
	}
});

test("stacked columns keep a plot to draw when their names would take its width, and report the names (#190)", () => {
	const option = {
		categories: ["North", "South", "East"],
		stack: true,
		series: ["Heat pump unit A", "Gas boiler unit B"].map((name, j) => ({
			name,
			type: "bar",
			data: [3 + j, 4, 5 - j],
		})),
		y: { format: (v: number) => `${v} thousand households per year` },
	};
	const svg = draw(option, 356, 288);
	expect(bars(svg).length).toBe(6);
	// One name can wrap beside its segment; the other still has no clear spot and pack warns about it.
	expect(plotDraw.crowded().names).toEqual(["Gas boiler unit B"]);
	expect(
		names(svg)
			.map((t) => t.text)
			.join(" "),
	).toBe("Heat pump unit A Gas boiler unit B");
});

test("a grouped plot's bands for picking are where its categories are drawn, below the names' room (#190)", () => {
	const option = {
		horizontal: true,
		categories: ["North", "South"],
		series: SERIES.map((name, j) => ({ name, type: "bar", data: [4 + j, 6 - j] })),
	};
	for (const [W, H] of SIZES) {
		const at = plotDraw.bands(option, W, H, width);
		expect(at, `${W}`).toBeDefined();
		const band = ((at?.end ?? 0) - (at?.start ?? 0)) / (at?.count ?? 1);
		const drawn = bars(draw(option, W, H));
		for (const [i, category] of option.categories.entries()) {
			// A category's bars are centred in its band.
			const mids = drawn.filter((b) => b.category === category).map((b) => middle(b.box)[1]);
			const centre = (Math.min(...mids) + Math.max(...mids)) / 2;
			expect(centre, `${W}: ${category}`).toBeCloseTo((at?.start ?? 0) + (i + 0.5) * band, 0);
		}
	}
});
