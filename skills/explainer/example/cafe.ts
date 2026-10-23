/* The café model: data, the long-run formulas and the simulated week. Imported by page.mdx, which computes its tables and views
   from it when it packs, and by figures.tsx, which redraws from it in the browser. */

/** Average minutes per order. */
export const S = 2;
/** Minutes in a day, 07:00 to 15:00. */
export const DAY = 480;
/** Fixed seeds: the same week on every load. */
export const WEEK: [day: string, seed: number][] = [
	["Mon", 22],
	["Tue", 13],
	["Wed", 7],
	["Thu", 28],
	["Fri", 24],
];

export interface Fix {
	id: string;
	name: string;
	servers: number;
	speed: number;
	steady: boolean;
	drop: number;
}

const fix = (id: string, name: string, change: Partial<Fix> = {}): Fix => ({
	id,
	name,
	servers: 1,
	speed: 1,
	steady: false,
	drop: 0,
	...change,
});

/** The fixes in the order the page lists them; the first is the baseline every other is compared with. */
export const FIXES = [
	fix("none", "Change nothing"),
	fix("faster", "Orders 10% quicker", { speed: 0.9 }),
	fix("steady", "Every order exactly 2 min", { steady: true }),
	fix("fewer", "10% fewer customers", { drop: 0.1 }),
	fix("second", "Second barista", { servers: 2 }),
] as const;
export const [NONE, , STEADY, , SECOND] = FIXES;

export const fmt = (min: number) =>
	min < 1 ? `${Math.round(min * 60)} s` : `${min.toFixed(1)} min`;
export const clock = (m: number) =>
	`${String(7 + Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m) % 60).padStart(2, "0")}`;
export const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Per-barista utilisation with a fix applied to a café whose single barista would be `load` busy. */
export const busy = (f: Fix, load: number) => (load * (1 - f.drop) * f.speed) / f.servers;

/** Long-run average wait in minutes (M/M/1, M/D/1 halves it, M/M/2 via Erlang C). */
export function wait(f: Fix, load: number): number {
	const rho = busy(f, load);
	const s = S * f.speed;
	if (f.servers === 2) {
		return ((2 * rho * rho) / (1 + rho)) * (s / (2 * (1 - rho)));
	}
	return (rho / (1 - rho)) * s * (f.steady ? 0.5 : 1);
}

function rng(seed: number) {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export interface Day {
	/** People in line at each minute. */
	line: number[];
	waits: number[];
	avg: number;
	peak: number;
	peakAt: number;
}

/** One simulated day. Every customer draws the same three numbers whatever the fix, so fixes compare like for like. */
export function simulate(seed: number, load: number, f: Fix = NONE): Day {
	const r = rng(seed);
	const exp = () => -Math.log(1 - r());
	const rate = load / S;
	const free: number[] = Array(f.servers).fill(0);
	const people: { t: number; start: number }[] = [];
	for (let t = exp() / rate; t < DAY; t += exp() / rate) {
		const order = exp() * S;
		if (r() < f.drop) {
			continue;
		}
		const i = free.indexOf(Math.min(...free));
		const start = Math.max(t, free[i] ?? 0);
		free[i] = start + (f.steady ? S : order) * f.speed;
		people.push({ t, start });
	}
	const line = Array.from(
		{ length: DAY + 1 },
		(_, m) => people.filter((p) => p.t <= m && p.start > m).length,
	);
	const waits = people.map((p) => p.start - p.t);
	const peak = Math.max(...line);
	return { line, waits, avg: mean(waits), peak, peakAt: line.indexOf(peak) };
}

/** The simulated week at `load` busy, with a fix applied. */
export const simulateWeek = (load: number, f: Fix = NONE) =>
	WEEK.map(([, seed]) => simulate(seed, load, f));

/** Each fix at 90% busy, with its utilisation and long-run wait, in the order of FIXES. */
export const fixList = FIXES.map((f) => ({ ...f, wait: wait(f, 0.9), busy: busy(f, 0.9) }));

/** The simulated week at 90% busy before and after a fix: average wait, longest line, customers who waited 10 minutes or more. */
export function replay(f: Fix) {
	return [NONE, f].map((g) => {
		const days = simulateWeek(0.9, g);
		const waits = days.flatMap((d) => d.waits);
		return {
			avg: mean(waits),
			peak: Math.max(...days.map((d) => d.peak)),
			long: waits.filter((w) => w >= 10).length,
		};
	});
}
