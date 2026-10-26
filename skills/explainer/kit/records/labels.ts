/**
 * The English texts of the records controls, by kitLabels key: the Records component's texts, which `kit labels` lists under
 * Records (src/kit.ts reads this block). A page in another language sets the ones it shows in its frontmatter labels;
 * expandAll and collapseAll are the keys kit:views.js uses too, so one entry covers both.
 */
export const LABELS = {
	recordsTree: "Tree",
	recordsTable: "Table",
	recordsBoard: "Board",
	recordsView: "View",
	recordsSearch: "Search",
	recordsTotal: "Total",
	recordsShown: "{shown} of {total}",
	recordsNoMatches: "No matches",
	recordsClear: "Clear filters",
	expandAll: "Expand all",
	collapseAll: "Collapse all",
};

/** A kitLabels key the records controls read. */
export type RecordsLabel = keyof typeof LABELS;
