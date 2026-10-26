/**
 * The records contract: one config object describes a collection of records (tasks, findings, costs) and how a page shows it as
 * a tree, a table or a board. It is plain JSON, so an HTML page can carry it in a `<script type="application/json">` beside its
 * records element and an MDX page can pass it as props, and `pack` can validate it without running the page.
 *
 * The defaults follow the guide: every record in the source's own order, grouped with subtotals; a row shows only the fields
 * readers compare across rows (`columns`), the rest stays in the record for search or the item's own view; a coloured marker
 * comes only from a category field's values, so it always encodes a category and the legend comes with it.
 */

/** A field's value in one record: text, a finite number, a calendar date as `YYYY-MM-DD`, or null (unknown, never zero). */
export type Value = string | number | null;

/**
 * One record of the collection: a `Value` under each key that `fields` declares. Keys no field declares may hold anything (an
 * item's long text, a list of dependencies) and are ignored, so one data file can feed the records and the item views.
 */
export type DataRecord = Readonly<Record<string, unknown>>;

/** The ways the collection can be shown. */
export const VIEW_KINDS = ["tree", "table", "board"] as const;
/**
 * tree: the complete list, nested by `groupBy`, every group with its subtotals; a search or filter highlights the matching
 * records and keeps the rest. table: one flat row per record, sortable; non-matching rows are hidden. board: one column per
 * value of the first `groupBy` field, with the matching records as cards in source order.
 */
export type ViewKind = (typeof VIEW_KINDS)[number];

/** One allowed value of a category field. */
export interface CategoryValue {
	/** The value as the records hold it. */
	value: string;
	/** What the reader sees; the value itself when left out. */
	label?: string;
	/** The marker colour, any CSS colour (`var(--c3)`, `#2a7`); a value without one gets no marker and no legend entry. */
	color?: string;
}

interface FieldBase {
	/** The column header, facet name and group level name the reader sees. */
	label: string;
}

/** Free text, compared with the page language's collation (numbers inside it in numeric order). */
export interface TextField extends FieldBase {
	kind: "text";
}

/** A number, shown in the page language's format. */
export interface NumberField extends FieldBase {
	kind: "number";
	/** Written after the number: "h", "kg", "%". */
	unit?: string;
	/** Fraction digits, fixed. Left out: as many as the value has, up to three. */
	digits?: number;
	/** Groups, the board's columns and the total add this field up. */
	sum?: boolean;
}

/** An amount of money in one currency. */
export interface CurrencyField extends FieldBase {
	kind: "currency";
	/** ISO 4217 code: "EUR", "USD". */
	currency: string;
	/** Fraction digits, fixed. Left out: the currency's own (2 for EUR). */
	digits?: number;
	/** Groups, the board's columns and the total add this field up. */
	sum?: boolean;
}

/** A calendar date, `YYYY-MM-DD` in the data, shown in the page language's medium date format. */
export interface DateField extends FieldBase {
	kind: "date";
}

/**
 * One of a closed set of values, in the order listed: the tree's groups, the board's columns, facets and the legend follow
 * that order, and sorting by the field does too; list them in the source's own order. Groups by a text field keep the order
 * in which their values first appear. A record holding a value that is not listed is a config error.
 */
export interface CategoryField extends FieldBase {
	kind: "category";
	values: readonly CategoryValue[];
}

/** What one field of the records holds and how it is shown. */
export type Field = TextField | NumberField | CurrencyField | DateField | CategoryField;
export type FieldKind = Field["kind"];

/**
 * Text for one group of the tree, which a group's values alone cannot say: the sentence on what it delivers, or a title in
 * place of the value. A group is named by its values along `groupBy`, outermost first, so the same package under two phases is
 * two groups.
 */
export interface GroupNote {
	path: readonly string[];
	/** Shown in place of the value (or the category value's label). */
	title?: string;
	/** One sentence on what the group is or delivers, shown where the group opens. */
	description?: string;
}

/** A sort by one field. */
export interface SortSpec {
	field: string;
	/** Largest, latest or last first. */
	desc?: boolean;
}

/** The config of one records block. */
export interface RecordsConfig {
	/**
	 * The block's name, unique on the page: letters, digits, `-` and `_`, starting with a letter. It keys the block's state in the
	 * URL (`#plan?view=table`) and prefixes its anchors (`#plan.1.wp1`), so it must not also be a view name of the page.
	 */
	id: string;
	/** The records, in the source's own order (its numbering, sequence or chronology); that order is the default everywhere. */
	data: readonly DataRecord[];
	/** The field that holds each record's unique id (a string or number); it names the item's view and its URL. */
	idField: string;
	/**
	 * Every field the block reads, by key: a plain name (letters, digits, `-` and `_`, starting with a letter), the same key as
	 * in the records. A field is shown only when `columns` names it.
	 */
	fields: Readonly<Record<string, Field>>;
	/**
	 * The fields a row shows, in order; the first names the record and holds the titles of groups, lanes and the total, so it is
	 * neither a `groupBy` field nor summed. Name only what readers compare across rows: the rest belongs in the item's own view.
	 * The tree leaves the `groupBy` fields out of its rows and the board the lane's field out of its cards, since the groups show
	 * them; the flat table shows them where they are listed.
	 */
	columns: readonly string[];
	/** Grouping levels, outermost first (phase, then package): the tree's levels; the first one is the board's columns. */
	groupBy?: readonly string[];
	/** Titles and descriptions of particular groups. */
	groups?: readonly GroupNote[];
	/** The views offered, the first shown by default. Left out: the tree when there is a `groupBy`, else the table. */
	views?: readonly ViewKind[];
	/**
	 * The table's order when the ranking is the answer (the largest costs first); say so in the heading. Left out: source
	 * order, which the reader can change by sorting a column. The tree and the board always keep source order.
	 */
	sort?: SortSpec;
	/** Fields the search box looks in. Left out: no search box. */
	search?: readonly string[];
	/** Text or category fields the reader can filter by, each value with its count; empty text counts as no value. */
	facets?: readonly string[];
	/**
	 * The view an item opens: with `"item"`, a row links to `#item/<id>`, the kit's views route, where the item's full text is. The
	 * page writes that View (one filled from the same data, for many records).
	 */
	link?: string;
	/** A text field an item row opens to in place, for records whose full text is a sentence or two; not with `link`. */
	detail?: string;
	/**
	 * A text or category field whose value is each item row's `data-ref`, so the row lights with the prose and diagram parts that
	 * share it (kit link). Not `ref`, which Preact keeps for itself.
	 */
	refField?: string;
}
