/** Reads a config's `fields`, the declaration of each field's kind and options, for validate.ts. */
import type { CategoryValue, Field, FieldKind } from "./config.ts";
import {
	isObject,
	knownKeys,
	list,
	NAME,
	NAME_HINT,
	prop,
	type Report,
	readOptional,
	readProp,
	show,
} from "./read.ts";

/** Rejects what could end a CSS declaration where the renderer writes the colour. */
const COLOR = /^[^;{}<>"'\\]+$/;
/** The properties each field kind takes; the keys are every kind there is. */
const FIELD_KEYS = {
	text: ["label", "kind"],
	number: ["label", "kind", "unit", "digits", "sum"],
	currency: ["label", "kind", "currency", "digits", "sum"],
	date: ["label", "kind"],
	category: ["label", "kind", "values"],
} as const satisfies Record<FieldKind, readonly string[]>;
const KINDS = Object.keys(FIELD_KEYS);

const isKind = (v: unknown): v is FieldKind => typeof v === "string" && KINDS.includes(v);

/** The optional properties of a number or currency field. */
function readNumberOptions(raw: Record<string, unknown>, path: string, report: Report) {
	const { digits, sum } = raw;
	if (
		digits !== undefined &&
		!(Number.isInteger(digits) && Number(digits) >= 0 && Number(digits) <= 20)
	) {
		report(prop(path, "digits"), `expected a whole number from 0 to 20; got ${show(digits)}`);
	}
	if (sum !== undefined && typeof sum !== "boolean") {
		report(prop(path, "sum"), `expected true or false; got ${show(sum)}`);
	}
	return {
		...(typeof digits === "number" ? { digits } : {}),
		...(typeof sum === "boolean" ? { sum } : {}),
	};
}

function readCategoryValue(raw: unknown, path: string, report: Report): CategoryValue | undefined {
	if (!isObject(raw)) {
		report(path, `expected { "value": ..., "label": ..., "color": ... }; got ${show(raw)}`);
		return undefined;
	}
	knownKeys(raw, ["value", "label", "color"], path, report);
	const value = readProp(raw, "value", path, report);
	const label = readOptional(raw, "label", path, report);
	const color = readOptional(raw, "color", path, report, {
		pattern: COLOR,
		hint: "a CSS colour such as var(--c3) or #2a7",
	});
	return value === undefined
		? undefined
		: {
				value,
				...(label === undefined ? {} : { label }),
				...(color === undefined ? {} : { color }),
			};
}

function readCategoryValues(raw: unknown, path: string, report: Report): CategoryValue[] {
	if (!Array.isArray(raw) || raw.length === 0) {
		report(path, `expected a list of the category's values, in order; got ${show(raw)}`);
		return [];
	}
	const values: CategoryValue[] = [];
	raw.forEach((item, i) => {
		const value = readCategoryValue(item, `${path}[${i}]`, report);
		if (value && values.some((v) => v.value === value.value)) {
			report(`${path}[${i}].value`, `${show(value.value)} is listed twice`);
		} else if (value) {
			values.push(value);
		}
	});
	return values;
}

function readField(raw: unknown, path: string, report: Report): Field | undefined {
	if (!isObject(raw)) {
		report(path, `expected { "label": ..., "kind": ... }; got ${show(raw)}`);
		return undefined;
	}
	const { kind } = raw;
	if (!isKind(kind)) {
		report(prop(path, "kind"), `expected one of ${list(KINDS)}; got ${show(kind)}`);
		return undefined;
	}
	knownKeys(raw, FIELD_KEYS[kind], path, report);
	const label = readProp(raw, "label", path, report) ?? "";
	switch (kind) {
		case "text":
		case "date":
			return { kind, label };
		case "category": {
			const { values } = raw;
			return { kind, label, values: readCategoryValues(values, prop(path, "values"), report) };
		}
		case "number": {
			const unit = readOptional(raw, "unit", path, report);
			return { kind, label, ...readNumberOptions(raw, path, report), ...(unit ? { unit } : {}) };
		}
		case "currency": {
			const currency = readProp(raw, "currency", path, report, {
				pattern: /^[A-Z]{3}$/,
				hint: 'an ISO 4217 code such as "EUR"',
			});
			// A missing code is reported above, so this placeholder never reaches a returned config.
			return { kind, label, currency: currency ?? "XXX", ...readNumberOptions(raw, path, report) };
		}
	}
}

/** The config's `fields` by key, each checked; a field with a problem is reported and left out. */
export function readFields(raw: unknown, report: Report): Record<string, Field> {
	if (!isObject(raw) || Object.keys(raw).length === 0) {
		report(
			"fields",
			`expected an object of fields by key, such as { "hours": { "label": "Hours", "kind": "number" } }; got ${show(raw)}`,
		);
		return {};
	}
	const fields: Record<string, Field> = {};
	for (const [key, def] of Object.entries(raw)) {
		// A plain name keeps a key out of the object prototype ("__proto__"), the engine's own column ids and the hash grammar.
		if (!NAME.test(key)) {
			report(
				prop("fields", key),
				`a field key must be a plain name (${NAME_HINT}); rename it in the data`,
			);
			continue;
		}
		const field = readField(def, prop("fields", key), report);
		if (field) {
			fields[key] = field;
		}
	}
	return fields;
}
