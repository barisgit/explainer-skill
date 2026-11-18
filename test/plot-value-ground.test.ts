/* Values printed inside an open bar must mask the pattern beneath the whole word, not only its glyph strokes. */
import { expect, test } from "bun:test";
import { draw, rects, texts, width } from "./plot-draw.ts";

for (const horizontal of [false, true]) {
	for (const stack of [false, true]) {
		test(`inside hatch and hollow values have a plate (${horizontal ? "rows" : "columns"}, ${stack ? "stacked" : "cut"})`, () => {
			for (const fill of ["hatch", "hollow"]) {
				const value = stack ? "367" : "367 years";
				const svg = draw({
					horizontal,
					stack,
					categories: ["A"],
					series: [{ type: "bar", data: [367], fill, label: stack ? true : { unit: "years" } }],
					[horizontal ? "x" : "y"]: { min: 0, max: stack ? 400 : 80 },
				});
				const [plate] = rects(svg, "value-ground");
				expect(plate).toBeDefined();
				const [x = 0, y = 0, w = 0, h = 0] = plate ?? [];
				const [text] = texts(svg, "value");
				expect(text?.text?.replace(/\s/g, " ")).toBe(value);
				expect(w).toBeGreaterThan(width(value));
				expect(h).toBeGreaterThan(13);
				expect(text?.x).toBeGreaterThan(x);
				expect(text?.y).toBeGreaterThan(y);
			}
		});
	}
}

test("solid bars and values outside open bars need no plate", () => {
	for (const fill of ["accent", "hatch", "hollow"]) {
		const svg = draw({
			horizontal: true,
			categories: ["A"],
			series: [{ type: "bar", data: [10], fill, label: true }],
			x: { min: 0, max: 100 },
		});
		expect(rects(svg, "value-ground")).toEqual([]);
	}
});
