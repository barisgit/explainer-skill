/* A Plot axis's own tick texts: where they stand along it, the same at every width. */
import { expect, test } from "bun:test";
import { draw } from "./plot-draw.ts";

/** The tick labels of a drawing: texts without a class. */
const ticks = (svg: string) =>
	[...svg.matchAll(/<text x="[^"]+" y="[^"]+"[^>]*>([^<]*)</g)].map((m) => m[1]);

const CLOCK = ["06:00", "12:00", "18:00", "00:00", "06:00"];
const day = {
	series: [
		{
			type: "line",
			data: [
				[6, 1],
				[30, 2],
			],
		},
	],
};

test("an axis's labels may be its own texts, spread evenly from its min to its max", () => {
	const svg = draw({ ...day, x: { min: 6, max: 30, labels: CLOCK } }, 600, 300);
	expect(ticks(svg).filter((t) => t?.includes(":"))).toEqual(CLOCK);
});

test("an axis's own texts mean the same values at every width a copy or the live plot draws at", () => {
	const option = { ...day, x: { labels: CLOCK } };
	// pack's copies (356, 527, 1054 px) and live widths inside each copy's display interval.
	for (const W of [300, 356, 420, 460, 527, 700, 760, 1054, 1290]) {
		const svg = draw(option, W, 300);
		const path = svg.match(/<path class="line"[^>]* d="M([\d.]+),[\d.]+L([\d.]+),/);
		const at = [...svg.matchAll(/<text x="([\d.]+)"[^>]*>(\d\d:00)</g)].map((m) => Number(m[1]));
		// The first text stands at the line's start, value 6, and the last at its end, value 30.
		expect([at[0], at.at(-1)]).toEqual([Number(path?.[1]), Number(path?.[2])]);
	}
});
