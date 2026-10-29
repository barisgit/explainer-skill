/** Reads the config's display options, `reply`, `open` and `width`, for validate.ts. */
import type { BlockWidth, ReplyConfig } from "./config.ts";
import { isObject, knownKeys, prop, type Report, readString, show } from "./read.ts";

const WIDTHS: readonly BlockWidth[] = ["wide", "full"];

/** The choices as `[value, label]` pairs: a list's labels are their own values. */
export const choicePairs = (options: ReplyConfig["options"]): (readonly [string, string])[] =>
	Array.isArray(options)
		? options.map((label) => [label, label] as const)
		: Object.entries(options);

/** The choices, in Question's forms: a list of labels, or `{ value: label }` pairs; each label non-empty. */
function readOptions(raw: unknown, report: Report): ReplyConfig["options"] {
	const path = "reply.options";
	const fail = () => {
		report(path, `expected a list of labels or { "value": "label" } pairs; got ${show(raw)}`);
		return [];
	};
	if (Array.isArray(raw)) {
		return raw.length
			? raw.map((label, i) => readString(label, `${path}[${i}]`, report) ?? "")
			: fail();
	}
	if (!isObject(raw) || Object.keys(raw).length === 0) {
		return fail();
	}
	return Object.fromEntries(
		Object.entries(raw).map(([value, label]) => [
			value,
			readString(label, prop(path, value), report) ?? "",
		]),
	);
}

/** The `reply` property: choices with their labels each once, and whether a note is offered. */
export function readReply(raw: unknown, report: Report): ReplyConfig | undefined {
	if (raw === undefined) {
		return undefined;
	}
	if (!isObject(raw)) {
		report("reply", `expected { "options": ["Agree", "Change"], "note": true }; got ${show(raw)}`);
		return undefined;
	}
	knownKeys(raw, ["options", "note"], "reply", report);
	const { options: rawOptions, note } = raw;
	const options = readOptions(rawOptions, report);
	const labels = choicePairs(options).map(([, label]) => label);
	const twice = labels.find((label, i) => labels.indexOf(label) !== i);
	if (twice !== undefined) {
		report(
			"reply.options",
			`the label ${show(twice)} is used twice; the reply could not tell the choices apart`,
		);
	}
	if (note !== undefined && typeof note !== "boolean") {
		report("reply.note", `expected true or false; got ${show(note)}`);
	}
	return { options, ...(note === true ? { note: true } : {}) };
}

/** The `open` property: true, false, or a number of group levels from 1 to the `levels` groupBy gives. */
export function readOpen(
	raw: unknown,
	levels: number,
	report: Report,
): boolean | number | undefined {
	if (raw === undefined || typeof raw === "boolean") {
		return raw;
	}
	if (!(Number.isInteger(raw) && Number(raw) >= 1 && Number(raw) <= levels)) {
		report(
			"open",
			levels
				? `expected true, false or a number of levels from 1 to ${levels}; got ${show(raw)}`
				: `a number of levels needs groupBy, the fields it groups by; got ${show(raw)}`,
		);
		return undefined;
	}
	return Number(raw);
}

/** The `width` property: "wide" or "full". */
export function readWidth(raw: unknown, report: Report): BlockWidth | undefined {
	if (raw === undefined) {
		return undefined;
	}
	const width = WIDTHS.find((w) => w === raw);
	if (!width) {
		report("width", `expected ${WIDTHS.map((w) => show(w)).join(" or ")}; got ${show(raw)}`);
	}
	return width;
}
