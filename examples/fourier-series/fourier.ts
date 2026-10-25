/* The page's numbers: the two waves built from sines, their partial sums, and the symmetry signals. No markup here. */

const PI = Math.PI;
export const MINUS = "−";

/** A wave with only sine terms, as the figures build it. */
export interface Wave {
	name: string;
	/** Frequency (a multiple of the base) of the k-th nonzero term. */
	harmonic: (k: number) => number;
	/** The sine amplitude b_n at frequency n. */
	coef: (n: number) => number;
	/** The value the signal reaches just before its jump, and the jump's height. */
	top: number;
	jump: number;
	/** x of a jump, and on which side of it the bump sits (+1 right, −1 left). */
	jumpAt: number;
	side: number;
	/** Distance of the highest point of the k-term sum from the jump (the known analytic maximum). */
	bumpAt: (k: number) => number;
	/** The chart's vertical range and tick step. */
	yLim: number;
	yStep: number;
	/** The signal itself over two periods, as a polyline with vertical jumps. */
	target: [number, number][];
}

export type WaveName = "square" | "saw";

export const WAVES: Record<WaveName, Wave> = {
	square: {
		name: "Square wave",
		harmonic: (k) => 2 * k - 1,
		coef: (n) => 4 / (PI * n),
		top: 1,
		jump: 2,
		jumpAt: 0,
		side: 1,
		bumpAt: (k) => PI / (2 * k),
		yLim: 1.5,
		yStep: 0.5,
		target: [
			[-2 * PI, 1],
			[-PI, 1],
			[-PI, -1],
			[0, -1],
			[0, 1],
			[PI, 1],
			[PI, -1],
			[2 * PI, -1],
		],
	},
	saw: {
		name: "Sawtooth",
		harmonic: (k) => k,
		coef: (n) => (2 * (n % 2 ? 1 : -1)) / n,
		top: PI,
		jump: 2 * PI,
		jumpAt: PI,
		side: -1,
		bumpAt: (k) => PI / (k + 1),
		yLim: 4,
		yStep: 2,
		target: [
			[-2 * PI, 0],
			[-PI, PI],
			[-PI, -PI],
			[PI, PI],
			[PI, -PI],
			[2 * PI, 0],
		],
	},
};

/** The sum of the wave's first k nonzero terms at x. */
export function partial(wave: Wave, k: number, x: number): number {
	let s = 0;
	for (let j = 1; j <= k; j++) {
		const n = wave.harmonic(j);
		s += wave.coef(n) * Math.sin(n * x);
	}
	return s;
}

/** Highest value of the k-term sum next to the wave's jump, evaluated at the analytic maximum. */
export const peak = (wave: Wave, k: number) =>
	partial(wave, k, wave.jumpAt + wave.side * wave.bumpAt(k));

/** The peak of a ±1 square wave's partial sum as the terms grow: (2/π) Si(π). */
export const LIMIT = (2 / PI) * 1.851937051982466;

export const linspace = (a: number, b: number, n: number) =>
	Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));

/** An axis label at a whole multiple of π: −2π, −π, 0, π, 2π. */
export function piLabel(x: number): string {
	const m = Math.round(x / PI);
	if (m === 0) {
		return "0";
	}
	return `${m < 0 ? MINUS : ""}${Math.abs(m) === 1 ? "" : Math.abs(m)}π`;
}

/** x with d decimals and a true minus sign. */
export const fixed = (x: number, d = 2) => x.toFixed(d).replace("-", MINUS);
export const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** The three signals of the symmetry figure, on one period (−π, π). */
export const SYMS = {
	even: { name: "The triangle |x|", fn: (x: number) => Math.abs(x) },
	odd: { name: "The square wave", fn: (x: number) => Math.sign(x) },
	none: { name: "The half ramp", fn: (x: number) => Math.max(0, x) },
};

export type SymName = keyof typeof SYMS;

/** Midpoints of 1000 equal slices of (−π, π), for the integrals and the plotted lines. */
export const symGrid = Array.from({ length: 1000 }, (_, i) => -PI + ((i + 0.5) * 2 * PI) / 1000);

/** Fourier coefficient by the midpoint rule, rounded to 0 below 1e-9: kind is Math.cos or Math.sin. */
export function coefficient(fn: (x: number) => number, kind: (x: number) => number, n: number) {
	const c = symGrid.reduce((s, x) => s + fn(x) * kind(n * x), 0) * (2 / 1000);
	return Math.abs(c) < 1e-9 ? 0 : c;
}

/** The names of the nonzero coefficients, with subscript digits: "a₀, a₂, a₄", shortened after six. */
export function survivors(name: string, list: [number, number][]): string {
	const kept = list
		.filter(([, y]) => y !== 0)
		.map(([n]) => `${name}${String.fromCodePoint(0x2080 + n)}`);
	if (kept.length === 0) {
		return "none";
	}
	return kept.length > 6 ? `${kept.slice(0, 5).join(", ")}, …` : kept.join(", ");
}
