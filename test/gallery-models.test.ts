import { expect, test } from "bun:test";
import { termsFrame } from "../examples/fourier-series/terms.ts";
import { stripFrame } from "../examples/i2c-pull-ups/bus.ts";

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

test("the I²C readout treats 3 mA as a guaranteed minimum capability, not a pin rating", () => {
	for (const r of ["680", "2200"]) {
		const text = stripFrame(r).readout;
		expect(text).toContain("guaranteed minimum sink of 3 mA");
		expect(text).toContain("0.4 V");
		expect(text).not.toContain("rated for");
	}
});
