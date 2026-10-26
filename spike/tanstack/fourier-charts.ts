/* Spike ports of examples/fourier-series as TanStack Charts definitions: the coefficient stem plot (a kit Plot today) and the
   hero (an Explore over a kit Chart today). fourier.tsx draws them. */
import { defineChart, dot, lineY, link, ruleY, text } from "@tanstack/charts";
import { crosshair } from "@tanstack/charts/crosshair";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import {
	fixed,
	linspace,
	partial,
	piLabel,
	WAVES,
	type WaveName,
} from "../../examples/fourier-series/fourier.ts";

/* ---- Plot port: the sine coefficients b1..b12 as stems with their values. ---- */

interface Coef {
	n: number;
	b: number;
}

export function coefficientChart(name: WaveName) {
	const wave = WAVES[name];
	const rows: Coef[] = Array.from({ length: 12 }, (_, i) => {
		const n = i + 1;
		return { n, b: name === "saw" || n % 2 === 1 ? wave.coef(n) : 0 };
	});
	const [min, max] = name === "square" ? [0, 1.6] : [-1.4, 2.4];
	return defineChart({
		marks: [
			ruleY([0], { strokeOpacity: 0.6 }),
			link(rows, {
				x1: "n",
				y1: () => 0,
				x2: "n",
				y2: "b",
				stroke: "var(--accent)",
				strokeWidth: 2,
			}),
			dot(rows, { x: "n", y: "b", fill: "var(--accent)", r: 4 }),
			text(rows, {
				x: "n",
				y: "b",
				text: (r) => (r.b === 0 ? "0" : fixed(r.b)),
				dy: (r) => (r.b < 0 ? 14 : -12),
				fontSize: 12,
			}),
		],
		scales: {
			x: {
				scale: scaleLinear().domain([0, 13]),
				axis: { label: "harmonic n", ticks: { values: rows.map((r) => r.n) } },
			},
			y: { scale: scaleLinear().domain([min, max]), grid: true },
		},
		tooltip,
	});
}

/* ---- Chart port: the hero, the target wave and the sum of its first k sines, optionally each sine. ---- */

const PI = Math.PI;
export const PARTS_SHOWN = 8;
const heroGrid = linspace(-2 * PI, 2 * PI, 1400);
/** An x position as a multiple of π, for the tooltip and the crosshair. */
const radians = (x: number) => `${fixed(x / PI)}π`;

interface Sample {
	id?: number;
	series: string;
	x: number;
	y: number;
}

/** The hero chart for a wave, k terms and whether each sine shows: one definition per frame. */
export function heroChart(name: WaveName, k: number, withParts: boolean) {
	const wave = WAVES[name];
	const sumName = `Sum of ${k} ${k === 1 ? "term" : "terms"}`;
	const target: Sample[] = wave.target.map(([x, y], id) => ({ id, series: "Target", x, y }));
	const sum: Sample[] = heroGrid.map((x) => ({ series: sumName, x, y: partial(wave, k, x) }));
	const parts: Sample[] = withParts
		? Array.from({ length: Math.min(k, PARTS_SHOWN) }, (_, j) => {
				const n = wave.harmonic(j + 1);
				return heroGrid.map((x) => ({
					series: `${n}× sine`,
					x,
					y: wave.coef(n) * Math.sin(n * x),
				}));
			}).flat()
		: [];
	return defineChart({
		marks: [
			lineY(target, {
				x: "x",
				y: "y",
				stroke: "var(--muted)",
				strokeDasharray: "6 4",
				strokeWidth: 1.6,
			}),
			...(parts.length
				? [lineY(parts, { x: "x", y: "y", z: "series", strokeWidth: 1.2, strokeOpacity: 0.75 })]
				: []),
			lineY(sum, { x: "x", y: "y", z: "series", stroke: "var(--accent)", strokeWidth: 2.6 }),
			crosshair({ x: { label: { format: radians } }, y: false }),
		],
		scales: {
			x: {
				scale: scaleLinear().domain([-2 * PI, 2 * PI]),
				axis: { ticks: { values: [-2, -1, 0, 1, 2].map((m) => m * PI), format: piLabel } },
			},
			y: {
				scale: scaleLinear().domain([-wave.yLim, wave.yLim]),
				grid: true,
				axis: { ticks: { format: (v: number) => fixed(v, 1) } },
			},
		},
		focus: "group-x",
		tooltip: {
			use: tooltip,
			items: [
				{ channel: "x", text: (p) => radians(p.xValue) },
				{ channel: "y", text: (p) => fixed(p.yValue, 3) },
			],
		},
	});
}
