/* The reference curve and finite sums must describe the same periodic square wave, even at the explorer's initial k = 1. */
import { expect, test } from "bun:test";
import { termsFrame } from "../examples/fourier-series/terms.ts";

test("the Fourier explorer's reference repeats at every jump within the scaled window", () => {
	const curve = termsFrame(1).plot.series[0]?.data ?? [];
	const probes: [number, number][] = [
		[-2.5, -1],
		[-1.5, 1],
		[-0.5, -1],
		[0.5, 1],
		[1.5, -1],
		[2.5, 1],
	];
	for (const [u, expected] of probes) {
		const before = curve.filter(([x]) => x <= u).at(-1);
		expect(before?.[1]).toBe(expected);
	}
});
