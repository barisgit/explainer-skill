/* Tree: one complete list of hierarchical records (phases > groups > items), opened level by level, numbers in aligned columns.
   <Tree items={plan.phases} cols="4rem 4rem" head={["Task", "Hours", "Owner"]}
     row={(r) => ({ label: r.name, cells: [`${r.hours} h`, r.owner], items: r.tasks, text: r.note })} />
     items  the top-level records
     row    (record) => its row (type: TreeRow<Record> from "kit"); leave it out when the records already have this shape
            (type: TreeItem):
              label  the row's name
              cells  its numbers, in columns that line up across rows and levels. Give every row the same cells in the same order,
                     units included; null keeps a column empty, and a row with fewer cells gets empty ones at the end
              items  the records one level in
              text   what a leaf opens to: text or JSX
              href   a link to the item's view ("#task/1.1.3") that stands as the row in place of a fold; its label names the view
                     in the navigation
              id     lets a link elsewhere open that branch: <a href="#spike">Spike boards: 4 tasks, 70 h</a>
              ref    data-ref on the row: with kit:link.js the row lights, and a closed fold that holds a lit row is tinted too
     cols   one width per number column (--tree-cols). Unset, each is 5rem, narrower where a deep row on a phone has no room
     head   the names of the label and of each column, over the rows
   Labels and cells take JSX: <span class="chip" style="--swatch: var(--c2)"><i></i>Firmware</span> marks a category; a
   <p class="legend"> of them over the records keys each category once, and rows repeat the marker with its word or a short form:
   colour alone does not tell the categories apart for every reader.
   The tree starts collapsed to its top level, and the deepest rows open in place to their text. On phones a row with two or more
   numbers puts them on a line under its label, in the same columns: at the third level a 360-pixel phone leaves about 16rem for
   them and their 0.5rem gaps, and a width written as minmax(0, 4rem) gives way where they do not fit. A section with the tree gets
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
	/** --tree-cols: one width per number column. */
	cols?: string;
	/** The label's name, then each column's. */
	head?: ComponentChildren[];
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
function cellsOf(
	label: ComponentChildren,
	cells: ComponentChildren[] | undefined,
	columns: number,
): JSX.Element[] {
	const padded = Array.from({ length: columns }, (_, i) => cells?.[i] ?? null);
	return [
		<span key="label">{label}</span>,
		...padded.map((cell, i) => <span key={i}>{cell}</span>),
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
				{cellsOf(row.label, row.cells, columns)}
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
			<summary data-ref={row.ref}>{cellsOf(row.label, row.cells, columns)}</summary>
			{typeof row.text === "string" ? <p>{row.text}</p> : row.text}
			{children.map((child, i) => (
				<Row key={i} built={child} columns={columns} />
			))}
		</details>
	);
}

/** Renders `<div class="tree">` of nested `<details>`, one per record, all closed, under a `.tree-head` when `head` is given. */
export function Tree<Item>(props: TreeProps<Item>) {
	const rows = props.row ? build(props.items, props.row) : build(props.items, (item) => item);
	const [label, ...names] = props.head ?? [];
	const columns = Math.max(columnsOf(rows), names.length);
	return (
		<div class="tree" id={props.id} style={props.cols ? `--tree-cols: ${props.cols}` : undefined}>
			{props.head && <div class="tree-head">{cellsOf(label, names, columns)}</div>}
			{rows.map((built, i) => (
				<Row key={i} built={built} columns={columns} />
			))}
		</div>
	);
}
