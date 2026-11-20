/* Plot's stem and bar names: on their marks at every width, never an automatic legend, and reported by pack where no spot is
   readable (#190, user 2026-11-20). */
import { afterAll, expect, test } from "bun:test";
import {
	type Box,
	bars,
	hull,
	middle,
	names,
	overlap,
	SIZES,
	stems,
	toBox,
	values,
	within,
} from "./bar-names-read.ts";
import { draw, lines, plotDraw, width } from "./plot-draw.ts";
import { packMdx, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const CATEGORIES = ["North", "East", "South", "West", "Centre"];
const SERIES = ["Heat pump", "Gas boiler", "District heat"];
const data = (j: number) => CATEGORIES.map((_, i) => 3 + ((i * 7 + j * 5) % 9));
const barPlot = (extra: object, labels = false) => ({
	categories: CATEGORIES,
	series: SERIES.map((name, j) => ({
		name,
		type: "bar",
		data: data(j),
		...(labels && { label: true }),
	})),
	...extra,
});
const CASES = {
	"grouped columns": barPlot({}),
	"grouped columns with values": barPlot({}, true),
	"grouped rows with values": barPlot({ horizontal: true }, true),
	"stacked columns": barPlot({ stack: true }),
	"stacked rows": barPlot({ stack: true, horizontal: true }),
};

/** Whether the segment from a to b passes through the box, sampled every px. */
function through(box: Box, [ax, ay]: [number, number], [bx, by]: [number, number]) {
	const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
	return Array.from({ length: n + 1 }, (_, k) => [
		ax + ((bx - ax) * k) / n,
		ay + ((by - ay) * k) / n,
	]).some(
		([x = 0, y = 0]) =>
			x > box.x0 + 0.5 && x < box.x1 - 0.5 && y > box.y0 + 0.5 && y < box.y1 - 0.5,
	);
}

type Segment = { a: [number, number]; b: [number, number] };
/**
 * A leader's end (one of its last piece's points, which a row's elbow draws right to left) at its own bar: level with it, and
 * within 3 px of the bar or of a value label on the bar's own row or column.
 */
function expectAtOwnBar(
	ends: readonly [number, number][],
	own: Box | undefined,
	taken: Box[],
	at: string,
) {
	const bar = own ?? { x0: 0, x1: 0, y0: 0, y1: 0 };
	const toBar = (p: [number, number]) => toBox(p, bar);
	const [x, y] = [...ends].sort((p, q) => toBar(p) - toBar(q))[0] ?? [0, 0];
	const horizontal = bar.x1 - bar.x0 > bar.y1 - bar.y0;
	const level = (b: Box) =>
		horizontal
			? middle(b)[1] > bar.y0 && middle(b)[1] < bar.y1
			: middle(b)[0] > bar.x0 && middle(b)[0] < bar.x1;
	const [lo, hi, v] = horizontal ? [bar.y0, bar.y1, y] : [bar.x0, bar.x1, x];
	expect(v > lo && v < hi, at).toBe(true);
	const near = [bar, ...taken.filter(level)].some((b) => toBox([x, y], b) <= 3);
	expect(near, at).toBe(true);
}
/** A name's leader: the segments chained from the one leaving the name's bottom, each turned to run away from the name. */
function leaderOf(box: Box, segments: readonly Segment[]) {
	const chain: Segment[] = [];
	let tip = segments.find(
		(s) => Math.abs(s.a[1] - box.y1) < 3 && s.a[0] >= box.x0 - 4 && s.a[0] <= box.x1,
	);
	const at = ([x, y]: [number, number], p: [number, number]) =>
		Math.hypot(p[0] - x, p[1] - y) < 0.2;
	const used = new Set<Segment>();
	while (tip && chain.length < segments.length) {
		chain.push(tip);
		used.add(tip);
		const end = tip.b;
		const next = segments.find((s) => !used.has(s) && (at(end, s.a) || at(end, s.b)));
		if (next) {
			used.add(next);
		}
		tip = next && (at(end, next.a) ? next : { a: next.b, b: next.a });
	}
	return chain;
}

/**
 * Bars side by side named on one group (the last column group, the first row group): the names stacked above it in series
 * order, each with a leader from under it to its own bar there that crosses no other bar and no other name.
 */
function expectGroupNames(svg: string, W: number, label: string) {
	const drawn = names(svg);
	const all = bars(svg);
	const horizontal = label.includes("rows");
	const group = horizontal ? CATEGORIES[0] : CATEGORIES.at(-1);
	const top = Math.min(...all.filter((b) => b.category === group).map((b) => b.box.y0));
	const segments = lines(svg, "leader").map(
		([x1 = 0, x2 = 0, y1 = 0, y2 = 0]): Segment => ({ a: [x1, y1], b: [x2, y2] }),
	);
	for (const [k, name] of SERIES.entries()) {
		const at = `${label} at ${W}: ${name}`;
		const box = drawn.find((t) => t.text === name)?.box;
		expect(box, at).toBeDefined();
		if (!box) {
			continue;
		}
		expect(box.y1, at).toBeLessThanOrEqual(top);
		const below = drawn.find((t) => t.text === SERIES[k + 1])?.box;
		expect(below ? below.y0 >= box.y1 - 0.5 : true, `${at} above the next name`).toBe(true);
		// Its leader: the segments chained from the one leaving the name's bottom.
		const own = all.find((b) => b.category === group && b.series === name)?.box;
		const obstacles = [
			...all.filter((b) => !(b.category === group && b.series === name)).map((b) => b.box),
			...drawn.filter((t) => t.text !== name).map((t) => t.box),
		];
		const chain = leaderOf(box, segments);
		expect(chain.length, `${at} has a leader`).toBeGreaterThan(0);
		for (const { a, b } of chain) {
			expect(
				obstacles.some((o) => through(o, a, b)),
				`${at}: its leader crosses a bar or a name`,
			).toBe(false);
		}
		expectAtOwnBar(
			chain.length ? [chain.at(-1)?.b ?? [0, 0]] : [],
			own,
			values(svg),
			`${at}: its leader ends at its bar`,
		);
	}
}

/**
 * Every named series' name drawn once, whole inside the figure, clear of every other series' bars and every value; unless pack
 * reports it crowded, nearer its own bars than any other series', and inside its own bar when it is on one.
 */
function expectNamedBars(svg: string, [W, H]: readonly [number, number], label: string) {
	const drawn = names(svg);
	const all = bars(svg);
	const taken = values(svg);
	for (const name of SERIES) {
		const own = drawn.filter((t) => name.includes(t.text));
		const at = `${label} at ${W}: ${name}`;
		expect(own.map((t) => t.text).join(" "), at).toBe(name);
		const box = hull(own.map((t) => t.box));
		expect(box.x0, at).toBeGreaterThanOrEqual(0);
		expect(box.x1, at).toBeLessThanOrEqual(W);
		expect(box.y0, at).toBeGreaterThanOrEqual(0);
		expect(box.y1, at).toBeLessThanOrEqual(H);
		for (const other of all.filter((b) => b.series !== name)) {
			expect(overlap(box, other.box), `${at} over ${other.series}'s bar`).toBe(false);
		}
		for (const value of taken) {
			expect(overlap(box, value), `${at} over a value`).toBe(false);
		}
		if (plotDraw.crowded().names.includes(name) || label.startsWith("grouped")) {
			continue;
		}
		const nearest = (series: string) =>
			Math.min(...all.filter((b) => b.series === series).map((b) => toBox(middle(box), b.box)));
		for (const other of SERIES.filter((s) => s !== name)) {
			expect(nearest(name), `${at} nearer ${other}`).toBeLessThan(nearest(other));
		}
		if (own.some((t) => t.inside)) {
			expect(
				all.some((b) => b.series === name && within(box, b.box)),
				at,
			).toBe(true);
		}
	}
}

test("named bars with no legend set carry their names on their bars at every width, never a legend; bars side by side on one group (#190, owner 2026-11-20)", () => {
	for (const [label, option] of Object.entries(CASES)) {
		expect(plotDraw.legendMarkup(option), label).toBe("");
		for (const [W, H] of SIZES) {
			const svg = draw(option, W, H);
			expectNamedBars(svg, [W, H], label);
			if (label.startsWith("grouped")) {
				expectGroupNames(svg, W, label);
			}
			expect(plotDraw.crowded().names, `${label} at ${W}`).toEqual([]);
		}
	}
});

test("stacked column names leave room for all five category labels at 356 px (#261)", () => {
	const svg = draw(CASES["stacked columns"], 356, 280);
	const ticks = [...svg.matchAll(/<text x="[^>]+>([^<]+)<\/text>/g)].map((m) => m[1] ?? "");
	expect(ticks.filter((text) => CATEGORIES.includes(text))).toEqual(CATEGORIES);
	expectNamedBars(svg, [356, 280], "stacked columns");
	expect(plotDraw.crowded().names).toEqual([]);
});

test("a half-width stack keeps only a small side gutter when it makes the names readable (#261)", () => {
	const option = CASES["stacked columns"];
	draw(option, 527, 280);
	expect(plotDraw.crowded().names).toEqual([]);
	const named = plotDraw.bands(option, 527, 280, width);
	const plain = plotDraw.bands({ ...option, legend: false }, 527, 280, width);
	const gutter = (plain?.end ?? 0) - (named?.end ?? 0);
	expect(gutter).toBeGreaterThan(0);
	expect(gutter).toBeLessThan(25);
});

test("an author's legend, a legend that is off and a picked key keep bar names off the bars (#190)", () => {
	const option = CASES["grouped columns"];
	expect(plotDraw.legendMarkup({ ...option, legend: true })).not.toBe("");
	expect(names(draw({ ...option, legend: true }))).toEqual([]);
	expect(names(draw({ ...option, legend: false }))).toEqual([]);
	expect(plotDraw.legendMarkup({ ...option, pick: 1 })).not.toBe("");
	expect(names(draw({ ...option, pick: 1 }))).toEqual([]);
	// One named bar series is the plot's own subject, which its label says: no legend, and no name on it.
	const one = {
		categories: CATEGORIES,
		series: [{ name: "Heat pump", type: "bar", data: data(0) }],
	};
	expect(plotDraw.legendMarkup(one)).toBe("");
	expect(names(draw(one))).toEqual([]);
});

test("named stems carry their names beside their stems at every width, never a legend (#190)", () => {
	const spectrum = (k: number) => [1, 2, 3, 4, 5, 6].map((n) => [n + k * 0.4, 6 / (n + k)]);
	const option = {
		series: [
			{ name: "Square wave", type: "stem", data: spectrum(0) },
			{ name: "Sawtooth", type: "stem", data: spectrum(1) },
		],
		x: { min: 0, max: 7 },
	};
	expect(plotDraw.legendMarkup(option)).toBe("");
	for (const [W, H] of SIZES) {
		const svg = draw(option, W, H);
		const drawn = names(svg);
		const segments = stems(svg).map(([x1 = 0, , y1 = 0, y2 = 0]) => ({
			x: x1,
			y0: Math.min(y1, y2),
			y1: Math.max(y1, y2),
		}));
		// Stems are drawn series by series, six each.
		const own = (j: number) => segments.slice(j * 6, j * 6 + 6);
		for (const [j, name] of ["Square wave", "Sawtooth"].entries()) {
			const at = `${W}: ${name}`;
			const mine = drawn.filter((t) => name.includes(t.text));
			expect(mine.map((t) => t.text).join(" "), at).toBe(name);
			const box = hull(mine.map((t) => t.box));
			expect(box.x0, at).toBeGreaterThanOrEqual(0);
			expect(box.x1, at).toBeLessThanOrEqual(W);
			if (plotDraw.crowded().names.includes(name)) {
				continue;
			}
			// px from the name's middle to the nearest of the stems, as ends.ts reads a name as its series'.
			const near = (list: typeof segments) =>
				Math.min(...list.map((s) => toBox(middle(box), { x0: s.x, x1: s.x, y0: s.y0, y1: s.y1 })));
			// A name with a leader is tied to one of its own stems; one without lies nearer its own stems than the other's. A
			// leader is the name's when one end touches the name and the other a stem.
			const onStem = (list: typeof segments) => (p: [number, number]) =>
				list.some((s) => toBox(p, { x0: s.x, x1: s.x, y0: s.y0, y1: s.y1 }) <= 6);
			const leaders = lines(svg, "leader")
				.map(([x1 = 0, x2 = 0, y1 = 0, y2 = 0]): [number, number][] => [
					[x1, y1],
					[x2, y2],
				])
				.filter(([a = [0, 0], b = [0, 0]]) =>
					[
						[a, b],
						[b, a],
					].some(([p = a, q = b]) => toBox(p, box) <= 3 && onStem(segments)(q)),
				);
			const tied = leaders.some((ends) => ends.some(onStem(own(j))));
			expect(leaders.length ? tied : near(own(j)) < near(own(1 - j)), at).toBe(true);
		}
		expect(plotDraw.crowded().names, `${W}`).toEqual([]);
	}
});

test("pack warns about a bar series whose name finds no readable place, naming it and the width (#190)", async () => {
	const many = Array.from({ length: 14 }, (_, i) => `Region ${i + 1}`);
	const option = {
		categories: many,
		series: [
			"Installed heat pumps this year",
			"Installed gas boilers this year",
			"Connected to district heat",
		].map((name, j) => ({
			name,
			type: "bar",
			data: many.map((_, i) => 4 + ((i + j * 3) % 5)),
			label: true,
		})),
	};
	const { result } = await packMdx(
		dir,
		"bar-names-crowded",
		`import { Plot } from "kit";\n\n# Crowded\n\n<Plot label="Crowded" option={${JSON.stringify(option)}} />\n`,
	);
	expect(result.code).toBe(0);
	expect(result.stdout).toMatch(
		/Plot series "[^"]+" finds no clear place for its name at 356 px wide/,
	);
});

test("a horizontal bar plot of several named series is sized by its bars, as it has no legend (#190)", async () => {
	const { result, output } = await packMdx(
		dir,
		"bar-names-height",
		`import { Plot } from "kit";\n\n# Rows\n\n<Plot label="Rows" option={${JSON.stringify(CASES["grouped rows with values"])}} />\n`,
	);
	expect(result.code).toBe(0);
	const size = (html: string) =>
		Number(html.match(/class="chart plot" style="block-size:([\d.]+)rem/)?.[1]);
	const off = await packMdx(
		dir,
		"bar-names-height-off",
		`import { Plot } from "kit";\n\n# Rows\n\n<Plot label="Rows" option={${JSON.stringify({ ...CASES["grouped rows with values"], legend: false })}} />\n`,
	);
	// A line of 1.0625rem for each of the three names, which legend: false leaves out.
	expect(size(await Bun.file(output).text()) - size(await Bun.file(off.output).text())).toBeCloseTo(
		3 * 1.0625,
		4,
	);
	// A tall plot, capped by its bars, still adds the names' lines past the cap.
	const many = Array.from({ length: 12 }, (_, i) => `Region ${i + 1}`);
	const tall = (legend?: boolean) => ({
		horizontal: true,
		categories: many,
		series: ["Heat pump", "Gas boiler"].map((name, j) => ({
			name,
			type: "bar",
			data: many.map((_, i) => 3 + ((i + j) % 4)),
		})),
		...(legend === false && { legend }),
	});
	const [named, plain] = await Promise.all(
		[tall(), tall(false)].map(async (option, k) => {
			const packed = await packMdx(
				dir,
				`bar-names-tall-${k}`,
				`import { Plot } from "kit";\n\n# Rows\n\n<Plot label="Rows" option={${JSON.stringify(option)}} />\n`,
			);
			return size(await Bun.file(packed.output).text());
		}),
	);
	expect((named ?? 0) - (plain ?? 0)).toBeCloseTo(2 * 1.0625, 4);
});

test("a group's leaders end at their own bars, also where another bar's value spans them (#190)", () => {
	const many = Array.from({ length: 14 }, (_, i) => `R${i + 1}`);
	const option = {
		categories: many,
		series: SERIES.map((name, j) => ({
			name,
			type: "bar",
			// The first series is lower, so its value lies across its neighbours' bars.
			data: many.map(() => (j === 0 ? 2 : 5)),
			...(j === 0 && { label: many.map((_, i) => (i === many.length - 1 ? "5,000 units" : "")) }),
		})),
	};
	const svg = draw(option, 356, 288);
	const segments = lines(svg, "leader").map(
		([x1 = 0, x2 = 0, y1 = 0, y2 = 0]): Segment => ({ a: [x1, y1], b: [x2, y2] }),
	);
	const own = bars(svg).filter((b) => b.category === "R14");
	for (const name of SERIES) {
		const box = names(svg).find((t) => t.text === name)?.box;
		expect(box, name).toBeDefined();
		const chain = box ? leaderOf(box, segments) : [];
		// A leader broken around another bar's value continues below it: its last piece ends at the bar.
		const ends = segments.filter((seg) => seg.a[0] === chain[0]?.a[0]).map((seg) => seg.b);
		const last = ends.sort((p, q) => q[1] - p[1])[0];
		const bar = own.find((b) => b.series === name)?.box;
		const valuesOf = name === SERIES[0] ? values(svg) : [];
		expectAtOwnBar(last ? [last] : [], bar, valuesOf, `${name}: its leader ends at its bar`);
	}
});

test("a series with no bar in the named group is named on its own bars and reported, and names stay inside the figure (#190)", () => {
	const sparse = {
		categories: ["x", "y"],
		series: [
			{ name: "Present", type: "bar", data: [2, 8] },
			{ name: "Absent", type: "bar", data: [6] },
		],
	};
	const svg = draw(sparse, 356, 288);
	expect(plotDraw.crowded().names).toEqual(["Absent"]);
	const present = names(svg).find((t) => t.text === "Present")?.box;
	const y = bars(svg).find((b) => b.category === "y")?.box;
	expect((present?.x0 ?? 0) + 4).toBeGreaterThan(y?.x0 ?? 0);
	expect(names(svg).map((t) => t.text)).toContain("Absent");
	const long = {
		categories: ["only"],
		series: [
			{ name: "Levelized electricity production cost", type: "bar", data: [5] },
			{ name: "Other cost", type: "bar", data: [3] },
		],
	};
	const drawn = draw(long, 356, 288);
	for (const t of names(drawn)) {
		expect(t.box.x1, t.text).toBeLessThanOrEqual(356);
	}
	expect(plotDraw.crowded().names).toContain("Levelized electricity production cost");
});

test("stem names keep off the values stems print (#190)", () => {
	const option = {
		series: [
			{ name: "Model A", type: "stem", data: [[0.5, 8]], label: true },
			{ name: "Model B", type: "stem", data: [[0.6, 7.43]], label: true },
		],
	};
	for (const [W, H] of SIZES) {
		const svg = draw(option, W, H);
		for (const t of names(svg)) {
			for (const v of values(svg)) {
				expect(overlap(t.box, v), `${W}: ${t.text} over a value`).toBe(false);
			}
		}
	}
});

test("a horizontal plot's marker label rows are counted at the width its names leave (#190)", () => {
	const option = {
		horizontal: true,
		categories: ["a", "b", "c"],
		series: [
			{ name: "Heat pump", type: "bar", data: [3, 5, 2] },
			{ name: "Gas boiler", type: "bar", data: [4, 1, 6] },
		],
		marks: [{ x: [1, 4], label: "Forecast across the first five years" }],
	};
	for (const [W, H] of SIZES) {
		const svg = draw(option, W, H);
		const rows = new Set(
			[...svg.matchAll(/<text class="mark-label"[^>]* y="([^"]+)"/g)].map((m) => m[1]),
		).size;
		expect(plotDraw.markLines(option, W, H, width), `${W}`).toBe(rows);
	}
});

test("a pick that names no category leaves the names on the bars (#190)", () => {
	const option = {
		categories: ["a"],
		pick: 1,
		series: [
			{ name: "Heat pump", type: "bar", data: [1] },
			{ name: "Gas boiler", type: "bar", data: [2] },
		],
	};
	expect(plotDraw.legendMarkup(option)).toBe("");
	expect(names(draw(option)).map((t) => t.text)).toEqual(["Heat pump", "Gas boiler"]);
});

test("a formatter that needs the browser leaves a named horizontal plot to plot.js rather than failing pack (#190)", async () => {
	const { result, output } = await packMdx(
		dir,
		"bar-names-browser-formatter",
		`import { Plot } from "kit";\nimport { titled } from "./titled.ts";\n\n# Rows\n\n<Plot label="Rows" option={{ horizontal: true, categories: ["a", "b"], series: [{ name: "Heat pump", type: "bar", data: [1, 2], label: titled }, { name: "Gas boiler", type: "bar", data: [2, 1] }], marks: [{ x: [1, 2], label: "Forecast" }] }} />\n`,
		{
			"titled.ts": `"use client";\nexport const titled = (v: number) => document.title + v;\n`,
		},
	);
	expect(result.code, result.stderr).toBe(0);
	expect(await Bun.file(output).text()).not.toContain('class="end"');
});

test("a negative column's leader stops at the column's top, not at its value under it (#190)", () => {
	const option = {
		categories: ["a", "b"],
		series: [
			{ name: "Heat pump", type: "bar", data: [4, -5], label: true },
			{ name: "Gas boiler", type: "bar", data: [3, 6], label: true },
		],
	};
	const svg = draw(option, 527, 416);
	const own = bars(svg).find((b) => b.category === "b" && b.series === "Heat pump")?.box;
	for (const [x1 = 0, x2 = 0, y1 = 0, y2 = 0] of lines(svg, "leader")) {
		expect(own && through(own, [x1, y1], [x2, y2])).toBe(false);
	}
	expect(plotDraw.crowded().names).toEqual([]);
});

test("a named bar series with no values is reported, not dropped silently (#190)", () => {
	draw(
		{
			categories: ["a", "b"],
			series: [
				{ name: "Heat pump", type: "bar", data: [10, 2] },
				{ name: "Gas boiler", type: "bar", data: [] },
			],
		},
		527,
		416,
	);
	expect(plotDraw.crowded().names).toEqual(["Gas boiler"]);
});
