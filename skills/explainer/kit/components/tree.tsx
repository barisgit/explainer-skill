/* Tree: one complete list of hierarchical records (phases > groups > items) as the kit's .tree, opened level by level (kit views.js).
   <Tree items={plan.phases} row={(r) => ({ label: r.name, cells: [`${r.hours} h`, r.owner], items: r.tasks, text: r.note })} />
     items  the top-level records
     row    (record) => its row; leave it out when the records already have this shape:
              label  the row's name
              cells  its numbers, in columns that line up across rows and levels. Give every row the same cells in the same order,
                     units included; null keeps a column empty, and a row with fewer cells gets empty ones at the end
              items  the records one level in
              text   what a leaf opens to: text or JSX
              href   a link to the item's view ("#task/1.1.3") that stands as the row in place of a fold; its label names the view
                     in the navigation
              id     lets a link elsewhere open that branch: <a href="#spike">Spike boards: 4 tasks, 70 h</a>
              ref    data-ref on the row: with kit:link.js the row lights, and a closed fold that holds a lit row is tinted too
     cell   the width of a number column (--tree-cell: 5rem, 4rem on phones)
   The tree starts collapsed to its top level, and the deepest rows open in place to their text. A section with the tree gets
   Expand all, which opens every level. Trees print fully open. */
import type { ComponentChildren, JSX } from "preact";

/** One row of a tree, as `row` returns it for a record; `items` are the records one level in. */
export interface TreeRow<Item> {
	label: ComponentChildren;
	cells?: ComponentChildren[];
	items?: Item[];
	text?: ComponentChildren;
	href?: string;
	id?: string;
	ref?: string;
}

/** A record that is already a row. */
export interface TreeItem extends TreeRow<TreeItem> {}

interface Common {
	id?: string;
	cell?: string;
}
export type TreeProps<Item> = Common &
	(
		| { items: TreeItem[]; row?: undefined }
		| { items: Item[]; row: (record: Item) => TreeRow<Item> }
	);

/** A row with the rows one level in, built before rendering so every row can get the tree's column count. */
interface Built {
	row: TreeRow<unknown>;
	children: Built[];
}

function build<Item>(records: Item[], row: (record: Item) => TreeRow<Item>): Built[] {
	return records.map((record) => {
		const built = row(record);
		return { row: built, children: build(built.items ?? [], row) };
	});
}

const columnsOf = (rows: Built[]): number =>
	Math.max(
		0,
		...rows.map(({ row, children }) => Math.max(row.cells?.length ?? 0, columnsOf(children))),
	);

/** The row's cells as views.js and the theme read them: the label, then `columns` number cells, empty ones kept. */
function cellsOf(row: TreeRow<unknown>, columns: number): JSX.Element[] {
	const cells = Array.from({ length: columns }, (_, i) => row.cells?.[i] ?? null);
	return [
		<span key="label">{row.label}</span>,
		...cells.map((cell, i) => <span key={i}>{cell}</span>),
	];
}

/** A link row, or a fold that opens to the text and the rows one level in. A row that would open to nothing fails the pack. */
function Row({ built, columns }: { built: Built; columns: number }) {
	const { row, children } = built;
	const opens = children.length > 0 || (row.text !== undefined && row.text !== null);
	if (row.href !== undefined) {
		if (opens) {
			throw new Error(
				`Tree row "${String(row.label)}" has an href and items or text: a row is a link or a fold`,
			);
		}
		return (
			<a href={row.href} id={row.id} data-ref={row.ref}>
				{cellsOf(row, columns)}
			</a>
		);
	}
	if (!opens) {
		throw new Error(
			`Tree row "${String(row.label)}" has no items, text or href: give it what it opens to, or a link`,
		);
	}
	return (
		<details id={row.id}>
			<summary data-ref={row.ref}>{cellsOf(row, columns)}</summary>
			{typeof row.text === "string" ? <p>{row.text}</p> : row.text}
			{children.map((child, i) => (
				<Row key={i} built={child} columns={columns} />
			))}
		</details>
	);
}

/** Renders `<div class="tree">` of nested `<details>`, one per record, all closed. */
export function Tree<Item>(props: TreeProps<Item>) {
	const rows = props.row ? build(props.items, props.row) : build(props.items, (item) => item);
	const columns = columnsOf(rows);
	return (
		<div class="tree" id={props.id} style={props.cell ? `--tree-cell: ${props.cell}` : undefined}>
			{rows.map((built, i) => (
				<Row key={i} built={built} columns={columns} />
			))}
		</div>
	);
}
