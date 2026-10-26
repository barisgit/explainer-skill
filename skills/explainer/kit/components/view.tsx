/* View: a drill-down view at #name or #name/param inside the one file, with Back, breadcrumbs, previous/next and a contents rail.
   <View name="person" param="ana" back="Team">

   # Ana Novak

   Leads the firmware work.

   ## Tasks
   ...
   </View>
     name    the view's name: a link to #name (or #name/param) opens it
     param   the record this view shows (#person/ana); leave it out for a single view at #name. Pass the id as it is; a link
             escapes ? # % the way encodeURIComponent does: id "a?b" opens at #person/a%3Fb, what follows a route's first ? being
             the state of what the view holds
     back    the text of its Back link, naming the overview
   Its # and the paragraphs right under it are the view's head (the first one its lede), and each ## starts a section, as on
   the page. pack puts every View after the overview wherever the page renders it, so one View per record works from data:
   {people.map((p) => <View name="person" param={p.id} back="Team"><h1>{p.name}</h1><p>{p.role}</p><section>...</section></View>)}
   That is a static view: its markup is in the page once per record, and it prints. For a dozen records or more, fill one view instead:
   <View name="item" records={items} render={Item} back="Plan" />
     records  the records, each with an id: #item/<id> opens it. They reach the browser as JSON, once
     render   a function component from your "use client" module, given { record }. It returns the view's content: an <h1>, the
              paragraphs of its head, then <section>s, each with its <h2>
   Only the open record is drawn, so a filled view prints only while it is open. A control in it is kept like any other when its id
   names the record: id={`note-${record.id}`}. pack draws every record once and fails on an id one repeats or shares with the page.
   Navigation needs no markup of its own. Link every view from the overview with a table or list whose link text names it
   briefly ("Ana", "1.6.3 Login form"): the crumbs and previous/next show that text, and a generic one ("Open") gives way to the
   view's heading. Previous and next walk the views of its kind (the ones the view it was opened from links to, else all of
   them); a page with views inside views (two or more view names) gets a contents rail of its sections. A section with two or
   more folds gets Expand all. A View belongs to the page: put client components inside it, not a View inside a client component
   or a record. */
import { type ComponentChildren, h } from "preact";
import { type Fillable, viewBody } from "./view-body.ts";

/** A record of a filled view: its id is the param that opens it. */
export interface ViewRecord {
	id: string | number;
}

interface Common {
	name: string;
	back?: string;
	id?: string;
}

/** A static view: its content is written in the page. */
export interface StaticViewProps extends Common {
	param?: string;
	children?: ComponentChildren;
}

/** A filled view: `render` draws the open record of `records` in the browser. */
export interface FilledViewProps<T extends ViewRecord> extends Common {
	records: readonly T[];
	render: (props: { record: T }) => ComponentChildren;
}

export type ViewProps<T extends ViewRecord = ViewRecord> = StaticViewProps | FilledViewProps<T>;

/** A static view's route: a ? # or % in its param escaped, so the data-view is the hash that opens it (#name/a%3Fb). */
const route = (name: string, param: string) =>
	`${name}/${param.replace(/[%?#]/g, encodeURIComponent)}`;

/** The element pack moves, with its content, after the overview (hoistViews in src/mdx/page.ts); it never reaches the page. */
const VIEW_MARKER = "explainer-view";

/** The records by param, failing on a record without an id or an id two records share. */
function byParam(name: string, records: readonly ViewRecord[]): Record<string, unknown> {
	const found: Record<string, unknown> = {};
	for (const [i, record] of records.entries()) {
		const id: unknown = record?.id;
		if (typeof id !== "string" && typeof id !== "number") {
			throw new Error(
				`<View name="${name}" records>: record ${i} has no id; give each record an id, the param that opens it (#${name}/<id>)`,
			);
		}
		if (String(id) in found) {
			throw new Error(`<View name="${name}" records>: two records have the id "${id}"`);
		}
		found[String(id)] = record;
	}
	return found;
}

/** The section of a filled view: empty in the page, drawn by its island when the reader opens a record. */
function filledView<T extends ViewRecord>({ name, records, render, back, id }: FilledViewProps<T>) {
	const fill = (render as Partial<Fillable>).fill;
	if (typeof fill !== "function") {
		throw new Error(
			`<View name="${name}" render>: render must be a component from a module whose first line is "use client", since it draws in the browser`,
		);
	}
	fill(name, { records: byParam(name, records), ...(back === undefined ? {} : { back }) });
	return <section class="view" data-view={name} data-fill="" id={id} />;
}

/**
 * Renders `<section class="view" data-view="name[/param]">` with its `.view-head`, inside the marker pack hoists by; with
 * `records`, the empty `section.view[data-fill]` its island fills.
 */
export function View<T extends ViewRecord>(props: ViewProps<T>) {
	if ("records" in props) {
		return h(VIEW_MARKER, null, filledView(props));
	}
	const { name, param, back, id, children } = props;
	return h(
		VIEW_MARKER,
		null,
		<section class="view" data-view={param === undefined ? name : route(name, param)} id={id}>
			{viewBody(children, back)}
		</section>,
	);
}
