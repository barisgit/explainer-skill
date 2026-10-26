"use client";
/* Spike ports of examples/fourier-series drawn with kit TChart: the coefficient stems and the hero Explore frame. */
import { TChart } from "kit";
import {
	fixed,
	MINUS,
	pct,
	peak,
	WAVES,
	type WaveName,
} from "../../examples/fourier-series/fourier.ts";
import { coefficientChart, heroChart, PARTS_SHOWN } from "./fourier-charts.ts";

/** The coefficient figure, square or sawtooth. */
export function Coefficients(props: { wave: WaveName; id: string }) {
	return (
		<TChart
			id={props.id}
			label={`The sine coefficients b-n of the ${WAVES[props.wave].name.toLowerCase()} for n from 1 to 12`}
			definition={coefficientChart(props.wave)}
		/>
	);
}

/** The Explore frame: the same stats and caption as examples/fourier-series's hero, with the TanStack chart. */
export function hero(name: WaveName, k: number, withParts: boolean) {
	const wave = WAVES[name];
	const best = peak(wave, k);
	const above = (best - wave.top) / wave.jump;
	const partsNote = withParts
		? `Thin lines: the first ${Math.min(k, PARTS_SHOWN)} sines of the sum, each at its own amplitude. `
		: "";
	return {
		tchart: heroChart(name, k, withParts),
		stats: {
			"Highest frequency used": (
				<>
					{wave.harmonic(k)}× <small>base frequency</small>
				</>
			),
			"Highest point of the sum": (
				<>
					{fixed(best, 3)} <small>target {fixed(wave.top, name === "saw" ? 2 : 0)}</small>
				</>
			),
			"Highest point vs target, share of the jump": `${above < 0 ? MINUS : "+"}${pct(Math.abs(above))}`,
		},
		caption: `Dashed: the ${wave.name.toLowerCase()} to build. Solid: the sum. ${partsNote}Horizontal axis in radians, one period is 2π.`,
	};
}
