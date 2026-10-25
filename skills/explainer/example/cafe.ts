/* The café model: long-run queueing formulas for a café whose orders take 2 minutes on average. page.mdx computes its
   numbers, the slider's frames and the fix views from it when it packs, so no code of its own ships in the page. */

/** Average minutes per order. */
const S = 2;

export interface Fix {
	id: string;
	name: string;
	/** What the fix means in practice, and what the model leaves out. */
	note: string;
	servers: number;
	speed: number;
	steady: boolean;
	drop: number;
}

const fix = (id: string, name: string, note: string, change: Partial<Fix> = {}): Fix => ({
	id,
	name,
	note,
	servers: 1,
	speed: 1,
	steady: false,
	drop: 0,
	...change,
});

const NONE = fix("none", "Change nothing", "The baseline every fix is compared with.");
const STEADY = fix(
	"steady",
	"Every order exactly 2 min",
	"Same average order, no long ones: a fixed menu and prepared batches. Random arrivals still clump.",
	{ steady: true },
);
const SECOND = fix(
	"second",
	"Second barista",
	"Two people taking orders from one line. They share one espresso machine, so expect less than the formula promises.",
	{ servers: 2 },
);
const FIXES = [
	NONE,
	fix(
		"faster",
		"Orders 10% quicker",
		"A faster grinder or card-only payment: every order takes 10% less time.",
		{ speed: 0.9 },
	),
	STEADY,
	fix(
		"fewer",
		"10% fewer customers",
		"Pre-orders picked up at a side counter take one customer in ten out of the line.",
		{ drop: 0.1 },
	),
	SECOND,
];

/** Minutes as the page writes them: seconds under one minute. */
export const fmt = (min: number) =>
	min < 1 ? `${Math.round(min * 60)} s` : `${min.toFixed(1)} min`;

/** Share of time each barista is busy, with a fix applied to a café whose one barista would be `load` busy. */
const busy = (f: Fix, load: number) => (load * (1 - f.drop) * f.speed) / f.servers;

/** Long-run average wait in minutes: M/M/1, half of it for M/D/1, M/M/2 through Erlang C (the formula sheet). */
function wait(f: Fix, load: number): number {
	const rho = busy(f, load);
	const s = S * f.speed;
	if (f.servers === 2) {
		return ((2 * rho * rho) / (1 + rho)) * (s / (2 * (1 - rho)));
	}
	return (rho / (1 - rho)) * s * (f.steady ? 0.5 : 1);
}

/** Loads the curves are drawn over, in % busy. */
const LOADS = Array.from({ length: 46 }, (_, i) => 50 + i);

/** Each fix at 90% busy, in the order the page lists them, and the highest load it keeps the wait under 10 minutes at. */
export const fixes = FIXES.map((f) => ({
	...f,
	busy: busy(f, 0.9),
	wait: wait(f, 0.9),
	saved: 1 - wait(f, 0.9) / wait(NONE, 0.9),
	upTo: LOADS.filter((l) => wait(f, l / 100) <= 10).at(-1),
}));

/** The wait at every load from 50% to 95% busy, as plot points [busy %, minutes]. */
export const curve = (f: Fix): [number, number][] => LOADS.map((l) => [l, wait(f, l / 100)]);
export const baseline = curve(NONE);

/** Explore's frame for the load slider: the three curves, the reader's load marked on the first, and the waits it gives. */
export function loadFrame(load: number): { plot: PlotOption; stats: Record<string, string> } {
	const one = wait(NONE, load / 100);
	return {
		plot: {
			series: [
				{ name: "One barista", data: curve(NONE) },
				{ type: "stem", data: [[load, one]], label: [fmt(one)], color: "var(--accent)" },
				{ name: "Orders all 2 min", data: curve(STEADY) },
				{ name: "Two baristas", data: curve(SECOND) },
			],
			x: { min: 50, max: 95, format: { unit: "%" } },
			y: { min: 0, max: 40, format: { unit: "min" } },
		},
		stats: {
			"One barista": fmt(one),
			"Versus 50% busy": `${(one / wait(NONE, 0.5)).toFixed(0)}×`,
			"Two baristas": fmt(wait(SECOND, load / 100)),
		},
	};
}
