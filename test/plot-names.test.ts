/* Plot's line names: on their lines at every width, never a legend, and reported by pack where no spot is clear (#190). */
import { afterAll, expect, test } from "bun:test";
import { draw, lines, lines as lines_, plotDraw, texts, width } from "./plot-draw.ts";
import { packMdx, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

test("several named lines with no legend set carry their names at their ends, spread apart and inside the plot", () => {
	const option = {
		series: [
			{
				name: "Rising",
				data: [
					[0, 0],
					[1, 2],
				],
			},
			{
				name: "Also rising",
				data: [
					[0, 1],
					[1, 2],
				],
			},
			{
				name: "Flat",
				data: [
					[0, 1],
					[1, 1],
				],
			},
		],
	};
	const svg = draw(option);
	const ends = texts(svg, "end");
	expect(plotDraw.legendMarkup(option)).toBe("");
	expect(ends.map((t) => t.text).sort()).toEqual(["Also rising", "Flat", "Rising"]);
	const ys = ends.map((t) => t.y).sort((a, b) => a - b);
	expect(ys.slice(1).every((y, i) => y - (ys[i] ?? 0) >= 13)).toBe(true);
	for (const t of ends) {
		expect(t.x + width(t.text)).toBeLessThanOrEqual(600);
	}
	// The author's legend wins, and so does one that is off; a stem among the lines carries its name too (#190, owner 2026-11-20).
	expect(plotDraw.legendMarkup({ ...option, legend: true })).not.toBe("");
	expect(texts(draw({ ...option, legend: true } as never), "end")).toEqual([]);
	expect(texts(draw({ ...option, legend: false } as never), "end")).toEqual([]);
	const mixed = { series: [...option.series, { name: "Peaks", type: "stem", data: [[0.5, 1]] }] };
	expect(plotDraw.legendMarkup(mixed)).toBe("");
	expect(
		texts(draw(mixed), "end")
			.map((t) => t.text)
			.sort(),
	).toEqual(["Also rising", "Flat", "Peaks", "Rising"]);
});

/** Each line's points as drawn, in series order. */
const linePaths = (svg: string) =>
	[...svg.matchAll(/<path class="line"[^>]* d="M([^"]+)"/g)].map((m) =>
		(m[1] ?? "").split("L").map((p) => p.split(",").map(Number) as [number, number]),
	);
/** px from a point to a polyline. */
const distance = ([x, y]: [number, number], line: [number, number][]) =>
	Math.min(
		...line.map(([x1, y1], i) => {
			const [x2, y2] = line[i + 1] ?? [x1, y1];
			const [dx, dy] = [x2 - x1, y2 - y1];
			const t =
				dx || dy
					? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
					: 0;
			return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
		}),
	);
/** The names drawn for each series: its texts of class end, joined, with the box they take. */
function namesDrawn(svg: string, names: string[]) {
	const all = [
		...svg.matchAll(
			/<text class="end" x="([^"]+)" y="([^"]+)"[^>]*text-anchor="(\w+)"[^>]*>([^<]*)</g,
		),
	].map(([, x = "0", y = "0", anchor, text = ""]) => {
		const w = width(text);
		const x0 =
			anchor === "end" ? Number(x) - w : anchor === "middle" ? Number(x) - w / 2 : Number(x);
		return { text, x0, x1: x0 + w, y: Number(y) };
	});
	return names.map((name) => {
		const words = name.split(" ");
		const own = all.filter((t) => t.text.split(" ").every((w) => words.includes(w)));
		return { name, own, text: own.map((t) => t.text).join(" ") };
	});
}

/** A name drawn whole inside the figure, and, unless reported crowded, as its own line's: nearer it than any other, or tied by a leader. */
function expectOwnName(
	{ name, own, text }: ReturnType<typeof namesDrawn>[number],
	i: number,
	svg: string,
	[W, H]: readonly [number, number],
) {
	const size = `${W}x${H}`;
	expect(text, `${size}: ${name}`).toBe(name);
	for (const t of own) {
		expect(t.y, `${size}: ${name}`).toBeGreaterThanOrEqual(0);
		expect(t.y, `${size}: ${name}`).toBeLessThanOrEqual(H);
		expect(t.x0, `${size}: ${name}`).toBeGreaterThanOrEqual(0);
		expect(t.x1, `${size}: ${name}`).toBeLessThanOrEqual(W);
	}
	if (plotDraw.crowded().names.includes(name)) {
		return;
	}
	const paths = linePaths(svg);
	const xs = own.flatMap((t) => [t.x0, t.x1]);
	const ys = own.map((t) => t.y);
	const at: [number, number] = [
		(Math.min(...xs) + Math.max(...xs)) / 2,
		(Math.min(...ys) + Math.max(...ys)) / 2,
	];
	const nearest = paths.map((p) => distance(at, p));
	const end = paths[i]?.at(-1) ?? [0, 0];
	const leader = lines_(svg, "leader").some(
		([x1 = 0, , y1 = 0]) => Math.hypot(x1 - end[0], y1 - end[1]) < 4,
	);
	expect(leader || Math.min(...nearest) === nearest[i], `${size}: ${name}`).toBe(true);
}

test("names stay on their lines at every width, however long or many, and never become a legend (#190)", () => {
	const lines = (names: string[]) => ({
		series: names.map((name, i) => ({
			name,
			data: [
				[0, i],
				[0.5, i + 0.4],
				[1, i + 1],
			],
		})),
	});
	const cases = [
		lines(["Household with a heat pump", "Flat warmed by gas"]),
		lines(["A".repeat(15), "B".repeat(15)]),
		lines(["A".repeat(16), "B"]),
		lines(Array.from({ length: 10 }, (_, i) => `n${i}`)),
	];
	for (const option of cases) {
		expect(plotDraw.legendMarkup(option)).toBe("");
		const names = option.series.map((s) => s.name);
		for (const [W, H] of [
			[1054, 416],
			[527, 416],
			[356, 288],
			[326, 288],
			[600, 160],
		] as const) {
			const svg = draw(option, W, H);
			for (const [i, drawn] of namesDrawn(svg, names).entries()) {
				expectOwnName(drawn, i, svg, [W, H]);
			}
		}
	}
});

test("many names on one end of a short plot stay inside the figure, those with no clear place reported (#190)", () => {
	// Seventeen lines meeting at one end: the stack of names is taller than the plot, so most go beside or along their lines.
	const names = Array.from({ length: 17 }, (_, i) => `n${i}`);
	const option = {
		series: names.map((name, i) => ({
			name,
			data: [
				[0, i],
				[1, 20],
			],
		})),
	};
	for (const size of [
		[1054, 168],
		[356, 168],
	] as const) {
		const svg = draw(option, ...size);
		for (const [i, drawn] of namesDrawn(svg, names).entries()) {
			expectOwnName(drawn, i, svg, size);
		}
	}
});

test("a named line keeps its name when its last value is too long to go with it (#190)", () => {
	const long = "This is a deliberately long point value label in words";
	const option = {
		series: ["House", "Flat"].map((name, i) => ({
			name,
			label: ["", long],
			data: [
				[0, i],
				[10, 4 + 4 * i],
			],
		})),
	};
	for (const size of [
		[1054, 416],
		[326, 288],
	] as const) {
		const svg = draw(option, ...size);
		const drawn = namesDrawn(svg, ["House", "Flat"]);
		for (const [i, name] of drawn.entries()) {
			expectOwnName(name, i, svg, size);
		}
		expect(svg).not.toContain("deliberately");
	}
});

test("a name with no clear place is reported by its series, drawn on its least bad spot (#190)", () => {
	const option = {
		series: ["A".repeat(60), "B"].map((name, i) => ({
			name,
			data: [
				[0, i],
				[1, i + 1],
			],
		})),
	};
	draw(option, 326, 288);
	expect(plotDraw.crowded().names).toEqual(["A".repeat(60)]);
	expect(texts(draw(option, 326, 288), "end").map((t) => t.text)).toContain("A".repeat(60));
});

test("a name with no room at its end finds a clear spot along its line, between the line's points too (#190)", () => {
	// Long names on lines of two points that fan out from one start: on a phone the second name has room only along its line.
	const line = (name: string, from: number, to: number) => ({
		name,
		data: [
			[0, from],
			[10, to],
		],
	});
	const option = {
		series: [
			line("Heat pump with storage", 5, 9.8),
			line("Heat pump without storage", 5, 9.6),
			line("Gas boiler", 5, 1),
		],
		x: { min: 0, max: 10 },
		y: { min: 0, max: 10 },
	};
	draw(option, 356, 288);
	expect(plotDraw.crowded().names).toEqual([]);
});

test("pack warns about a line whose name finds no clear place, naming the series and the width (#190)", async () => {
	const option = JSON.stringify({
		series: ["Donaudampfschifffahrtsgesellschaftskapitänswitwenrente", "B"].map((name, i) => ({
			name,
			data: [
				[0, i],
				[1, i + 1],
			],
		})),
	});
	const { result } = await packMdx(
		dir,
		"crowded-name",
		`import { Plot } from "kit";\n\n# Names\n\n<Plot label="Names" option={${option}} />\n`,
	);
	expect(result.code).toBe(0);
	expect(result.stdout).toContain('"Donaudampfschifffahrtsgesellschaftskapitänswitwenrente"');
	expect(result.stdout).toContain("356 px");
	expect(result.stdout).not.toContain('"B"');
});

test("a name moved off its line's end is tied to it by a leader; one that stays needs none", () => {
	const svg = draw({
		series: [
			{
				name: "Up",
				data: [
					[0, 0],
					[1, 2],
				],
			},
			{
				name: "Also up",
				data: [
					[0, 1],
					[1, 2],
				],
			},
			{
				name: "Down",
				data: [
					[0, 2],
					[1, 0],
				],
			},
		],
	});
	// "Up" and "Also up" end at one point: one of them moves and gets a leader from that point; "Down" keeps its place.
	expect(lines(svg, "leader")).toHaveLength(1);
	const [leader] = lines(svg, "leader");
	const moved = texts(svg, "end").find((t) => Math.abs(t.y - (leader?.[3] ?? 0)) < 0.5);
	expect(moved).toBeDefined();
	expect(leader?.[2]).not.toBe(leader?.[3]);
});

test("a name reads as its own line's against every line shown, unnamed ones too (#190)", () => {
	const option = {
		series: [
			{
				name: "Household with a heat pump",
				data: [
					[0, 9.24],
					[3.33, 5.15],
					[6.67, 1.66],
					[10, 4.06],
				],
			},
			{
				data: [
					[0, 3.64],
					[5, 4.24],
					[10, 3.33],
				],
			},
			{
				name: "Gas boiler",
				data: [
					[0, 6.14],
					[3.33, 2.33],
					[6.67, 9.06],
					[10, 4.58],
				],
			},
		],
		x: { min: 0, max: 10 },
		y: { min: 0, max: 10 },
	};
	const svg = draw(option, 326, 288);
	const [household] = namesDrawn(svg, ["Household with a heat pump"]);
	expectOwnName(household as ReturnType<typeof namesDrawn>[number], 0, svg, [326, 288]);
});
