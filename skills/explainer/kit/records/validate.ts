/**
 * Reads a records config from untrusted JSON (the props an MDX page gives Records) into a `RecordsConfig`, or throws one
 * `RecordsConfigError` that lists every problem at once with its property path, the value found and what to write instead, so
 * `pack` can stop on a mistake instead of the page showing an empty block. The fields are read first (validate-fields.ts),
 * then what names them, then the data against them (validate-data.ts).
 */
import {
	type Field,
	type FieldKind,
	type GroupNote,
	type RecordsConfig,
	type SortSpec,
	VIEW_KINDS,
	type ViewKind,
} from "./config.ts";
import { groupIdClash, slug } from "./ids.ts";
import {
	isObject,
	knownKeys,
	list,
	NAME,
	NAME_HINT,
	type Report,
	readOptional,
	readProp,
	readString,
	show,
} from "./read.ts";
import { checkGroupPaths, readData } from "./validate-data.ts";
import { readOpen, readReply, readWidth } from "./validate-display.ts";
import { readFields } from "./validate-fields.ts";

/** A config as parseConfig returns it: the lists left out hold their defaults, so the model never guesses them again. */
export type CheckedConfig = RecordsConfig &
	Required<Pick<RecordsConfig, "groupBy" | "groups" | "views" | "search" | "facets">>;

/** The most problems the error's message lists; `problems` keeps them all. */
const MAX_SHOWN = 20;

/** A config that cannot be shown. The message names the block and lists the problems, one `path: problem` per line. */
export class RecordsConfigError extends Error {
	override name = "RecordsConfigError";
	readonly problems: readonly string[];
	constructor(block: string, problems: readonly string[]) {
		const shown = problems.slice(0, MAX_SHOWN).map((p) => `  ${p}`);
		const more = problems.length - shown.length;
		const count = problems.length === 1 ? "1 problem" : `${problems.length} problems`;
		super(
			[
				`${block}: ${count} in the config`,
				...shown,
				...(more ? [`  ... and ${more} more`] : []),
			].join("\n"),
		);
		this.problems = problems;
	}
}

const TOP_KEYS = [
	"id",
	"data",
	"idField",
	"fields",
	"columns",
	"groupBy",
	"groups",
	"views",
	"sort",
	"search",
	"facets",
	"link",
	"detail",
	"refField",
	"open",
	"reply",
	"width",
] as const satisfies readonly (keyof RecordsConfig)[];

const isView = (v: unknown): v is ViewKind => VIEW_KINDS.some((kind) => kind === v);

interface KeyRules {
	fields: Readonly<Record<string, Field>>;
	/** Kinds the list may name; all when left out. */
	kinds?: readonly FieldKind[];
	/** A key the list may name without declaring it as a field (the id field, for search). */
	extra?: string | undefined;
	required?: boolean;
	/** One key in place of a list: problems are reported at `path` itself. */
	single?: boolean;
}

/** A list of field keys, each declared once and of an allowed kind. */
function readKeys(raw: unknown, path: string, report: Report, rules: KeyRules): string[] {
	if (raw === undefined && !rules.required) {
		return [];
	}
	if (!Array.isArray(raw) || (rules.required && raw.length === 0)) {
		report(path, `expected a list of field keys; got ${show(raw)}`);
		return [];
	}
	const keys: string[] = [];
	raw.forEach((key: unknown, i) => {
		const problem = keyProblem(key, keys, rules);
		if (problem) {
			report(rules.single ? path : `${path}[${i}]`, problem);
		} else if (typeof key === "string") {
			keys.push(key);
		}
	});
	return keys;
}

/** What is wrong with one key of a list, given the keys read before it; undefined for a key to keep. */
function keyProblem(key: unknown, keys: readonly string[], rules: KeyRules): string | undefined {
	if (typeof key === "string" && key === rules.extra) {
		return undefined;
	}
	const field =
		typeof key === "string" && Object.hasOwn(rules.fields, key) ? rules.fields[key] : undefined;
	if (!(typeof key === "string" && field)) {
		return `${show(key)} is not a field; the fields are ${list(Object.keys(rules.fields))}`;
	}
	if (rules.kinds && !rules.kinds.includes(field.kind)) {
		return `${show(key)} is a ${field.kind} field; expected a ${rules.kinds.join(" or ")} field`;
	}
	return keys.includes(key) ? `${show(key)} is listed twice` : undefined;
}

function readViews(raw: unknown, grouped: boolean, report: Report): ViewKind[] {
	if (raw === undefined) {
		return [grouped ? "tree" : "table"];
	}
	if (!Array.isArray(raw) || raw.length === 0) {
		report("views", `expected a list of ${list(VIEW_KINDS)}, the default first; got ${show(raw)}`);
		return [];
	}
	const views: ViewKind[] = [];
	raw.forEach((view, i) => {
		if (!isView(view)) {
			report(`views[${i}]`, `expected one of ${list(VIEW_KINDS)}; got ${show(view)}`);
		} else if (views.includes(view)) {
			report(`views[${i}]`, `${show(view)} is listed twice`);
		} else if (view !== "table" && !grouped) {
			report(`views[${i}]`, `the ${view} view needs groupBy, the fields it groups by`);
		} else {
			views.push(view);
		}
	});
	return views;
}

function readSort(
	raw: unknown,
	fields: Readonly<Record<string, Field>>,
	report: Report,
): SortSpec | undefined {
	if (raw === undefined) {
		return undefined;
	}
	if (!isObject(raw)) {
		report("sort", `expected { "field": ..., "desc": true }; got ${show(raw)}`);
		return undefined;
	}
	knownKeys(raw, ["field", "desc"], "sort", report);
	const { field: key, desc } = raw;
	const [field] = readKeys([key], "sort.field", report, { fields, single: true });
	if (desc !== undefined && typeof desc !== "boolean") {
		report("sort.desc", `expected true or false; got ${show(desc)}`);
	}
	return field === undefined ? undefined : { field, ...(desc === true ? { desc: true } : {}) };
}

function readGroups(raw: unknown, levels: number, report: Report): GroupNote[] {
	if (raw === undefined) {
		return [];
	}
	if (!Array.isArray(raw) || levels === 0) {
		report(
			"groups",
			levels ? `expected a list of group notes; got ${show(raw)}` : "groups needs groupBy",
		);
		return [];
	}
	return raw.flatMap((note, i): GroupNote[] => {
		const at = `groups[${i}]`;
		if (!isObject(note)) {
			report(at, `expected { "path": [...], "description": ... }; got ${show(note)}`);
			return [];
		}
		knownKeys(note, ["path", "title", "description"], at, report);
		const { path, title, description } = note;
		const ok = Array.isArray(path) && path.length >= 1 && path.length <= levels;
		if (!(ok && path.every((v) => typeof v === "string"))) {
			report(
				`${at}.path`,
				`expected the group's values along groupBy, 1 to ${levels} of them; got ${show(path)}`,
			);
			return [];
		}
		const text = (v: unknown, key: string) =>
			v === undefined ? {} : { [key]: readString(v, `${at}.${key}`, report) ?? "" };
		return [{ path, ...text(title, "title"), ...text(description, "description") }];
	});
}

/** The first column names each record and holds the titles of groups, lanes and the total, so it is neither grouped nor summed. */
function checkFirstColumn(
	first: string | undefined,
	groupBy: readonly string[],
	fields: Readonly<Record<string, Field>>,
	report: Report,
) {
	const field = first === undefined ? undefined : fields[first];
	if (first !== undefined && groupBy.includes(first)) {
		report(
			"columns[0]",
			`${show(first)} is a groupBy field, which the tree leaves out of its rows; start with the field that names a record`,
		);
	} else if (field && "sum" in field && field.sum) {
		report(
			"columns[0]",
			`${show(first)} is summed, but the first column holds the group titles; start with the field that names a record`,
		);
	}
}

/** A category's listed values become group and lane ids, even before any record holds them, so none may share one. */
function checkGroupIds(field: Field | undefined, path: string, report: Report) {
	if (field?.kind !== "category") {
		return;
	}
	const seen = new Map<string, string>();
	for (const { value } of field.values) {
		const id = slug(value);
		const other = seen.get(id);
		if (other !== undefined) {
			report(path, `the values ${groupIdClash(other, value, id)}`);
		}
		seen.set(id, value);
	}
}

/** The parts of a config that name fields: read once the fields are known. */
function readLists(
	input: Record<string, unknown>,
	fields: Readonly<Record<string, Field>>,
	idField: string | undefined,
	report: Report,
) {
	const { groupBy: rawGroupBy, columns: rawColumns, search, facets, views, groups, sort } = input;
	const groupBy = readKeys(rawGroupBy, "groupBy", report, { fields, kinds: ["text", "category"] });
	const columns = readKeys(rawColumns, "columns", report, { fields, required: true });
	checkFirstColumn(columns[0], groupBy, fields, report);
	groupBy.forEach((key, i) => {
		checkGroupIds(fields[key], `groupBy[${i}]`, report);
	});
	return {
		groupBy,
		columns,
		search: readKeys(search, "search", report, { fields, extra: idField }),
		facets: readKeys(facets, "facets", report, { fields, kinds: ["text", "category"] }),
		views: readViews(views, groupBy.length > 0, report),
		groups: readGroups(groups, groupBy.length, report),
		sort: readSort(sort, fields, report),
	};
}

/** `detail` and `refField`, each one field key. A row is a link or a fold, so `detail` and `link` exclude each other. */
function readRowKeys(
	input: Record<string, unknown>,
	fields: Readonly<Record<string, Field>>,
	link: string | undefined,
	report: Report,
) {
	const { detail: rawDetail, refField: rawRef } = input;
	const one = (raw: unknown, path: string, kinds: FieldKind[]) =>
		raw === undefined
			? undefined
			: readKeys([raw], path, report, { fields, kinds, single: true })[0];
	const detail = one(rawDetail, "detail", ["text"]);
	if (detail && link) {
		report(
			"detail",
			`a row links to its view (link ${show(link)}) or opens in place to its detail, not both; put the detail in the view`,
		);
	}
	return { detail, refField: one(rawRef, "refField", ["text", "category"]) };
}

/** The config, checked: throws a RecordsConfigError listing every problem, or returns it typed. */
export function parseConfig(input: unknown): CheckedConfig {
	if (!isObject(input)) {
		throw new RecordsConfigError("records", [`the config: expected an object; got ${show(input)}`]);
	}
	const problems: string[] = [];
	const report: Report = (path, message) => {
		problems.push(`${path}: ${message}`);
	};
	knownKeys(input, TOP_KEYS, "", report);
	const id = readProp(input, "id", "", report, { pattern: NAME, hint: NAME_HINT });
	const idField = readProp(input, "idField", "", report, {
		pattern: NAME,
		hint: `a field key: ${NAME_HINT}`,
	});
	const { fields: rawFields, data: rawData } = input;
	const fields = readFields(rawFields, report);
	const { groupBy, columns, search, facets, views, groups, sort } = readLists(
		input,
		fields,
		idField,
		report,
	);
	const link = readOptional(input, "link", "", report, {
		pattern: NAME,
		hint: `a view name: ${NAME_HINT}`,
	});
	const { detail, refField } = readRowKeys(input, fields, link, report);
	const { reply: rawReply, open: rawOpen, width: rawWidth } = input;
	const reply = readReply(rawReply, report);
	const open = readOpen(rawOpen, groupBy.length, report);
	const width = readWidth(rawWidth, report);
	const data = idField ? readData(rawData, { idField, fields, groupBy }, report) : [];
	checkGroupPaths(groups, data, groupBy, report);
	if (problems.length || id === undefined || idField === undefined) {
		throw new RecordsConfigError(id ? `records ${JSON.stringify(id)}` : "records", problems);
	}
	return {
		id,
		data,
		idField,
		fields,
		columns,
		groupBy,
		groups,
		views,
		search,
		facets,
		...(sort ? { sort } : {}),
		...(link ? { link } : {}),
		...(detail ? { detail } : {}),
		...(refField ? { refField } : {}),
		...(reply ? { reply } : {}),
		...(open === undefined ? {} : { open }),
		...(width ? { width } : {}),
	};
}
