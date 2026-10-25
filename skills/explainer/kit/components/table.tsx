/* Table: a comparison table computed from records, its numbers formatted and aligned, as a Markdown table renders.
   <Table rows={fixes} cols={[{ head: "Fix", value: "name", link: (f) => `#fix/${f.id}` }, { head: "Wait", value: "wait", format: { digits: 1, unit: "min" } }]} />
     rows   the records, one row each
     cols   one per column; the first one names the rows
       head    the column's name, also its label beside each value on phones
       value   the record's key, or (record) => text, number or JSX
       format  how the numbers are written in the page's lang: { digits: 1 }, { unit: "min" }, { percent: true }, { currency: "EUR" }.
               A column whose values are all numbers is numeric: right-aligned on wide screens
       link    the key, or (record) => href, that makes each value a link
       note    the key, or (record) => text, of a muted line under the value
     state   (record) => "fit", "maybe" or "out": fit and maybe rows get a coloured edge, out rows are muted
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
	id?: string;
}

/** What a field gives for one record. */
function read<Row, Value>(row: Row, field: Field<Row, Value>): Value {
	return typeof field === "function" ? field(row) : (row[field] as Value);
}

/** Whether every value a column shows is a number (empty cells aside), which makes it a numeric column. */
const numeric = (values: unknown[]) =>
	values.some((value) => typeof value === "number") &&
	values.every((value) => value == null || typeof value === "number");

/** One column's cells, written once for every row. */
function columnCells<Row>(rows: readonly Row[], col: TableColumn<Row>) {
	const values = rows.map((row) => read(row, col.value));
	const text = numberText(col.format);
	const cells = rows.map((row, i) => {
		const value = values[i];
		const href = col.link && read(row, col.link);
		const shown = typeof value === "number" ? text(value) : value;
		const note = col.note && read(row, col.note);
		return (
			<>
				{href ? <a href={href}>{shown}</a> : shown}
				{note != null && note !== "" && <span class="why">{note}</span>}
			</>
		);
	});
	return { num: numeric(values), cells };
}

/**
 * Renders `table.compare` as a Markdown table does (src/mdx/compile.ts): each row's first cell is `<th scope="row">`, every
 * other cell carries its column's head as `data-label`, and a numeric column is `class="num"` on its header and cells.
 */
export function Table<Row>({ rows, cols, state, id }: TableProps<Row>) {
	const columns = cols.map((col) => ({ head: col.head, ...columnCells(rows, col) }));
	const num = (column: { num: boolean }) => (column.num ? "num" : undefined);
	return (
		<table class="compare" id={id}>
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
						{columns.map((column, c) =>
							c === 0 ? (
								<th class={num(column)} scope="row">
									{column.cells[i]}
								</th>
							) : (
								<td class={num(column)} data-label={column.head}>
									{column.cells[i]}
								</td>
							),
						)}
					</tr>
				))}
			</tbody>
		</table>
	);
}
