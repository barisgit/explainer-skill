/** Builds the view model of one state from a block's model: the parts every view shares, then the body of the view shown. */
import type { ViewKind } from "./config.ts";
import { type Item, type Narrowing, type Sum, valueText } from "./engine.ts";
import { slug } from "./ids.ts";
import type { Model, TreeNode } from "./model.ts";
import { normalize, type RecordsState, writeHash } from "./state.ts";
import { choicePairs } from "./validate-display.ts";
import type {
	BoardView,
	Cell,
	Column,
	Facet,
	GroupRow,
	Header,
	ItemRow,
	Lane,
	RecordsTexts,
	RecordsView,
	ReplyView,
	TableView,
	TreeView,
	ViewOption,
} from "./view-model.ts";

/** The texts a view model needs, resolved from the page's labels by the caller. */
export interface ViewTexts {
	/** The controls' texts, which the view model hands the renderer as they are. */
	controls: RecordsTexts;
	total: string;
	/** "{shown} of {total}". */
	shown: string;
	/** An incomplete sum in words: "{value} known, {missing} without a value", and "unknown, {missing} without a value". */
	known: string;
	unknown: string;
	views: Readonly<Record<ViewKind, string>>;
}

function column(model: Model, field: string): Column {
	const kind = model.kinds[field];
	return {
		field,
		label: model.config.fields[field]?.label ?? field,
		kind: model.config.fields[field]?.kind ?? "text",
		align: kind?.align ?? "start",
		sum: kind?.sum ?? false,
	};
}

/** A field's sum as a cell, marked incomplete when records without a value leave it out; empty when the field is not summed. */
function sumCell(
	model: Model,
	field: string,
	sums: Readonly<Record<string, Sum>>,
	texts: ViewTexts,
): Cell {
	const sum = sums[field];
	const value = sum?.total ?? null;
	const text = model.kinds[field]?.text(value) ?? "";
	if (!sum?.missing) {
		return { field, value, text };
	}
	const words = (value === null ? texts.unknown : texts.known)
		.replace("{value}", text)
		.replace("{missing}", model.count(sum.missing));
	return { field, value, text: value === null ? "?" : `${text}\u00a0+\u00a0?`, incomplete: words };
}

/** The first cell of a group, lane or total: its title under the label column; the rest are sums or empty. */
function summaryCells(
	model: Model,
	columns: readonly Column[],
	title: string,
	sums: Readonly<Record<string, Sum>>,
	texts: ViewTexts,
): Cell[] {
	return columns.map((c, i) =>
		i === 0 ? { field: c.field, value: null, text: title } : sumCell(model, c.field, sums, texts),
	);
}

/** A field's value as text, for `detail` and `refField`: empty when the config names no field or the record holds none. */
const textOf = (item: Item, field: string | undefined) =>
	field === undefined ? "" : valueText(item.record, field);

function itemRow(
	model: Model,
	state: RecordsState,
	item: Item,
	columns: readonly Column[],
	match: boolean,
): ItemRow {
	const { link } = model.config;
	const detail = textOf(item, model.config.detail);
	const ref = textOf(item, model.config.refField);
	return {
		kind: "item",
		id: item.id,
		...(link ? { href: `#${link}/${encodeURIComponent(item.id)}` } : {}),
		...(detail ? { detail } : {}),
		open: detail !== "" && state.details.includes(item.id),
		...(ref ? { ref } : {}),
		cells: columns.map((c) => model.cell(item, c.field)),
		match,
	};
}

interface TreeInput {
	model: Model;
	texts: ViewTexts;
	state: RecordsState;
	columns: readonly Column[];
	/** Ids of the matching items; null when nothing narrows. */
	matched: ReadonlySet<string> | null;
}

function groupRow(node: TreeNode, input: TreeInput): GroupRow {
	const { model, texts, state, columns, matched } = input;
	const children = node.groups.length
		? node.groups.map((g) => groupRow(g, input))
		: node.items.map((item) =>
				itemRow(model, state, item, columns, !matched || matched.has(item.id)),
			);
	const matches = children.reduce(
		(n, child) => n + (child.kind === "group" ? child.matches : Number(child.match)),
		0,
	);
	const saved = state.open.includes(node.id);
	return {
		kind: "group",
		id: node.id,
		anchor: `${model.config.id}.${node.id}`,
		depth: node.depth,
		field: node.field,
		value: node.value,
		title: node.title,
		...(node.description ? { description: node.description } : {}),
		...(node.swatch ? { swatch: node.swatch } : {}),
		open: saved || (matched !== null && matches > 0),
		count: node.count,
		matches,
		cells: summaryCells(model, columns, node.title, node.sums, texts),
		children,
		toggle: {
			...state,
			open: saved ? state.open.filter((id) => id !== node.id) : [...state.open, node.id],
		},
	};
}

/** Every group and every detail below them is shown open. */
const allOpen = (rows: readonly (GroupRow | ItemRow)[]): boolean =>
	rows.every((row) =>
		row.kind === "group" ? row.open && allOpen(row.children) : !row.detail || row.open,
	);

function treeView(
	model: Model,
	state: RecordsState,
	matched: TreeInput["matched"],
	texts: ViewTexts,
): TreeView {
	// The groups show the groupBy fields, so the tree's rows leave them out.
	const columns = model.config.columns
		.filter((f) => !model.config.groupBy.includes(f))
		.map((field) => column(model, field));
	const input: TreeInput = { model, texts, state, columns, matched };
	const groups = model.tree.map((node) => groupRow(node, input));
	return {
		kind: "tree",
		columns,
		groups,
		total: summaryCells(model, columns, texts.total, model.totals, texts),
		expanded: allOpen(groups),
		expandAll: { ...state, open: model.rules.groups, details: model.rules.details },
		collapseAll: { ...state, open: [], details: [] },
	};
}

/** The sort a header leads to: numbers start largest first, other kinds A to Z; the third step is source order. */
function nextSort(c: Column, state: RecordsState): RecordsState["sort"] {
	const firstDesc = c.align === "end";
	if (state.sort?.field !== c.field) {
		return { field: c.field, desc: firstDesc };
	}
	return state.sort.desc === firstDesc ? { field: c.field, desc: !firstDesc } : null;
}

function tableView(
	model: Model,
	state: RecordsState,
	items: readonly Item[],
	sums: Readonly<Record<string, Sum>>,
	texts: ViewTexts,
): TableView {
	const columns = model.config.columns.map((field) => column(model, field));
	const headers = columns.map(
		(c): Header => ({
			...c,
			sort: state.sort?.field === c.field ? (state.sort.desc ? "desc" : "asc") : null,
			next: { ...state, sort: nextSort(c, state) },
		}),
	);
	return {
		kind: "table",
		columns: headers,
		rows: items.map((item) => itemRow(model, state, item, columns, true)),
		total: summaryCells(model, columns, texts.total, sums, texts),
	};
}

function boardView(
	model: Model,
	state: RecordsState,
	narrowing: Narrowing,
	texts: ViewTexts,
): BoardView {
	const field = model.config.groupBy[0] ?? "";
	// The lane shows the first groupBy field, so the cards leave out only that one.
	const columns = model.config.columns.filter((f) => f !== field).map((f) => column(model, f));
	const def = model.config.fields[field];
	const values =
		def?.kind === "category"
			? def.values.map((v) => v.value)
			: model.tree.map((node) => node.value);
	const found = new Map(model.engine.group([field], narrowing).map((g) => [g.value, g]));
	const kind = model.kinds[field];
	const lanes = values.map((value): Lane => {
		const group = found.get(value);
		const title =
			model.tree.find((node) => node.value === value)?.title ?? kind?.text(value) ?? value;
		const swatch = kind?.swatch(value);
		return {
			id: slug(value),
			value,
			title,
			...(swatch ? { swatch } : {}),
			count: group?.items.length ?? 0,
			countText: model.count(group?.items.length ?? 0),
			cells: summaryCells(model, columns, title, group?.sums ?? {}, texts),
			items: (group?.items ?? []).map((item) => itemRow(model, state, item, columns, true)),
		};
	});
	return { kind: "board", field, label: def?.label ?? field, columns, lanes };
}

function facets(
	model: Model,
	state: RecordsState,
	counts: Readonly<Record<string, ReadonlyMap<unknown, number>>>,
): Facet[] {
	return Object.entries(model.rules.facets).map(([field, values]) => {
		const chosen = state.filters[field] ?? [];
		return {
			field,
			label: model.config.fields[field]?.label ?? field,
			options: values.map((value) => {
				const selected = chosen.includes(value);
				const swatch = model.kinds[field]?.swatch(value);
				const next = selected ? chosen.filter((v) => v !== value) : [...chosen, value];
				return {
					value,
					text: model.kinds[field]?.text(value) ?? value,
					...(swatch ? { swatch } : {}),
					count: counts[field]?.get(value) ?? 0,
					selected,
					next: { ...state, filters: { ...state.filters, [field]: next } },
				};
			}),
		};
	});
}

function viewOptions(model: Model, state: RecordsState, texts: ViewTexts): ViewOption[] {
	return model.rules.views.map((kind) => ({
		kind,
		label: texts.views[kind],
		current: kind === state.view,
		next: { ...state, view: kind },
	}));
}

const replyOf = (model: Model): ReplyView | null => {
	const { reply } = model.config;
	return reply
		? {
				choices: choicePairs(reply.options).map(([value, label]) => ({ value, label })),
				note: reply.note === true,
			}
		: null;
};

/** The ids of the records a body shows; the tree shows all of them, dimming those a search leaves out. */
function shownIds(body: RecordsView["body"], all: readonly Item[]): ReadonlySet<string> {
	if (body.kind === "tree") {
		return new Set(all.map((item) => item.id));
	}
	const rows = body.kind === "table" ? body.rows : body.lanes.flatMap((lane) => lane.items);
	return new Set(rows.map((row) => row.id));
}

/** The view model of `state`, which is normalized first, so any state a renderer hands back is safe. */
export function buildView(model: Model, raw: RecordsState, texts: ViewTexts): RecordsView {
	const state = normalize(model.rules, raw);
	const narrowing: Narrowing = {
		filters: state.filters,
		terms: model.fold(state.search).split(/\s+/).filter(Boolean),
	};
	const filtering = narrowing.terms.length > 0 || Object.keys(state.filters).length > 0;
	const result = model.engine.query(narrowing, state.sort, model.config.facets);
	const body =
		state.view === "tree"
			? treeView(model, state, filtering ? new Set(result.items.map((i) => i.id)) : null, texts)
			: state.view === "board"
				? boardView(model, state, narrowing, texts)
				: tableView(model, state, result.items, result.sums, texts);
	const reply = replyOf(model);
	const shown = shownIds(body, model.items);
	return {
		id: model.config.id,
		state,
		hash: writeHash(model.rules, state),
		texts: texts.controls,
		views: viewOptions(model, state, texts),
		searchable: model.rules.searchable,
		facets: facets(model, state, result.counts),
		filtering,
		shown: result.items.length,
		total: model.items.length,
		shownText: texts.shown
			.replace("{shown}", model.count(result.items.length))
			.replace("{total}", model.count(model.items.length)),
		clear: filtering ? { ...state, filters: {}, search: "" } : null,
		body,
		reply,
		unlisted: reply
			? model.items
					.filter((item) => !shown.has(item.id))
					.map((item) => itemRow(model, state, item, body.columns, false))
			: [],
		width: model.config.width ?? "wide",
	};
}
