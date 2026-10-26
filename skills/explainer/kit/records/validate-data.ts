/** Checks a config's `data` against its fields and group notes, for validate.ts. */
import type { DataRecord, Field, GroupNote } from "./config.ts";
import { valueProblem } from "./fields.ts";
import { isObject, prop, type Report, show } from "./read.ts";

/** A record's id as text: a non-empty string or a finite number. */
function idOf(value: unknown): string | undefined {
	if (typeof value === "string" && value !== "") {
		return value;
	}
	return typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
}

/** The parts of the config, read before the data, that each record must fit. */
export interface DataRules {
	idField: string;
	fields: Readonly<Record<string, Field>>;
	groupBy: readonly string[];
}

function checkRecord(
	record: Record<string, unknown>,
	at: string,
	rules: DataRules,
	report: Report,
) {
	for (const [key, field] of Object.entries(rules.fields)) {
		const problem = valueProblem(field, record[key]);
		if (problem) {
			report(prop(at, key), `${problem}; got ${show(record[key])}`);
		}
	}
	for (const key of rules.groupBy) {
		if (record[key] === null || record[key] === undefined) {
			report(prop(at, key), "every record needs a value in a groupBy field");
		}
	}
}

/** The records, each an object with a unique id and values that fit its fields; every record that is an object is kept. */
export function readData(raw: unknown, rules: DataRules, report: Report): DataRecord[] {
	if (!Array.isArray(raw)) {
		report("data", `expected a list of records; got ${show(raw)}`);
		return [];
	}
	const seen = new Map<string, number>();
	const records: DataRecord[] = [];
	raw.forEach((record, i) => {
		const at = `data[${i}]`;
		if (!isObject(record)) {
			report(at, `expected a record object; got ${show(record)}`);
			return;
		}
		const id = idOf(record[rules.idField]);
		const first = id === undefined ? undefined : seen.get(id);
		if (id === undefined) {
			report(
				prop(at, rules.idField),
				`expected the record's id, text or a number; got ${show(record[rules.idField])}`,
			);
		} else if (first !== undefined) {
			report(
				prop(at, rules.idField),
				`${show(id)} is also the id of data[${first}]; ids must be unique`,
			);
		} else {
			seen.set(id, i);
		}
		checkRecord(record, at, rules, report);
		records.push(record);
	});
	return records;
}

/** Group notes must name groups the data has, or a typo would silently drop the text. */
export function checkGroupPaths(
	groups: readonly GroupNote[],
	data: readonly DataRecord[],
	groupBy: readonly string[],
	report: Report,
) {
	const paths = new Set<string>();
	for (const record of data) {
		const values = groupBy.map((key) => String(record[key]));
		values.forEach((_, depth) => {
			paths.add(JSON.stringify(values.slice(0, depth + 1)));
		});
	}
	groups.forEach((note, i) => {
		if (!paths.has(JSON.stringify(note.path))) {
			report(
				`groups[${i}].path`,
				`no record has ${note.path.map((v, d) => `${groupBy[d]} ${show(v)}`).join(" and ")}`,
			);
		}
	});
}
