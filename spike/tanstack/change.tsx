"use client";
/* Spike port of examples/electricity-mix's change chart at its starting state (World, 2000 to 2024, TWh): diverging horizontal
   bars, largest growth first, each labelled with its signed change. */
import { barX, defineChart, ruleX, text } from "@tanstack/charts";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { TChart } from "kit";
import { dT, SOURCES, twh, WORLD, Y0, Y1 } from "../../examples/electricity-mix/model.ts";

interface Change {
	name: string;
	color: string;
	v: number;
}

const rows: Change[] = SOURCES.map((s) => ({
	name: s.name,
	color: s.color,
	v: (twh(WORLD, s, Y1) ?? 0) - (twh(WORLD, s, Y0) ?? 0),
})).sort((a, b) => b.v - a.v);
const [lo, hi] = [Math.min(0, ...rows.map((r) => r.v)), Math.max(0, ...rows.map((r) => r.v))];
const pad = (hi - lo) * 0.3;

const changeChart = defineChart({
	marks: [
		barX(rows, { x: "v", y: "name", fill: (r) => r.color, inset: 4 }),
		ruleX([0], { strokeOpacity: 0.7 }),
		text(rows, {
			x: "v",
			y: "name",
			text: (r) => dT(r.v),
			anchor: (r) => (r.v < 0 ? "end" : "start"),
			dx: (r) => (r.v < 0 ? -6 : 6),
		}),
	],
	scales: {
		x: { scale: scaleLinear().domain([lo - pad, hi + pad]), axis: false },
		y: { scale: () => scaleBand<string>().padding(0.2) },
	},
	tooltip,
});

/** The change chart, World, TWh. */
export function ChangeT() {
	return (
		<figure class="fig" id="fig-change">
			<TChart
				id="change"
				label={`Change in world generation by source, ${Y0} to ${Y1}, TWh`}
				definition={changeChart}
			/>
		</figure>
	);
}
