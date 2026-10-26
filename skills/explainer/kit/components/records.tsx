/* Records: one collection as a grouped tree, sortable table or board; search, facets, subtotals and item links. Static until controls need code.
   <Records {...plan} />, plan being the config as JSON, or a .ts module checked with satisfies RecordsProps (from "kit"):
     id        the block's element id, its URL hash (#plan?view=table&q=board) and the start of its groups' anchors (#plan.1.wp1)
     data      the records, one flat object each; their order is the order everywhere until a table header sorts
     idField   the key that names each record uniquely
     fields    each key the block reads, as { label, kind }: kind "text", "number" (unit, digits, sum), "currency" (currency: "EUR",
               digits, sum), "date" (values as YYYY-MM-DD) or "category" (values: [{ value, label, color: "var(--c1)" }], in order)
     columns   the fields of a row, in order; the leading text ones (an id, a title) form its label
     groupBy   the fields of the tree's levels, outermost first (phase, then package); the board's lanes are the first
     groups    [{ path: ["1"], title, description }]: a group's own title and a line under it
     views     "tree", "table", "board", the first shown first; unset, the tree when there is groupBy, else the table
     sort      { field, desc }: the table's first order; headers sort on click
     search    the fields a search box looks in
     facets    category or text fields to filter by: a button per value with its count
     link      a filled View's name: each row links to #<link>/<id>, and the view's previous/next go through the rows shown
     detail    a text field a row opens to in place in every view (instead of link); Expand all opens these too
     refField  a field whose value is the row's data-ref (kit link)
   A field with sum: true adds subtotals to groups and lanes, and a total, shown as ≥ when records without a value leave them
   out, or ? when none has one. The view, sort, search, filters and open folds go in the URL hash, so a link opens what the reader saw,
   and a link of your own applies a state: <a href="#plan?f.owner=JV">JV's work</a>. Inside a View the state follows its route:
   #team?crew?view=table.
   A tree or board alone, with no search or facets, is static markup. Otherwise it is an island that carries the data as JSON, a
   second copy beside a filled View of the same records; its controls show once the script runs, and before that the default
   view reads as it is. pack checks the config and names the path of each problem (fields.hours.kind),
   and fails on a link that names no View and on a block id that is a View's name. It prints as the whole
   tree. */
import { createRecords, type RecordsConfig } from "../records/index.ts";
import { pageLabels, pageLang } from "./parts/format.ts";
import { RecordsIsland } from "./parts/records-island.tsx";
import { RecordsBlock } from "./parts/records-view.tsx";

/** Records' props: the records config, checked by pack. */
export type RecordsProps = RecordsConfig;

/**
 * Renders `div.records.wide`: the default view at pack time, as static markup when the block has nothing to choose, else inside
 * the client island that adds the controls and keeps the state in the URL hash. A bad config fails the pack with every problem.
 */
export function Records(props: RecordsProps) {
	const records = createRecords(props, { locale: pageLang(), labels: pageLabels() });
	const vm = records.view();
	const controls =
		vm.views.length > 1 || vm.searchable || vm.facets.length > 0 || vm.body.kind === "table";
	return controls ? <RecordsIsland config={props} /> : <RecordsBlock vm={vm} />;
}
