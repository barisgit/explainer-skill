/* Table: a fixed comparison of a few records: JSX cells, notes, fit/maybe/out rows, numbers aligned as in a Markdown table.
   <Table rows={fixes} cols={[{ head: "Fix", value: "name", link: (f) => `#fix/${f.id}` }, { head: "Wait", value: "wait", format: { digits: 1, unit: "min" } }]} />
     rows   the records, one row each
     cols   one per column; the first one names the rows
       head    the column's name
       value   the record's key, or (record) => text, number or JSX
       format  how the numbers are written in the page's lang: { digits: 1 }, { unit: "min" }, { percent: true }, { currency: "EUR" }
               (grouped as 4,200, without cents on a whole amount unless digits asks; digits: 0 rounds to whole units). A column whose values are all numbers is numeric: right-aligned, digits lined up
       link    the key, or (record) => href, that makes each value a link
       note    the key, or (record) => text, of a muted line under the value, such as a status mark's reason (kit theme)
     state   (record) => "fit", "maybe" or "out": fit and maybe rows get a coloured edge, out rows are muted
     class   more classes after "compare"
   On a phone a table of two columns (a list of names and values) stacks each name over its value under the stacked column heads;
   a wider one scrolls sideways, its first column staying in view.
   To ask which row the reader picks, give the same rows and cols to a Question (kit Question).
   Rendered when the page packs, so it shows before scripts run and prints. */
import type { ComponentChildren } from "preact";
import { numberText } from "./parts/format.ts";

/** A cell's content: the record's key, or what a function of the record returns. */
type Field<Row, Value> = (keyof Row & string) | ((row: Row) => Value);

/** One column of a Table. */
export interface TableColumn<Row> {
	head: string;
	value: Field<Row, ComponentChildren>;
	format?: NumberFormat;
	link?: Field<Row, string | undefined>;
	note?: Field<Row, ComponentChildren>;
}

export interface TableProps<Row> {
	rows: readonly Row[];
	cols: readonly TableColumn<Row>[];
	state?: (row: Row) => "fit" | "maybe" | "out" | undefined;
	class?: string;
	id?: string;
}

/** What a field gives for one record. */
export function read<Row, Value>(row: Row, field: Field<Row, Value>): Value {
	return typeof field === "function" ? field(row) : (row[field] as Value);
}

/** Whether every value a column shows is a number (empty cells aside), which makes it a numeric column. */
const numeric = (values: unknown[]) =>
	values.some((value) => typeof value === "number") &&
	values.every((value) => value == null || typeof value === "number");

/** One column's cells, written once for every row: the value (a link when it has one) and the muted note under it. */
function columnCells<Row>(rows: readonly Row[], col: TableColumn<Row>) {
	const values = rows.map((row) => read(row, col.value));
	const text = numberText(col.format);
	const cells = rows.map((row, i) => {
		const value = values[i];
		const href = col.link && read(row, col.link);
		const shown = typeof value === "number" ? text(value) : value;
		const note = col.note && read(row, col.note);
		return {
			value: href ? <a href={href}>{shown}</a> : shown,
			note: note != null && note !== "" && <span class="why">{note}</span>,
		};
	});
	return { num: numeric(values), cells };
}

/** What a row's first cell shows of its value; a Question over rows puts its choice there. */
export type RowHead = (value: ComponentChildren, index: number) => ComponentChildren;

/**
 * Renders `table.compare` in a `div.scroll` as a Markdown table does (src/mdx/compile.ts): each row's first cell is `<th scope="row">`, every
 * other cell carries its column's head as `data-label`, and a numeric column is `class="num"` on its header and cells.
 * `head` writes each row's first value (the row's name), before that cell's note; `stack` marks the table `data-stack`, which
 * stacks each row on a phone.
 */
export function compareTable<Row>(
	{ rows, cols, state, class: classes, id }: TableProps<Row>,
	head: RowHead = (value) => value,
	stack = false,
) {
	const columns = cols.map((col) => ({ head: col.head, ...columnCells(rows, col) }));
	const num = (column: { num: boolean }) => (column.num ? "num" : undefined);
	return (
		<div class="scroll">
			<table
				class={classes ? `compare ${classes}` : "compare"}
				id={id}
				data-stack={stack ? "" : undefined}
			>
				<thead>
					<tr>
						{columns.map((column) => (
							<th class={num(column)}>{column.head}</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row, i) => (
						<tr data-state={state?.(row)}>
							{columns.map((column, c) => {
								const { value, note } = column.cells[i] ?? {};
								return c === 0 ? (
									<th class={num(column)} scope="row">
										{head(value, i)}
										{note}
									</th>
								) : (
									<td class={num(column)} data-label={column.head}>
										{value}
										{note}
									</td>
								);
							})}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/** A comparison table of `rows`: compareTable with each row named by its first value; two columns carry `data-stack`, as in Markdown. */
export function Table<Row>(props: TableProps<Row>) {
	return compareTable(props, undefined, props.cols.length === 2);
}
