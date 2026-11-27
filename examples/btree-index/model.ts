"use client";

/* Sizes for a B-tree index of an 8 KB-page database; page.mdx computes its figures from these when it packs. */

export const ROWS_PER_PAGE = 200;
export const TABLE_ROWS = 1_000_000;
export const TABLE_PAGES = TABLE_ROWS / ROWS_PER_PAGE;

const fmt = (n: number): string => Math.round(n).toLocaleString("en-US");

/** Pages at each level, root first, for `10^exp` rows and `fanout` entries per page. */
export function levels(exp: number, fanout: number): number[] {
	const out = [Math.ceil(10 ** exp / fanout)];
	while ((out[0] ?? 1) > 1) {
		out.unshift(Math.ceil((out[0] ?? 1) / fanout));
	}
	return out;
}

const NAMES = ["Root", "Branch", "Branch", "Branch", "Branch"];

/** Explore frame: the pages on each level of the tree, and what a lookup costs. */
export function depthFrame(
	exp: number,
	fanout: string,
): { plot: PlotOption; stats: Record<string, string> } {
	const f = Number(fanout);
	const l = levels(exp, f);
	const names = l.map((_, i) => (i === l.length - 1 ? "Leaf" : (NAMES[i] ?? "Branch")));
	const labelled = names.map((n, i) => (n === "Branch" && l.length > 3 ? `Branch ${i}` : n));
	return {
		plot: {
			categories: labelled,
			horizontal: true,
			series: [
				{
					name: "Pages",
					type: "bar",
					data: l,
					fill: l.map((_, i) => (i === l.length - 1 ? "" : "accent")),
					label: { digits: 0 },
				},
			],
			x: { format: { digits: 0 } },
		},
		stats: {
			Rows: fmt(10 ** exp),
			"Pages per lookup": String(l.length),
			"Pages in a full scan of the leaves": fmt(l[l.length - 1] ?? 1),
		},
	};
}

/** Explore frame: pages read for a range of `n` matching rows. */
export function rangeFrame(n: number): { plot: PlotOption } {
	const index = 3 + Math.ceil(n / ROWS_PER_PAGE);
	return {
		plot: {
			categories: [
				"Index range scan",
				"Index, then each row from the table",
				"Read the whole table",
			],
			horizontal: true,
			series: [
				{
					name: "Pages read",
					type: "bar",
					data: [index, 3 + Math.ceil(n / ROWS_PER_PAGE) + n, TABLE_PAGES],
					fill: ["accent", "", ""],
					label: { digits: 0 },
				},
			],
			x: { format: { digits: 0 } },
		},
	};
}
