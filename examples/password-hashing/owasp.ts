/* What the page takes from the OWASP Password Storage Cheat Sheet (CC BY-SA 4.0), fetched 2026-10-22: the settings of each
   algorithm and its summary, plus the chart of them each algorithm's view shows. Memory is in MiB unless a name says KiB. */

/** One Argon2id line: memory, passes (t) and the memory in KiB as the cheat sheet writes it; `lead` is its summary line. */
export interface ArgonSetting {
	mib: number;
	t: number;
	kib: number;
	lead: boolean;
}

/** One scrypt line: N = 2^logN, parallelism p (r is always 8) and the memory it needs; `lead` is the summary line. */
export interface ScryptSetting {
	logN: number;
	p: number;
	mib: number;
	lead: boolean;
}

/** All five Argon2id lines give equal defence per OWASP; they trade memory against passes. */
export const ARGON: ArgonSetting[] = [
	{ mib: 46, t: 1, kib: 47104, lead: false },
	{ mib: 19, t: 2, kib: 19456, lead: true },
	{ mib: 12, t: 3, kib: 12288, lead: false },
	{ mib: 9, t: 4, kib: 9216, lead: false },
	{ mib: 7, t: 5, kib: 7168, lead: false },
];

/** The five scrypt lines give a similar minimal defence; they trade memory against parallelism. */
export const SCRYPT: ScryptSetting[] = [
	{ logN: 17, p: 1, mib: 128, lead: true },
	{ logN: 16, p: 2, mib: 64, lead: false },
	{ logN: 15, p: 3, mib: 32, lead: false },
	{ logN: 14, p: 5, mib: 16, lead: false },
	{ logN: 13, p: 10, mib: 8, lead: false },
];

/** PBKDF2's iteration counts per inner hash. */
export const PBKDF2 = [
	{ hash: "HMAC-SHA256", iterations: 600_000, note: "recommended" },
	{ hash: "HMAC-SHA512", iterations: 220_000, note: "" },
	{ hash: "HMAC-SHA1", iterations: 1_400_000, note: "legacy only" },
];

export const argonLabel = (s: ArgonSetting) => `m=${s.mib} MiB, t=${s.t}, p=1`;
export const scryptLabel = (s: ScryptSetting) => `N=2^${s.logN}, r=8, p=${s.p}`;
const count = (n: number) => n.toLocaleString("en-US");

const FIPS_UNKNOWN = "Unknown: the cheat sheet does not say";

/** One line of an algorithm's settings table. */
export interface Setting {
	setting: string;
	memory: string;
	tradeOff: string;
}

/** What the overview's comparison table and each algorithm's view say about it. */
export interface Algo {
	name: string;
	/** The row's mark in the comparison table: the first choice, the open ones, and legacy only. */
	state: "fit" | "maybe" | "out";
	role: string;
	minimum: string;
	memory: string;
	fips: string;
	watch: string;
	/** Every OWASP setting: its parameters, nominal memory, and what it trades. */
	settings: Setting[];
}

export const ALGOS = {
	argon2id: {
		name: "Argon2id",
		state: "fit",
		role: "First choice",
		minimum: "m=19 MiB, t=2, p=1",
		memory: "7 to 46 MiB",
		fips: FIPS_UNKNOWN,
		watch: "Memory-hard, so it needs memory per login; use the Argon2id variant",
		settings: ARGON.map((s) => ({
			setting: `m=${s.kib} KiB, t=${s.t}, p=1`,
			memory: `${s.mib} MiB`,
			tradeOff: `${s.t} pass${s.t > 1 ? "es" : ""}`,
		})),
	},
	scrypt: {
		name: "scrypt",
		state: "maybe",
		role: "If Argon2id is not available",
		minimum: "N=2^17, r=8, p=1",
		memory: "8 to 128 MiB",
		fips: FIPS_UNKNOWN,
		watch: "Memory-hard; its listed settings trade parallelism against memory",
		settings: SCRYPT.map((s) => ({
			setting: scryptLabel(s),
			memory: `${s.mib} MiB`,
			tradeOff: `p=${s.p}`,
		})),
	},
	bcrypt: {
		name: "bcrypt",
		state: "out",
		role: "Legacy systems only",
		minimum: "Work factor 10",
		memory: "No memory-cost parameter",
		fips: FIPS_UNKNOWN,
		watch: "72-byte input limit; pre-hashing is risky",
		settings: [],
	},
	pbkdf2: {
		name: "PBKDF2",
		state: "maybe",
		role: "When FIPS-140 is required",
		minimum: "HMAC-SHA256, 600,000 iterations",
		memory: "No memory-cost parameter",
		fips: "Validated implementations exist; check that your module's certificate covers it",
		watch: "Long passwords can be slow in some implementations",
		settings: PBKDF2.map((s) => ({
			setting: `PBKDF2-${s.hash}`,
			memory: "No memory-cost parameter",
			tradeOff: `${count(s.iterations)} iterations${s.note ? ` (${s.note})` : ""}`,
		})),
	},
} satisfies Record<string, Algo>;

export type AlgoId = keyof typeof ALGOS;

/** The algorithms as rows of the overview's comparison, each with the id of its view. */
export const ALGO_ROWS = Object.entries(ALGOS).map(([id, a]) => ({ id, ...a }));

/**
 * The chart of an algorithm's settings, as JSON so the page can hand it straight to a Chart: memory against passes or
 * parallelism, each point labelled with its memory. Labels sit right of the steep part of the curve, below the next point and
 * above the last, so none sits on the line.
 */
export function settingsChart(id: "argon2id" | "scrypt"): ChartOption {
	const [points, quantity] =
		id === "argon2id"
			? [ARGON.map((s) => [s.mib, s.t]), "passes"]
			: [SCRYPT.map((s) => [s.mib, s.p]), "parallelism"];
	return {
		grid: { top: 40, left: 8, right: 32, bottom: 36 },
		tooltip: { trigger: "item" },
		xAxis: { type: "value", name: "Memory (MiB)", nameLocation: "middle", nameGap: 26, min: 0 },
		yAxis: { type: "value", min: 0 }, // named in the caption: a name at the canvas edge clips or collides with point labels
		series: [
			{
				type: "line",
				symbolSize: 14,
				data: points.map(([mib = 0, y = 0]) => ({
					value: [mib, y],
					label: {
						show: true,
						position: y >= 3 ? "right" : y === 2 ? "bottom" : "top",
						formatter: `${mib} MiB`,
					},
					tooltip: { formatter: `${mib} MiB, ${quantity} ${y}` },
				})),
			},
		],
	};
}

/** PBKDF2's iterations per inner hash as bars; legacy-only ones are grey. */
export function iterationsChart(): ChartOption {
	return {
		grid: { top: 16, left: 8, right: 96, bottom: 8 },
		xAxis: { type: "value", min: 0, axisLabel: { formatter: "{value}k", hideOverlap: true } },
		yAxis: {
			type: "category",
			inverse: true,
			data: PBKDF2.map((s) => s.hash + (s.note === "legacy only" ? " (legacy)" : "")),
		},
		series: [
			{
				type: "bar",
				barWidth: "50%",
				data: PBKDF2.map((s) => ({
					value: s.iterations / 1000,
					label: { show: true, position: "right", formatter: count(s.iterations) },
					itemStyle: { color: s.note === "legacy only" ? "var(--rule-strong)" : "var(--accent)" },
				})),
			},
		],
	};
}
