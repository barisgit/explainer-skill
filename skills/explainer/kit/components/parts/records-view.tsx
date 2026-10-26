/* Records' markup (see ../records.tsx): one pure render of a view model from kit/records, shared by the static block and the
   client island, so pack's prerender and the island's first render are the same markup. Without `actions` it renders no
   controls and no handlers: the static block. */
import type { ComponentChildren, JSX, Ref } from "preact";
import type {
	BoardView,
	Cell,
	Column,
	Facet,
	GroupRow,
	ItemRow,
	RecordsState,
	RecordsTexts,
	RecordsView,
	TableView,
	TreeView,
} from "../../records/index.ts";

/** What the island does when the reader uses a control; each takes the state the view model computed for it. */
export interface RecordsActions {
	go(next: RecordsState): void;
	search(text: string): void;
	/** A group fold was opened or closed by the reader (or by the page), with its open state now. */
	groupToggled(group: string, open: boolean): void;
	/** A record's detail was opened or closed, with its open state now. */
	detailToggled(id: string, open: boolean): void;
}

interface Context {
	actions: RecordsActions | undefined;
	texts: RecordsTexts;
	filtering: boolean;
	/** How many leading columns form the row's label: the run of text columns (an id and a title), at least one. */
	lead: number;
	/** The tree's columns that are not numbers (owners, categories, dates): on phones the tree leaves them to the other views. */
	tags: ReadonlySet<string>;
}

/** Each column's width in the tree by kind, as minmax(0, x): it gives way on a phone rather than scrolling. */
const WIDTHS: Record<Column["kind"], string> = {
	text: "10rem",
	number: "4.5rem",
	currency: "6rem",
	date: "7rem",
	category: "9.5rem",
};

const widths = (columns: readonly Column[]) =>
	columns.map((c) => `minmax(0, ${WIDTHS[c.kind]})`).join(" ");

const isTag = (c: Column) => c.align === "start";

const swatchStyle = (swatch: string) => `--swatch: ${swatch}`;

/**
 * A cell's text; a category value with a colour is a chip with its marker. An incomplete sum shows its short form (≥ 1,372 h)
 * with the words as its tooltip, and screen readers read the words alone.
 */
function cellText(cell: Cell): JSX.Element | string {
	if (cell.incomplete) {
		return (
			<span class="incomplete">
				<span aria-hidden="true" title={cell.incomplete}>
					{cell.text}
				</span>
				<span class="vh">{cell.incomplete}</span>
			</span>
		);
	}
	return cell.swatch ? (
		<span class="chip" style={swatchStyle(cell.swatch)}>
			<i />
			{cell.text}
		</span>
	) : (
		cell.text
	);
}

/** The leading text cells joined into one label, as views' navigation reads a row's first cell. */
const labelOf = (cells: readonly Cell[], lead: number) =>
	cells
		.slice(0, lead)
		.map((c) => c.text)
		.filter(Boolean)
		.join(" ");

/** A tree row's cells as the theme lays them out: the label, then one cell per remaining column. */
function rowCells(cells: readonly Cell[], ctx: Context, label?: JSX.Element): JSX.Element[] {
	return [
		<span key="label">{label ?? labelOf(cells, ctx.lead)}</span>,
		...cells.slice(ctx.lead).map((cell) => (
			<span key={cell.field} class={ctx.tags.has(cell.field) ? "tag" : undefined}>
				{cellText(cell)}
			</span>
		)),
	];
}

const missed = (ctx: Context, matches: boolean) => (ctx.filtering && !matches ? "miss" : undefined);

/** An item of the tree: a link to its view, a fold that opens to its detail, or a plain row. */
function TreeItem({ row, ctx }: { row: ItemRow; ctx: Context }) {
	const cells = rowCells(row.cells, ctx);
	const miss = missed(ctx, row.match);
	if (row.href) {
		return (
			<a href={row.href} class={miss} data-ref={row.ref}>
				{cells}
			</a>
		);
	}
	if (row.detail) {
		return (
			<Detail row={row} ctx={ctx} summaryRef={row.ref} class={miss}>
				{cells}
			</Detail>
		);
	}
	return (
		<div class={miss ? `tree-row ${miss}` : "tree-row"} data-ref={row.ref}>
			{cells}
		</div>
	);
}

/**
 * A row's detail as a native disclosure, the same in the tree, a table's first cell and a card: `children` is its summary, and
 * the island keeps whether it is open in the state, so it stays open across views and Expand all reaches it.
 */
function Detail({
	row,
	ctx,
	summaryRef,
	class: className,
	children,
}: {
	row: ItemRow;
	ctx: Context;
	/** The data-ref for the summary, in the tree, where the summary is the row; a table row or card carries its own. */
	summaryRef?: string | undefined;
	class?: string | undefined;
	children: ComponentChildren;
}) {
	const { actions } = ctx;
	return (
		<details
			class={className}
			open={row.open}
			onToggle={
				actions &&
				((event) => actions.detailToggled(row.id, (event.currentTarget as HTMLDetailsElement).open))
			}
		>
			<summary data-ref={summaryRef}>{children}</summary>
			<p>{row.detail}</p>
		</details>
	);
}

function TreeGroup({ group, ctx }: { group: GroupRow; ctx: Context }) {
	const { actions } = ctx;
	const label = (
		<>
			{group.swatch && <i class="swatch" style={swatchStyle(group.swatch)} />}
			{group.title}
		</>
	);
	return (
		<details
			id={group.anchor}
			open={group.open}
			class={missed(ctx, group.matches > 0)}
			onToggle={
				actions &&
				((event) =>
					actions.groupToggled(group.id, (event.currentTarget as HTMLDetailsElement).open))
			}
		>
			<summary>{rowCells(group.cells, ctx, label)}</summary>
			{group.description && <p>{group.description}</p>}
			{group.children.map((child) =>
				child.kind === "group" ? (
					<TreeGroup key={child.id} group={child} ctx={ctx} />
				) : (
					<TreeItem key={child.id} row={child} ctx={ctx} />
				),
			)}
		</details>
	);
}

/** The leading run of text columns, at least one: the label every view shows first. */
function leadOf(columns: readonly Column[]): number {
	const first = columns.findIndex((c) => c.kind !== "text");
	return Math.max(1, first < 0 ? columns.length : first);
}

function Tree({ body, ctx }: { body: TreeView; ctx: Context }) {
	const rest = body.columns.slice(ctx.lead);
	const head = body.columns.slice(0, ctx.lead).map((c) => c.label);
	// Two sets of widths: every column, and on phones only the number columns (09-records.css picks one).
	const style = rest.length
		? `--records-cols: ${widths(rest)}; --records-cols-narrow: ${widths(rest.filter((c) => !isTag(c))) || "0"}`
		: undefined;
	return (
		<div class="tree" style={style}>
			<div class="tree-head">
				<span>{head.join(" · ")}</span>
				{rest.map((c) => (
					<span key={c.field} class={isTag(c) ? "tag" : undefined}>
						{c.label}
					</span>
				))}
			</div>
			{body.groups.map((group) => (
				<TreeGroup key={group.id} group={group} ctx={ctx} />
			))}
			<div class="tree-row total">{rowCells(body.total, ctx)}</div>
		</div>
	);
}

const num = (c: Column) => (c.align === "end" ? "num" : undefined);
const ARIA_SORT = { asc: "ascending", desc: "descending" } as const;

function Table({ body, ctx }: { body: TableView; ctx: Context }) {
	const [first, ...rest] = body.columns;
	const go = ctx.actions?.go;
	return (
		<div class="scroll">
			<table class="compare table">
				<thead>
					<tr>
						{body.columns.map((c) => (
							<th key={c.field} class={num(c)} aria-sort={c.sort ? ARIA_SORT[c.sort] : undefined}>
								{go ? (
									<button type="button" class="sort" onClick={() => go(c.next)}>
										{c.label}
									</button>
								) : (
									c.label
								)}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{body.rows.map((row) => (
						<tr key={row.id} data-ref={row.ref}>
							{row.cells.map((cell, i) => {
								const column = body.columns[i];
								const text = cellText(cell);
								return i === 0 ? (
									<th key={cell.field} class={first && num(first)} scope="row">
										<RowLabel row={row} ctx={ctx}>
											{text}
										</RowLabel>
									</th>
								) : (
									<td key={cell.field} class={column && num(column)} data-label={column?.label}>
										{text}
									</td>
								);
							})}
						</tr>
					))}
				</tbody>
				<tfoot>
					<tr>
						<th scope="row">{body.total[0]?.text}</th>
						{body.total.slice(1).map((cell, i) => {
							const column = rest[i];
							return (
								<td key={cell.field} class={column && num(column)} data-label={column?.label}>
									{cellText(cell)}
								</td>
							);
						})}
					</tr>
				</tfoot>
			</table>
		</div>
	);
}

/** A card's label (a link to its view when it has one), then its other non-empty cells. */
/**
 * A card's or lane's values as a compact list of label and value. Numbers and dates show their label; text and category values
 * name themselves (an owner, a status chip), so their label is there for screen readers only.
 */
function Values({ cells, columns }: { cells: readonly Cell[]; columns: readonly Column[] }) {
	return (
		<dl>
			{cells.map((cell, i) => {
				const column = columns[i];
				if (!(cell.text && column)) {
					return null;
				}
				const named = column.kind === "text" || column.kind === "category";
				return (
					<div key={cell.field}>
						<dt class={named ? "vh" : undefined}>{column.label}</dt>
						<dd>{cellText(cell)}</dd>
					</div>
				);
			})}
		</dl>
	);
}

/** A table row's or card's label: a link to the record's view, the summary of its detail, or plain text. */
function RowLabel({
	row,
	ctx,
	children,
}: {
	row: ItemRow;
	ctx: Context;
	children: ComponentChildren;
}) {
	if (row.href) {
		return <a href={row.href}>{children}</a>;
	}
	return row.detail ? (
		<Detail row={row} ctx={ctx}>
			{children}
		</Detail>
	) : (
		children
	);
}

function Card({ row, columns, ctx }: { row: ItemRow; columns: readonly Column[]; ctx: Context }) {
	const { lead } = ctx;
	const label = (
		<RowLabel row={row} ctx={ctx}>
			{labelOf(row.cells, lead)}
		</RowLabel>
	);
	return (
		<li data-ref={row.ref}>
			{row.detail && !row.href ? label : <p>{label}</p>}
			<Values cells={row.cells.slice(lead)} columns={columns.slice(lead)} />
		</li>
	);
}

function Board({ body, ctx }: { body: BoardView; ctx: Context }) {
	const count: Column = {
		field: "",
		label: ctx.texts.count,
		kind: "number",
		align: "end",
		sum: false,
	};
	return (
		<div class="board">
			{body.lanes.map((lane) => (
				<div key={lane.id} class="lane">
					<div class="lane-head">
						<p>
							{lane.swatch && <i class="swatch" style={swatchStyle(lane.swatch)} />}
							{lane.title}
						</p>
						<Values
							cells={[
								{ field: "", value: lane.count, text: lane.countText },
								...lane.cells.slice(1),
							]}
							columns={[count, ...body.columns.slice(1)]}
						/>
					</div>
					<ul>
						{lane.items.map((row) => (
							<Card key={row.id} row={row} columns={body.columns} ctx={ctx} />
						))}
					</ul>
				</div>
			))}
		</div>
	);
}

function Toolbar({
	vm,
	actions,
	live,
}: {
	vm: RecordsView;
	actions: RecordsActions;
	live: boolean;
}) {
	const { texts, body } = vm;
	const expanded = body.kind === "tree" && body.expanded;
	return (
		<div class="toolbar" hidden={!live}>
			{vm.views.length > 1 && (
				<div class="seg" role="radiogroup" aria-label={texts.view}>
					{vm.views.map((v) => (
						<label key={v.kind}>
							<input
								type="radio"
								name={`${vm.id}-view`}
								checked={v.current}
								onChange={() => actions.go(v.next)}
							/>
							<span>{v.label}</span>
						</label>
					))}
				</div>
			)}
			{vm.searchable && (
				<input
					type="search"
					aria-label={texts.search}
					placeholder={texts.search}
					value={vm.state.search}
					onInput={(event) => actions.search((event.currentTarget as HTMLInputElement).value)}
				/>
			)}
			<output aria-live="polite">{vm.shown === 0 ? texts.noMatches : vm.shownText}</output>
			{vm.clear && (
				<button type="button" class="reset" onClick={() => vm.clear && actions.go(vm.clear)}>
					{texts.clear}
				</button>
			)}
			{body.kind === "tree" && (
				<button
					type="button"
					class="expand fold-all"
					aria-expanded={expanded}
					onClick={() => actions.go(expanded ? body.collapseAll : body.expandAll)}
				>
					{expanded ? texts.collapseAll : texts.expandAll}
				</button>
			)}
		</div>
	);
}

/** One facet's values as toggle buttons with their counts; values of a facet combine with OR, facets with AND. */
function FacetGroup({ facet, actions }: { facet: Facet; actions: RecordsActions }) {
	return (
		<fieldset>
			<legend>{facet.label}</legend>
			{facet.options.map((o) => (
				<button
					key={o.value}
					type="button"
					aria-pressed={o.selected}
					onClick={() => actions.go(o.next)}
				>
					{o.swatch && <i class="swatch" style={swatchStyle(o.swatch)} />}
					{o.text} <span class="count">{o.count}</span>
				</button>
			))}
		</fieldset>
	);
}

/**
 * The block: `div.records.wide` holding the controls (with `actions`) and the view shown. It draws no legend: every coloured
 * marker sits beside its own word (a group's or lane's title, a facet's or a cell's value).
 * `live` shows the controls, which the island turns on once it runs, so a page read without script shows no dead ones; `root`
 * is the block's element.
 */
export function RecordsBlock({
	vm,
	actions,
	live = false,
	root,
}: {
	vm: RecordsView;
	actions?: RecordsActions;
	live?: boolean;
	root?: Ref<HTMLDivElement>;
}) {
	const { body } = vm;
	const ctx: Context = {
		actions,
		texts: vm.texts,
		filtering: vm.filtering,
		lead: leadOf(body.columns),
		tags: new Set(body.kind === "tree" ? body.columns.filter(isTag).map((c) => c.field) : []),
	};
	return (
		<div ref={root ?? null} class="records wide" id={vm.id} data-records={actions ? "" : undefined}>
			{actions && <Toolbar vm={vm} actions={actions} live={live} />}
			{actions && vm.facets.length > 0 && (
				<div class="facets" hidden={!live}>
					{vm.facets.map((facet) => (
						<FacetGroup key={facet.field} facet={facet} actions={actions} />
					))}
				</div>
			)}
			{body.kind === "tree" ? (
				<Tree body={body} ctx={ctx} />
			) : body.kind === "table" ? (
				<Table body={body} ctx={ctx} />
			) : (
				<Board body={body} ctx={ctx} />
			)}
		</div>
	);
}
