/**
 * Entry for vendor/table-core.js (`bun run vendor`): the parts of TanStack Table that the records core uses, and nothing else,
 * so the bundle carries only these features. To use another one, export it here and rebuild; vendor/table-core.d.ts is this
 * file's text, so the types always name exactly what the bundle exports.
 */
export type * from "@tanstack/table-core";
export {
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
	rowAggregationFeature,
	rowSortingFeature,
	tableFeatures,
} from "@tanstack/table-core";
export { storeReactivityBindings } from "@tanstack/table-core/store-reactivity-bindings";
