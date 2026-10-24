/**
 * What each field kind does with a value: whether a data value fits it, the text the reader sees, the order values sort in,
 * and the marker colour. `fieldBehaviour(field, locale)` builds all of it for one field once, so formatting and sorting for a kind
 * live in one place and every other module stays kind-agnostic.
 */
import type { Field, Value } from "./config.ts";

/** One field's behaviour, for the page's locale. */
export interface FieldBehaviour {
	/** Numbers sit at the end of a cell so their digits line up; everything else at the start. */
	align: "start" | "end";
	/** Whether groups, board columns and totals add this field up. */
	sum: boolean;
	/** The reader's text for a value; "" for null. */
	text(value: Value): string;
	/** Orders two non-null values ascending: numbers by size, dates by day, categories as listed, text by the locale's collation. */
	compare(a: string | number, b: string | number): number;
	/** The marker colour of a category value that has one. */
	swatch(value: Value): string | undefined;
}

/** A calendar date as `YYYY-MM-DD` that exists (no 2027-02-30). */
export function isIsoDate(value: string): boolean {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) {
		return false;
	}
	const [, y, m, d] = match.map(Number);
	const date = new Date(Date.UTC(y ?? 0, (m ?? 0) - 1, d ?? 0));
	return date.toISOString().slice(0, 10) === value;
}

/** Why a data value does not fit the field, or null when it does. Null always fits: it means unknown. */
export function valueProblem(field: Field, value: unknown): string | null {
	if (value === null || value === undefined) {
		return null;
	}
	switch (field.kind) {
		case "text":
			return typeof value === "string" ? null : "expected text or null";
		case "number":
		case "currency":
			return typeof value === "number" && Number.isFinite(value)
				? null
				: "expected a finite number or null";
		case "date":
			return typeof value === "string" && isIsoDate(value)
				? null
				: "expected a date as YYYY-MM-DD or null";
		case "category": {
			const listed = field.values.map((v) => v.value);
			return typeof value === "string" && listed.includes(value)
				? null
				: `expected one of ${listed.map((v) => JSON.stringify(v)).join(", ")} (add it to the field's values)`;
		}
	}
}

/** The text a number or amount gets: fixed digits when the field sets them. */
function numberFormat(locale: string, digits: number | undefined, extra: Intl.NumberFormatOptions) {
	const fixed =
		digits === undefined ? {} : { minimumFractionDigits: digits, maximumFractionDigits: digits };
	return new Intl.NumberFormat(locale, { ...extra, ...fixed });
}

const asNumber = (value: string | number) => (typeof value === "number" ? value : Number(value));

/** The behaviour of one field for `locale`, a BCP 47 tag the caller has checked. */
export function fieldBehaviour(field: Field, locale: string): FieldBehaviour {
	const collator = new Intl.Collator(locale, { numeric: true });
	const textual = {
		align: "start" as const,
		sum: false,
		swatch: () => undefined,
		compare: (a: string | number, b: string | number) => collator.compare(String(a), String(b)),
	};
	switch (field.kind) {
		case "text":
			return { ...textual, text: (v) => (v === null ? "" : String(v)) };
		case "date": {
			const format = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
			return {
				...textual,
				text: (v) => (v === null ? "" : format.format(new Date(`${v}T00:00:00Z`))),
				compare: (a, b) => String(a).localeCompare(String(b), "en"),
			};
		}
		case "category": {
			const order = new Map(field.values.map((v, i) => [v.value, i]));
			const byValue = new Map(field.values.map((v) => [v.value, v]));
			return {
				...textual,
				text: (v) => (v === null ? "" : (byValue.get(String(v))?.label ?? String(v))),
				compare: (a, b) => (order.get(String(a)) ?? 0) - (order.get(String(b)) ?? 0),
				swatch: (v) => (v === null ? undefined : byValue.get(String(v))?.color),
			};
		}
		case "number":
		case "currency": {
			const format =
				field.kind === "number"
					? numberFormat(locale, field.digits, {})
					: numberFormat(locale, field.digits, { style: "currency", currency: field.currency });
			const unit = field.kind === "number" && field.unit ? `\u00a0${field.unit}` : "";
			return {
				align: "end",
				sum: field.sum === true,
				text: (v) => (v === null ? "" : format.format(asNumber(v)) + unit),
				compare: (a, b) => asNumber(a) - asNumber(b),
				swatch: () => undefined,
			};
		}
	}
}
