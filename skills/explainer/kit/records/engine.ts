/**
 * The query engine: filters, search, sort, grouping with sums, and facet counts over the records, done by TanStack Table
 * (vendor/table-core.js). This is the only module that knows TanStack; the rest of the core sees items, groups and sums.
 * Every call builds a table for one question and reads it synchronously, so the engine keeps no state between calls.
 */
import {
	type AggregationFnDef,
	type ColumnDef,
	type ColumnFiltersState,
	columnFacetingFeature,
	columnFilteringFeature,
	columnGroupingFeature,
	constructTable,
	createFacetedRowModel,
	createFacetedUniqueValues,
	createFilteredRowModel,
	createGroupedRowModel,
	createSortedRowModel,
	globalFilteringFeature,
	type Row,
	rowAggregationFeature,
	rowSortingFeature,
	storeReactivityBindings,
	tableFeatures,
} from "../../vendor/table-core.js";
import type { DataRecord, Value } from "./config.ts";
import type { FieldBehaviour } from "./fields.ts";

/** One record as the core holds it: its id, its place in the source, and the folded text the search looks in. */
export interface Item {
	id: string;
	index: number;
	record: DataRecord;
	haystack: string;
}

/** A field's sum: null when no record has a value; `missing` counts the records without one, which the sum leaves out. */
export interface Sum {
	total: number | null;
	missing: number;
}

/** One group: the value its records share in `field`, its subgroups or (at the last level) its items, in first-appearance order. */
export interface EngineGroup {
	field: string;
	value: string;
	groups: EngineGroup[];
	items: Item[];
	sums: Readonly<Record<string, Sum>>;
}

/** What narrows the records: facet values (any of them within a field, every field), and search terms (all must occur). */
export interface Narrowing {
	filters: Readonly<Record<string, readonly string[]>>;
	terms: readonly string[];
}

/** The records' value in a field, as a Value: anything else (undeclared shapes) reads as unknown. */
export function readValue(record: DataRecord, key: string): Value {
	const value = record[key];
	return typeof value === "string" || typeof value === "number" ? value : null;
}

const SEARCH = "\u0000search";

const sumFn: AggregationFnDef<typeof FEATURES, Item, unknown, Sum> = {
	aggregate: ({ rows, getValue }) => {
		let total: number | null = null;
		let missing = 0;
		for (const row of rows) {
			const value = getValue(row);
			if (typeof value === "number") {
				total = (total ?? 0) + value;
			} else {
				missing += 1;
			}
		}
		return { total, missing };
	},
};

const FEATURES = tableFeatures({
	coreReactivityFeature: storeReactivityBindings(),
	columnFilteringFeature,
	globalFilteringFeature,
	rowSortingFeature,
	columnFacetingFeature,
	columnGroupingFeature,
	rowAggregationFeature,
	filteredRowModel: createFilteredRowModel(),
	sortedRowModel: createSortedRowModel(),
	groupedRowModel: createGroupedRowModel(),
	facetedRowModel: createFacetedRowModel(),
	facetedUniqueValues: createFacetedUniqueValues(),
});
type ItemRow = Row<typeof FEATURES, Item>;

const sortable = (value: unknown): string | number =>
	typeof value === "number" || typeof value === "string" ? value : "";

const isSum = (value: unknown): value is Sum =>
	typeof value === "object" && value !== null && "total" in value && "missing" in value;

/** The engine over one collection; `kinds` are its fields' behaviours by key. */
export function createEngine(
	items: readonly Item[],
	kinds: Readonly<Record<string, FieldBehaviour>>,
) {
	const sumKeys = Object.keys(kinds).filter((key) => kinds[key]?.sum);
	const columns: ColumnDef<typeof FEATURES, Item>[] = [
		...Object.entries(kinds).map(
			([key, kind]): ColumnDef<typeof FEATURES, Item> => ({
				id: key,
				accessorFn: (item) => readValue(item.record, key) ?? undefined,
				filterFn: (row, id, values: readonly string[]) => values.includes(String(row.getValue(id))),
				// sortUndefined puts unknown values last before the comparison, so it sees values only.
				sortFn: (a, b, id) => kind.compare(sortable(a.getValue(id)), sortable(b.getValue(id))),
				sortUndefined: "last",
				...(kind.sum ? { aggregationFn: sumFn } : {}),
			}),
		),
		{ id: SEARCH, accessorFn: (item) => item.haystack },
	];

	function table(
		narrowing: Narrowing | undefined,
		extra: { sort?: { field: string; desc: boolean } | null; grouping?: readonly string[] },
	) {
		const columnFilters: ColumnFiltersState = Object.entries(narrowing?.filters ?? {}).map(
			([id, value]) => ({ id, value }),
		);
		const terms = narrowing?.terms ?? [];
		return constructTable({
			features: FEATURES,
			data: [...items],
			columns,
			getRowId: (item) => item.id,
			getColumnCanGlobalFilter: (column) => column.id === SEARCH,
			globalFilterFn: (row, id) => terms.every((term) => String(row.getValue(id)).includes(term)),
			initialState: {
				columnFilters,
				globalFilter: terms.length ? terms.join(" ") : undefined,
				sorting: extra.sort ? [{ id: extra.sort.field, desc: extra.sort.desc }] : [],
				grouping: [...(extra.grouping ?? [])],
			},
		});
	}

	function sumsOf(row: ItemRow): Record<string, Sum> {
		const sums: Record<string, Sum> = {};
		for (const key of sumKeys) {
			const value = row.getValue(key);
			sums[key] = isSum(value) ? value : { total: null, missing: 0 };
		}
		return sums;
	}

	function toGroup(row: ItemRow): EngineGroup {
		const nested = row.subRows.filter((sub) => sub.getIsGrouped());
		return {
			field: row.groupingColumnId ?? "",
			value: String(row.groupingValue),
			groups: nested.map(toGroup),
			items: nested.length ? [] : row.subRows.map((sub) => sub.original),
			sums: sumsOf(row),
		};
	}

	return {
		/** The records grouped by `levels`, each level in first-appearance order; only the matching records when narrowed. */
		group(levels: readonly string[], narrowing?: Narrowing): EngineGroup[] {
			return table(narrowing, { grouping: levels }).getGroupedRowModel().rows.map(toGroup);
		},

		/**
		 * The matching records (sorted when `sort` is set, nulls last either way, ties in source order), their sums, and for each
		 * facet field its values' counts among the records that match everything except that field's own filter.
		 */
		query(
			narrowing: Narrowing,
			sort: { field: string; desc: boolean } | null,
			facets: readonly string[],
		) {
			const t = table(narrowing, { sort });
			const rows = t.getSortedRowModel().rows;
			const sums: Record<string, Sum> = {};
			for (const key of sumKeys) {
				const value = t.getColumn(key)?.getAggregationValue({ rows });
				sums[key] = isSum(value) ? value : { total: null, missing: 0 };
			}
			const counts: Record<string, ReadonlyMap<unknown, number>> = {};
			for (const key of facets) {
				counts[key] = t.getColumn(key)?.getFacetedUniqueValues() ?? new Map();
			}
			return { items: rows.map((row) => row.original), sums, counts };
		},
	};
}

/** The engine's interface, for the modules that receive one. */
export type Engine = ReturnType<typeof createEngine>;
