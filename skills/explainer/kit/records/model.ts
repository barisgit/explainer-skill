/**
 * What a records block computes once, when it is created: each field's behaviour, the items with their cells and search text,
 * the tree's groups with their ids and subtotals, and the rules a state is checked against. Every view model is built from it.
 */
import type { DataRecord, Field } from "./config.ts";
import {
	createEngine,
	type Engine,
	type EngineGroup,
	type Item,
	readValue,
	type Sum,
} from "./engine.ts";
import { type FieldBehaviour, fieldBehaviour } from "./fields.ts";
import { slug } from "./ids.ts";
import type { StateRules } from "./state.ts";
import { type CheckedConfig, RecordsConfigError } from "./validate.ts";
import type { Cell } from "./view-model.ts";

/** One group of the tree as built once: the view model adds what depends on the state. */
export interface TreeNode {
	id: string;
	depth: number;
	field: string;
	value: string;
	title: string;
	description?: string;
	swatch?: string;
	groups: TreeNode[];
	items: Item[];
	sums: Readonly<Record<string, Sum>>;
	/** Every record below it. */
	count: number;
}

export interface Model {
	config: CheckedConfig;
	locale: string;
	kinds: Readonly<Record<string, FieldBehaviour>>;
	items: readonly Item[];
	engine: Engine;
	tree: readonly TreeNode[];
	/** The sums over every record: the tree's total. */
	totals: Readonly<Record<string, Sum>>;
	rules: StateRules;
	/** Text folded for search: lower case, accents dropped. */
	fold(text: string): string;
	/** One item's cell in a field. */
	cell(item: Item, field: string): Cell;
	/** A cell for a sum, or an empty one when the field is not summed. */
	sumCell(field: string, sums: Readonly<Record<string, Sum>>): Cell;
}

/** Each facet field's values in order: a category's as listed, a text field's as they first appear in the data. */
function facetValues(config: CheckedConfig): Record<string, string[]> {
	const values: Record<string, string[]> = {};
	for (const key of config.facets) {
		const field = config.fields[key];
		values[key] =
			field?.kind === "category"
				? field.values.map((v) => v.value)
				: // Empty text is no value, as null is: a selection of "" could not be told from no selection in the hash.
					[...new Set(config.data.map((r) => String(readValue(r, key) ?? "")))].filter(Boolean);
	}
	return values;
}

interface TreeContext {
	config: CheckedConfig;
	kinds: Readonly<Record<string, FieldBehaviour>>;
	notes: ReadonlyMap<string, { title?: string; description?: string }>;
	problems: string[];
}

function countOf(group: EngineGroup): number {
	return group.items.length + group.groups.reduce((n, g) => n + countOf(g), 0);
}

/** One level's groups in the category's listed order (stable, so text levels keep first appearance), with ids. */
function toNodes(
	groups: readonly EngineGroup[],
	path: readonly string[],
	parentId: string,
	ctx: TreeContext,
): TreeNode[] {
	const depth = path.length;
	const field: Field | undefined = ctx.config.fields[ctx.config.groupBy[depth] ?? ""];
	const order = field?.kind === "category" ? field.values.map((v) => v.value) : [];
	const sorted = order.length
		? [...groups].sort((a, b) => order.indexOf(a.value) - order.indexOf(b.value))
		: groups;
	const ids = new Map<string, string>();
	return sorted.map((group) => {
		const values = [...path, group.value];
		const id = parentId ? `${parentId}.${slug(group.value)}` : slug(group.value);
		const clash = ids.get(id);
		if (clash !== undefined) {
			ctx.problems.push(
				`data: the ${group.field} values ${JSON.stringify(clash)} and ${JSON.stringify(group.value)} make the same group id "${id}"; make them differ in more than case and punctuation`,
			);
		}
		ids.set(id, group.value);
		const note = ctx.notes.get(JSON.stringify(values));
		const kind = ctx.kinds[group.field];
		const swatch = kind?.swatch(group.value);
		return {
			id,
			depth,
			field: group.field,
			value: group.value,
			title: note?.title ?? kind?.text(group.value) ?? group.value,
			...(note?.description ? { description: note.description } : {}),
			...(swatch ? { swatch } : {}),
			groups: toNodes(group.groups, values, id, ctx),
			items: group.items,
			sums: group.sums,
			count: countOf(group),
		};
	});
}

const idsOf = (nodes: readonly TreeNode[]): string[] =>
	nodes.flatMap((n) => [n.id, ...idsOf(n.groups)]);

function itemsOf(
	config: CheckedConfig,
	kinds: Readonly<Record<string, FieldBehaviour>>,
	fold: (t: string) => string,
): Item[] {
	const textOf = (record: DataRecord, key: string) => {
		const value = readValue(record, key);
		return kinds[key]?.text(value) ?? String(value ?? "");
	};
	return config.data.map((record, index) => ({
		id: String(readValue(record, config.idField)),
		index,
		record,
		haystack: fold(config.search.map((key) => textOf(record, key)).join("\n")),
	}));
}

/** The model of a checked config. Throws a RecordsConfigError when two groups would share an id. */
export function buildModel(config: CheckedConfig, locale: string): Model {
	const kinds: Record<string, FieldBehaviour> = {};
	for (const [key, field] of Object.entries(config.fields)) {
		kinds[key] = fieldBehaviour(field, locale);
	}
	const fold = (text: string) =>
		text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase(locale);
	const items = itemsOf(config, kinds, fold);
	const engine = createEngine(items, kinds);
	const notes = new Map(config.groups.map((note) => [JSON.stringify(note.path), note]));
	const problems: string[] = [];
	const tree = config.groupBy.length
		? toNodes(engine.group(config.groupBy), [], "", { config, kinds, notes, problems })
		: [];
	if (problems.length) {
		throw new RecordsConfigError(`records ${JSON.stringify(config.id)}`, problems);
	}
	const rules: StateRules = {
		id: config.id,
		views: config.views,
		sort: config.sort ? { field: config.sort.field, desc: config.sort.desc === true } : null,
		fields: Object.keys(config.fields),
		searchable: config.search.length > 0,
		facets: facetValues(config),
		groups: idsOf(tree),
	};
	const cell = (item: Item, field: string): Cell => {
		const value = readValue(item.record, field);
		const swatch = kinds[field]?.swatch(value);
		return { field, value, text: kinds[field]?.text(value) ?? "", ...(swatch ? { swatch } : {}) };
	};
	const sumCell = (field: string, sums: Readonly<Record<string, Sum>>): Cell => {
		const sum = sums[field];
		const value = sum?.total ?? null;
		const partial = value !== null && (sum?.missing ?? 0) > 0;
		return {
			field,
			value,
			text: kinds[field]?.text(value) ?? "",
			...(partial ? { incomplete: true } : {}),
		};
	};
	const totals = engine.query({ filters: {}, terms: [] }, null, []).sums;
	return { config, locale, kinds, items, engine, tree, totals, rules, fold, cell, sumCell };
}
