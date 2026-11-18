/* The electricity extract (data.json, written by extract.py) and every number the page shows, as pure functions of it.
   Source: OWID legacy energy dataset, downloaded 2026-10-22; Ember is CC BY 4.0, the Energy Institute retains its own terms (see page.mdx). */
import data from "./data.json";

/** A place in the extract: OWID's reported total and one series per source, in TWh, one value per year; null where blank. */
export interface Place {
	name: string;
	slug: string;
	region: boolean;
	total: (number | null)[];
	twh: (number | null)[][];
}

export const Y0 = data.first;
export const Y1 = data.last;
export const YEARS = Array.from({ length: Y1 - Y0 + 1 }, (_, i) => Y0 + i);

/** The sources, `at` their column in the extract. */
export const SOURCES = [
	{ id: "coal", name: "Coal", at: 0 },
	{ id: "gas", name: "Gas", at: 1 },
	{ id: "oil", name: "Oil and other fossil", at: 2 },
	{ id: "nuclear", name: "Nuclear", at: 3 },
	{ id: "hydro", name: "Hydro", at: 4 },
	{ id: "wind", name: "Wind", at: 5 },
	{ id: "solar", name: "Solar", at: 6 },
	{ id: "bio", name: "Bioenergy", at: 7 },
	{ id: "other", name: "Other renewables", at: 8 },
] as const;
export type SourceId = (typeof SOURCES)[number]["id"];

const slug = (name: string) =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

/** Regions first (World leading), then countries by name, as extract.py sorts them. */
export const PLACES: Place[] = data.places.map((p) => ({ ...p, slug: slug(p.name) }));
const bySlug = new Map(PLACES.map((p) => [p.slug, p]));
export const placeOf = (key: string) => bySlug.get(key);
const world = bySlug.get("world");
if (!world) {
	throw new Error("data.json has no World row: rerun extract.py");
}
export const WORLD = world;

const total = (p: Place, y: number) => p.total[y - Y0] ?? null;
const sum = (p: Place, y: number) => p.twh.reduce((s, series) => s + (series[y - Y0] ?? 0), 0);
/** A year is itemised when the sources add up to the total within rounding (0.1%). */
const itemised = (p: Place, y: number) => {
	const t = total(p, y);
	return t !== null && Math.abs(t - sum(p, y)) <= Math.max(0.01, 0.001 * t);
};
/** A source's TWh; a blank counts as zero only in an itemised year, else it is unknown (null). */
export const twh = (p: Place, id: SourceId, y: number) => {
	const at = SOURCES.find((s) => s.id === id)?.at ?? 0;
	return p.twh[at]?.[y - Y0] ?? (itemised(p, y) ? 0 : null);
};

/** What a place's generation, wind and solar, and coal did in a year, against the year before; null where unknown. */
export interface Step {
	year: number;
	total: number;
	windSolar: number;
	coal: number;
}
export function step(p: Place, y: number): Step | null {
	const [t0, t1] = [total(p, y - 1), total(p, y)];
	const part = (id: SourceId) => {
		const [a, b] = [twh(p, id, y - 1), twh(p, id, y)];
		return a === null || b === null ? null : b - a;
	};
	const [wind, solar, coal] = [part("wind"), part("solar"), part("coal")];
	if (t0 === null || t1 === null || wind === null || solar === null || coal === null) {
		return null;
	}
	return { year: y, total: t1 - t0, windSolar: wind + solar, coal };
}
/** Every year of a place with a known step. */
export const steps = (p: Place) =>
	YEARS.slice(1).flatMap((y) => {
		const s = step(p, y);
		return s ? [s] : [];
	});
/** The step into the last year of the data, null when the place lacks it. */
export const latest = (p: Place) => step(p, Y1);
/** One source's change into the last year, for places with both years. */
export const change = (p: Place, id: SourceId) => {
	const [a, b] = [twh(p, id, Y1 - 1), twh(p, id, Y1)];
	return a === null || b === null ? null : b - a;
};

const MINUS = "\u2212";
const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
/** A TWh figure with a thousands separator and two significant digits at least, a leading minus where negative. */
export const fmt = (v: number) => {
	const a = Math.abs(v);
	return (v < 0 ? MINUS : "") + (a >= 10 ? nf : a >= 1 ? nf1 : nf2).format(a);
};
/** A signed change. */
export const signed = (v: number) => (v > 0 ? "+" : "") + fmt(v);
/** The countries with a step into the last year. */
export const COUNTRIES = PLACES.filter((p) => !p.region && latest(p));
