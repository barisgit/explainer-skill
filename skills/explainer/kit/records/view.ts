/** Builds the view model of one state from a block's model: the parts every view shares, then the body of the view shown. */
import type { ViewKind } from "./config.ts";
import { type Item, type Narrowing, readValue, type Sum } from "./engine.ts";
import { slug } from "./ids.ts";
import type { Model, TreeNode } from "./model.ts";
import { normalize, type RecordsState, writeHash } from "./state.ts";
import type {
	BoardView,
	Cell,
	Column,
	Facet,
	GroupRow,
	Header,
	ItemRow,
	Lane,
	Legend,
	RecordsTexts,
	RecordsView,
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

/** The first cell of a group, lane or total: its title under the label column; the rest are sums or empty. */
function summaryCells(
	model: Model,
	columns: readonly Column[],
	title: string,
	sums: Readonly<Record<string, Sum>>,
): Cell[] {
	return columns.map((c, i) =>
		i === 0 ? { field: c.field, value: null, text: title } : model.sumCell(c.field, sums),
	);
}

/** A field's value as text, for `detail` and `refField`: empty when the record holds none. */
function textOf(item: Item, field: string | undefined): string {
	return field === undefined ? "" : String(readValue(item.record, field) ?? "");
}

function itemRow(model: Model, item: Item, columns: readonly Column[], match: boolean): ItemRow {
	const { link } = model.config;
	const detail = textOf(item, model.config.detail);
	const ref = textOf(item, model.config.refField);
	return {
		kind: "item",
		id: item.id,
		...(link ? { href: `#${link}/${encodeURIComponent(item.id)}` } : {}),
		...(detail ? { detail } : {}),
		...(ref ? { ref } : {}),
		cells: columns.map((c) => model.cell(item, c.field)),
		match,
	};
}

interface TreeInput {
	model: Model;
	state: RecordsState;
	columns: readonly Column[];
	/** Ids of the matching items; null when nothing narrows. */
	matched: ReadonlySet<string> | null;
}

function groupRow(node: TreeNode, input: TreeInput): GroupRow {
	const { model, state, columns, matched } = input;
	const children = node.groups.length
		? node.groups.map((g) => groupRow(g, input))
		: node.items.map((item) => itemRow(model, item, columns, !matched || matched.has(item.id)));
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
		cells: summaryCells(model, columns, node.title, node.sums),
		children,
		toggle: {
			...state,
			open: saved ? state.open.filter((id) => id !== node.id) : [...state.open, node.id],
		},
	};
}

function treeView(
	model: Model,
	state: RecordsState,
	matched: TreeInput["matched"],
	texts: ViewTexts,
): TreeView {
	// The groups show the groupBy fields, so the tree's rows leave them out.
	const grouped = model.config.groupBy ?? [];
	const columns = model.config.columns
		.filter((f) => !grouped.includes(f))
		.map((field) => column(model, field));
	const input: TreeInput = { model, state, columns, matched };
	return {
		kind: "tree",
		columns,
		groups: model.tree.map((node) => groupRow(node, input)),
		total: summaryCells(model, columns, texts.total, model.totals),
		expandAll: { ...state, open: model.rules.groups },
		collapseAll: { ...state, open: [] },
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
		rows: items.map((item) => itemRow(model, item, columns, true)),
		total: summaryCells(model, columns, texts.total, sums),
	};
}

function boardView(model: Model, narrowing: Narrowing): BoardView {
	const field = model.config.groupBy?.[0] ?? "";
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
			cells: summaryCells(model, columns, title, group?.sums ?? {}),
			items: (group?.items ?? []).map((item) => itemRow(model, item, columns, true)),
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

/** A legend for each category field the block shows (its columns and groups) that has coloured values. */
function legends(model: Model): Legend[] {
	const shown = new Set([...(model.config.groupBy ?? []), ...model.config.columns]);
	return [...shown].flatMap((field): Legend[] => {
		const def = model.config.fields[field];
		if (def?.kind !== "category") {
			return [];
		}
		const entries = def.values.flatMap((v) =>
			v.color ? [{ value: v.value, text: v.label ?? v.value, swatch: v.color }] : [],
		);
		return entries.length ? [{ field, label: def.label, entries }] : [];
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

/** The view model of `state`, which is normalized first, so any state a renderer hands back is safe. */
export function buildView(model: Model, raw: RecordsState, texts: ViewTexts): RecordsView {
	const state = normalize(model.rules, raw);
	const narrowing: Narrowing = {
		filters: state.filters,
		terms: model.fold(state.search).split(/\s+/).filter(Boolean),
	};
	const filtering = narrowing.terms.length > 0 || Object.keys(state.filters).length > 0;
	const result = model.engine.query(narrowing, state.sort, model.config.facets ?? []);
	const count = new Intl.NumberFormat(model.locale);
	const body =
		state.view === "tree"
			? treeView(model, state, filtering ? new Set(result.items.map((i) => i.id)) : null, texts)
			: state.view === "board"
				? boardView(model, narrowing)
				: tableView(model, state, result.items, result.sums, texts);
	return {
		id: model.config.id,
		state,
		hash: writeHash(model.rules, state),
		texts: texts.controls,
		views: viewOptions(model, state, texts),
		searchable: model.rules.searchable,
		facets: facets(model, state, result.counts),
		legends: legends(model),
		filtering,
		shown: result.items.length,
		total: model.items.length,
		shownText: texts.shown
			.replace("{shown}", count.format(result.items.length))
			.replace("{total}", count.format(model.items.length)),
		clear: filtering ? { ...state, filters: {}, search: "" } : null,
		body,
	};
}
