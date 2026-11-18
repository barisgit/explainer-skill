"use client";
/* The terms figure's frame. Client-side so the slider can reach 200 terms; the x axis counts half-widths π/k, so the bump
   keeps one place and what changes is its height. */
import { fixed, idealLine, LIMIT, overshoot, partial, pct, peak } from "./fourier.ts";

const WINDOW = 3;
const points: [number, number][] = Array.from({ length: 400 }, (_, i) => [
	-WINDOW + (2 * WINDOW * i) / 399,
	0,
]);

export function termsFrame(k: number) {
	const h = peak(k);
	return {
		plot: {
			series: [
				{ name: "Square wave", type: "line", data: idealLine(WINDOW, k), width: 1.5 },
				{
					name: "Sum",
					type: "line",
					data: points.map(([u]): [number, number] => [u, partial(k, (u * Math.PI) / k)]),
					color: "var(--accent)",
					width: 2,
				},
			],
			marks: [{ y: LIMIT, label: `${fixed(LIMIT)}: limit of the peak` }],
			x: { min: -WINDOW, max: WINDOW, step: 1, name: "x, in half-widths π/k from the jump" },
			y: { min: -1.5, max: 1.5, step: 0.5 },
			legend: false,
		},
		readout: `${k} ${k === 1 ? "term" : "terms"}: peak ${fixed(h)}, ${pct(overshoot(h), 2)} of the jump above the plateau`,
	};
}
