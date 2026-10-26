/**
 * The view model: everything a renderer draws for one records block in one state, decided and formatted, so the static block
 * and the island draw it (kit/components/parts/records-view.tsx) without logic of their own. Every control carries the state
 * it leads to (`next`, `toggle`, `clear`), so a renderer only hands that back. Ids are stable across edits of other records: a
 * group's id comes from its values, an item's from its id field.
 */
import type { FieldKind, Value, ViewKind } from "./config.ts";
import type { RecordsState } from "./state.ts";

/** One cell of a row, a group or a total. An empty cell has text "" and keeps its column. */
export interface Cell {
	field: string;
	/** The raw value, a sum for a group or total cell; null when unknown or not summed. */
	value: Value;
	/** The value as the reader sees it, in the page's locale with its unit or currency. */
	text: string;
	/** A category value's marker colour. */
	swatch?: string;
	/**
	 * A sum over records some of which have no value in the field, in words ("at least 1,372 h, 3 without a value"), for screen
	 * readers and the tooltip; `text` then reads "≥ 1,372 h", or "?" when none of them has a value, since unknown is not zero.
	 */
	incomplete?: string;
}

/** One column of a view. */
export interface Column {
	field: string;
	label: string;
	kind: FieldKind;
	/** Numbers at the end, so their digits line up. */
	align: "start" | "end";
	/** Whether groups and the total show a sum in this column. */
	sum: boolean;
}

/** A table column header, which sorts the table. */
export interface Header extends Column {
	/** How the table is sorted by this column now. */
	sort: "asc" | "desc" | null;
	/** The state after the reader activates the header: ascending, then descending, then source order. */
	next: RecordsState;
}

/** One record's row or card. `cells` line up with the view's columns; the first labels it. */
export interface ItemRow {
	kind: "item";
	id: string;
	/** The item's own view (`#item/WP1-02`), when the config has a link. */
	href?: string;
	/** The text the row opens to in place (config `detail`), in every view; absent when the record has none. */
	detail?: string;
	/** Whether the detail is shown open (state `details`); false without one. */
	open: boolean;
	/** The row's data-ref (config `refField`). */
	ref?: string;
	cells: readonly Cell[];
	/** Whether it matches the search and filters (always true without any); the tree highlights matches, the others hide the rest. */
	match: boolean;
}

/** One group of the tree, a fold that holds its subgroups or, at the last level, its records. */
export interface GroupRow {
	kind: "group";
	/** The group's values along groupBy as slugs joined by `.` (`1.wp1`): what state.open holds. */
	id: string;
	/** The element id for the group, `<block id>.<id>`, which prose links to (`#plan.1.wp1`) to open the branch. */
	anchor: string;
	/** 0 for the outermost level. */
	depth: number;
	/** The groupBy field of this level, and the records' value in it. */
	field: string;
	value: string;
	/** The note's title, else the category value's label, else the value. */
	title: string;
	description?: string;
	swatch?: string;
	/** Shown open: the reader opened it, or a search or filter is active and it holds a match. */
	open: boolean;
	/** Records in the group, and how many of them match. */
	count: number;
	matches: number;
	/** The title, then the group's sums under the summed columns, empty elsewhere: the complete list's subtotals. */
	cells: readonly Cell[];
	/** Subgroups in source order, or at the last level the records in source order. */
	children: readonly (GroupRow | ItemRow)[];
	/** The state with this group's saved fold flipped. */
	toggle: RecordsState;
}

/** The complete list, nested by groupBy, every record in source order whatever the search or filters. */
export interface TreeView {
	kind: "tree";
	columns: readonly Column[];
	groups: readonly GroupRow[];
	/** The label, then the sums over every record. */
	total: readonly Cell[];
	/** Every group and every detail is shown open: Expand all then reads Collapse all. */
	expanded: boolean;
	/** The states with every group and detail open, and with all of them closed. */
	expandAll: RecordsState;
	collapseAll: RecordsState;
}

/** One row per matching record, every column as listed, sorted as the state says. */
export interface TableView {
	kind: "table";
	columns: readonly Header[];
	rows: readonly ItemRow[];
	/** The label, then the sums over the rows shown. */
	total: readonly Cell[];
}

/** One board column: a value of the first groupBy field, with the matching records as cards. */
export interface Lane {
	/** The same id as the tree's top-level group of this value. */
	id: string;
	value: string;
	title: string;
	swatch?: string;
	/** Matching records in the lane, as a number and as the reader sees it, under the label `texts.count`. */
	count: number;
	countText: string;
	/** The title, then the sums over the cards shown. */
	cells: readonly Cell[];
	items: readonly ItemRow[];
}

/** Every value of the first groupBy field as a column (a category's listed values even when empty), cards in source order. */
export interface BoardView {
	kind: "board";
	field: string;
	label: string;
	columns: readonly Column[];
	lanes: readonly Lane[];
}

/** One value the reader can filter by. */
export interface FacetOption {
	value: string;
	text: string;
	swatch?: string;
	/** Records with this value that match the search and the other facets' filters. */
	count: number;
	selected: boolean;
	/** The state with this value's selection flipped. */
	next: RecordsState;
}

export interface Facet {
	field: string;
	label: string;
	options: readonly FacetOption[];
}

export interface ViewOption {
	kind: ViewKind;
	label: string;
	current: boolean;
	next: RecordsState;
}

/** The kit texts of the block's controls, in the page's language. */
export interface RecordsTexts {
	/** The view switcher's accessible name. */
	view: string;
	search: string;
	noMatches: string;
	clear: string;
	expandAll: string;
	collapseAll: string;
	/** What a board lane's count counts. */
	count: string;
}

/** One records block in one state. */
export interface RecordsView {
	id: string;
	/** The state drawn, with what the block does not allow dropped. */
	state: RecordsState;
	/** The state's URL hash, without `#`; see state.ts for when to write it. */
	hash: string;
	texts: RecordsTexts;
	/** Offered views; one entry means no switcher. */
	views: readonly ViewOption[];
	/** Whether the config gives a search box. */
	searchable: boolean;
	facets: readonly Facet[];
	/** A search or filter is active. */
	filtering: boolean;
	/** Matching records, all records, and the two as the reader sees them ("12 of 96"). */
	shown: number;
	total: number;
	shownText: string;
	/** The state without search and filters, when there are any. */
	clear: RecordsState | null;
	body: TreeView | TableView | BoardView;
}
