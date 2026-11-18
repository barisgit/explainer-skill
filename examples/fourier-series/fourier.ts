/* The page's one model: the ±1 square wave built from its first k odd sines. Every number on the page comes from here. */

const PI = Math.PI;

/** Terms in the opening figure and the headline. */
export const THOUSAND = 1000;

/** Sine amplitude b_n of the square wave: 4/(nπ) for odd n. */
export const coef = (n: number) => 4 / (PI * n);

/** The sum of the first k terms (n = 1, 3, …, 2k − 1) at x. */
export function partial(k: number, x: number): number {
	let s = 0;
	for (let j = 1; j <= k; j++) {
		const n = 2 * j - 1;
		s += coef(n) * Math.sin(n * x);
	}
	return s;
}

/** Where the k-term sum first peaks: the first zero of its slope, (2/π)·sin(2kx)/sin x. */
export const peakAt = (k: number) => PI / (2 * k);

/** The k-term sum's highest value beside the jump. */
export const peak = (k: number) => partial(k, peakAt(k));

/** Si(π), the integral of sin t / t from 0 to π, by Simpson's rule. */
function siPi(): number {
	const n = 2000;
	const f = (t: number) => (t === 0 ? 1 : Math.sin(t) / t);
	let s = f(0) + f(PI);
	for (let i = 1; i < n; i++) {
		s += f((PI * i) / n) * (i % 2 ? 4 : 2);
	}
	return (s * PI) / (3 * n);
}

/** What the peak tends to as k grows: (2/π)·Si(π). */
export const LIMIT = (2 / PI) * siPi();

/** The jump is from −1 to +1. */
export const JUMP = 2;

/** The overshoot above the plateau at 1, as a share of the jump. */
export const overshoot = (height: number) => (height - 1) / JUMP;

export const fixed = (x: number, d = 3) => x.toFixed(d).replace("-", "−");
export const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;

const linspace = (a: number, b: number, n: number) =>
	Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));

/** The k-term sum over x in [a, b] as plot points. */
export const sumLine = (k: number, a: number, b: number, n = 500): [number, number][] =>
	linspace(a, b, n).map((x) => [x, partial(k, x)]);

/** The periodic square wave over [-w, w], with a jump every `halfPeriod` axis units (π in radians). */
export function idealLine(w: number, halfPeriod = PI): [number, number][] {
	const first = Math.floor(-w / halfPeriod);
	let value = first % 2 === 0 ? 1 : -1;
	const points: [number, number][] = [[-w, value]];
	for (let n = first + 1; n * halfPeriod < w; n++) {
		const x = n * halfPeriod;
		points.push([x, value], [x, -value]);
		value = -value;
	}
	return [...points, [w, value]];
}

/** The first n sine amplitudes as stems (zero for even harmonics), each labelled with its value. */
export function stems(n: number) {
	const data = Array.from({ length: n }, (_, i): [number, number] => [
		i + 1,
		(i + 1) % 2 ? coef(i + 1) : 0,
	]);
	return { data, label: data.map(([, y]) => (y ? fixed(y, 2) : "")) };
}
