// Downloads day-ahead prices (DE-LU) and public net generation and load (Germany) from the Energy-Charts API
// (Fraunhofer ISE, CC BY 4.0), keeps the raw files in a temp directory, and writes the numbers the page imports:
//   bun fetch.ts            writes data.json next to this file
// Set RAW=/some/dir to keep the downloads there (reused when present); default is the system temp directory.
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const API = "https://api.energy-charts.info";
const { RAW: keep } = process.env;
const RAW = keep ?? join(tmpdir(), "energy-charts-de");
mkdirSync(RAW, { recursive: true });

type Price = { unix_seconds: number[]; price: (number | null)[] };
type Power = {
	unix_seconds: number[];
	production_types: { name: string; data: (number | null)[] }[];
};

async function get<T>(file: string, path: string): Promise<T> {
	const at = join(RAW, file);
	if (!existsSync(at)) {
		let res = await fetch(`${API}/${path}`);
		for (let wait = 10; res.status === 429 && wait <= 80; wait *= 2) {
			await Bun.sleep(wait * 1000); // the API rate-limits bursts
			res = await fetch(`${API}/${path}`);
		}
		if (!res.ok) {
			throw new Error(`${path}: ${res.status}`);
		}
		await Bun.write(at, await res.text());
	}
	return Bun.file(at).json();
}

/** Mean per clock hour of the values that exist (15-minute values become hourly). */
function hourly(t: number[], v: (number | null)[]) {
	const sums = new Map<number, number[]>();
	t.forEach((s, i) => {
		const x = v[i];
		if (x === null || x === undefined) {
			return;
		}
		const h = Math.floor(s / 3600) * 3600;
		sums.set(h, [...(sums.get(h) ?? []), x]);
	});
	return new Map([...sums].map(([h, a]) => [h, a.reduce((p, c) => p + c, 0) / a.length]));
}

const r1 = (x: number) => Number(x.toFixed(1));
const PARTS = new Intl.DateTimeFormat("en-GB", {
	timeZone: "Europe/Berlin",
	hourCycle: "h23",
	year: "numeric",
	month: "numeric",
	day: "numeric",
	hour: "numeric",
	weekday: "short",
});
function local(t: number) {
	const parts = PARTS.formatToParts(t * 1000);
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((x) => x.type === type)?.value ?? "";
	return {
		year: Number(part("year")),
		month: Number(part("month")),
		day: Number(part("day")),
		hour: Number(part("hour")),
		wd: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(part("weekday")),
	};
}

const price = new Map<number, number>();
for (let y = 2019; y <= 2025; y++) {
	const d = await get<Price>(`price${y}.json`, `price?bzn=DE-LU&start=${y}-01-01&end=${y}-12-31`);
	for (const [t, p] of hourly(d.unix_seconds, d.price)) {
		price.set(t, p);
	}
}
const NAMES = ["Solar", "Wind onshore", "Wind offshore", "Load", "Residual load"];
const power = new Map<string, Map<number, number>>(NAMES.map((n) => [n, new Map()]));
for (let y = 2023; y <= 2025; y++) {
	const d = await get<Power>(
		`power${y}.json`,
		`public_power?country=de&start=${y}-01-01&end=${y}-12-31`,
	);
	for (const n of NAMES) {
		const series = d.production_types.find((p) => p.name === n);
		if (!series) {
			throw new Error(`${n} missing in ${y}`);
		}
		for (const [t, x] of hourly(d.unix_seconds, series.data)) {
			power.get(n)?.set(t, x);
		}
	}
}

type Row = ReturnType<typeof local> & {
	t: number;
	p: number;
	s?: number;
	w?: number;
	l?: number;
	rl?: number;
};
const rows: Row[] = [...price]
	.sort((a, b) => a[0] - b[0])
	.map(([t, p]) => {
		const row: Row = { t, p, ...local(t) };
		const g = (n: string) => power.get(n)?.get(t);
		if (row.year >= 2023 && NAMES.every((n) => g(n) !== undefined)) {
			row.s = (g("Solar") as number) / 1000;
			row.w = ((g("Wind onshore") as number) + (g("Wind offshore") as number)) / 1000;
			row.l = (g("Load") as number) / 1000;
			row.rl = (g("Residual load") as number) / 1000;
		}
		return row;
	});
const R = rows.filter((r) => r.s !== undefined);
const share = (c: Row[]) => r1((100 * c.filter((r) => r.p < 0).length) / c.length);
const count = (c: Row[]) => c.filter((r) => r.p < 0).length;

const years = [2019, 2020, 2021, 2022, 2023, 2024, 2025].map((year) => {
	const ys = rows.filter((r) => r.year === year);
	return { year, neg: count(ys), hours: ys.length, min: r1(Math.min(...ys.map((r) => r.p))) };
});

const heat = Array.from({ length: 12 }, (_, m) =>
	Array.from({ length: 24 }, (_, h) => [
		h,
		m,
		share(R.filter((r) => r.month === m + 1 && r.hour === h)),
	]),
).flat();

const edges = Array.from({ length: 16 }, (_, i) => -10 + 5 * i);
const rl = edges.slice(0, -1).map((lo) => {
	const hi = lo + 5;
	const c = R.filter((r) => (r.rl as number) >= lo && (r.rl as number) < hi);
	return { lo, hi, n: c.length, share: c.length >= 15 ? share(c) : null };
});

const midday = R.filter((r) => r.hour >= 11 && r.hour <= 14 && r.month >= 4 && r.month <= 9);
const wd = [
	["Mon-Fri", (d: number) => d < 5],
	["Saturday", (d: number) => d === 5],
	["Sunday", (d: number) => d === 6],
].map(([name, f]) => ({
	name: name as string,
	share: share(midday.filter((r) => (f as (d: number) => boolean)(r.wd))),
}));

const neg = rows.filter((r) => r.p < 0).map((r) => r.p);
const cuts = [-1000, -100, -50, -20, -10, -5, -1, 0];
const depth = cuts.slice(1).map((hi, i) => {
	const lo = cuts[i] as number;
	return { lo, hi, n: neg.filter((x) => x >= lo && x < hi).length };
});

const cls: Record<string, number> = {};
for (const r of R.filter((r) => r.p < 0)) {
	const k =
		(r.s as number) > 8 && (r.w as number) > 8
			? "solar+wind"
			: (r.s as number) > (r.w as number)
				? "solar"
				: "wind";
	cls[k] = (cls[k] ?? 0) + 1;
}

const mean = (c: Row[], k: "s" | "w" | "l" | "rl") =>
	r1(c.reduce((a, r) => a + (r[k] as number), 0) / c.length);
const avg = Object.fromEntries(
	(["s", "w", "l", "rl"] as const).map((k) => [
		k,
		[
			mean(
				R.filter((r) => r.p < 0),
				k,
			),
			mean(
				R.filter((r) => r.p >= 0),
				k,
			),
		],
	]),
);

const low = Object.fromEntries(
	[2023, 2024, 2025].map((y) => {
		const ys = R.filter((r) => r.year === y);
		return [
			String(y),
			{
				low: ys.filter((r) => (r.rl as number) < 5).length,
				solarMax: r1(Math.max(...ys.map((r) => r.s as number))),
			},
		];
	}),
);

const DAYS = [
	["2025-05-11", "Sun 11 May 2025", "sun"],
	["2025-05-01", "Thu 1 May 2025", "public holiday, sun"],
	["2023-12-24", "Sun 24 Dec 2023", "wind, winter"],
	["2025-01-15", "Wed 15 Jan 2025", "ordinary weekday"],
];
const days = DAYS.map(([id, label, why]) => {
	const [y, m, d] = (id as string).split("-").map(Number);
	const c = R.filter((r) => r.year === y && r.month === m && r.day === d);
	const col = (f: (r: Row) => number) => c.map((r) => r1(f(r)));
	return {
		id,
		label,
		why,
		price: col((r) => r.p),
		solar: col((r) => r.s as number),
		wind: col((r) => r.w as number),
		load: col((r) => r.l as number),
	};
});

const data = { years, heat, rl, wd, depth, cls, avg, days, low };
await Bun.write(join(import.meta.dir, "data.json"), JSON.stringify(data));
