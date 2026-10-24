/**
 * What the reader has chosen in one records block, and its form in the URL hash.
 *
 * The hash form is `<block id>?<params>`, such as `plan?view=table&sort=-labour&q=power&f.owner=JV,PS&open=1,1.wp1`, and only
 * the params that differ from the defaults are written; the defaults alone are just `plan`. It lives beside the kit's views
 * router (kit/views.ts) without clashing: a block id has no `/`, so no `#name/param` route claims it, and no element has the id
 * `plan?...`, so the router shows the overview, where the block is. An item's own view (`#item/WP1-02`) replaces the block's
 * hash, and Back returns to it. One block's state at a time lives in the hash: a hash that names another block, or none,
 * reads as null, and the block keeps the state it has.
 */
import type { ViewKind } from "./config.ts";

/** A sort by one field. */
export interface SortState {
	field: string;
	desc: boolean;
}

/** One block's state. Pass it back changed (or take a `next` from the view model) to get the next view model. */
export interface RecordsState {
	view: ViewKind;
	/** The table's order; null is source order. */
	sort: SortState | null;
	/** Selected values by facet field; a record matches any selected value of a field, and every field with a selection. */
	filters: Readonly<Record<string, readonly string[]>>;
	/** Words the records must all contain, in any search field, ignoring case and accents. */
	search: string;
	/** Ids of the tree's open groups. */
	open: readonly string[];
}

/** What a block allows, which a state is checked against. */
export interface StateRules {
	id: string;
	views: readonly ViewKind[];
	/** The config's ranking, or null for source order. */
	sort: SortState | null;
	/** The fields that can sort: every declared field. Field keys start with a letter, so `sort=-key` reads one way only. */
	fields: readonly string[];
	/** Whether the block has search fields; without them a search in the hash is dropped. */
	searchable: boolean;
	/** Each facet field's values, in order. */
	facets: Readonly<Record<string, readonly string[]>>;
	/** Every group id of the tree, in tree order. */
	groups: readonly string[];
}

/** The state a block opens with. */
export function initialState(rules: StateRules): RecordsState {
	return { view: rules.views[0] ?? "table", sort: rules.sort, filters: {}, search: "", open: [] };
}

const sameSort = (a: SortState | null, b: SortState | null) =>
	a === b || (a !== null && b !== null && a.field === b.field && a.desc === b.desc);

/**
 * The state with everything the block does not allow dropped: an unknown view or sort field falls back to the default, unknown
 * facets, values and groups are left out, and selections and open groups follow the block's own order.
 */
export function normalize(rules: StateRules, state: RecordsState): RecordsState {
	const filters: Record<string, readonly string[]> = {};
	for (const [field, values] of Object.entries(rules.facets)) {
		const chosen = values.filter((value) => state.filters[field]?.includes(value));
		if (chosen.length) {
			filters[field] = chosen;
		}
	}
	const sortOk = state.sort === null || rules.fields.includes(state.sort.field);
	return {
		view: rules.views.includes(state.view) ? state.view : initialState(rules).view,
		sort: sortOk ? state.sort : rules.sort,
		filters,
		search: rules.searchable ? state.search : "",
		open: rules.groups.filter((id) => state.open.includes(id)),
	};
}

const encode = (values: readonly string[]) => values.map(encodeURIComponent).join(",");

/** A hash is typed by hand or copied from prose, so a malformed escape such as "100%" stays as written. */
function decode(text: string): string {
	try {
		return decodeURIComponent(text);
	} catch {
		return text;
	}
}

const decodeList = (text: string) => (text ? text.split(",").map(decode) : []);

/** The hash for a state, without the `#`: the block id, then the params that differ from the defaults in a fixed order. */
export function writeHash(rules: StateRules, state: RecordsState): string {
	const s = normalize(rules, state);
	const params: string[] = [];
	if (s.view !== initialState(rules).view) {
		params.push(`view=${s.view}`);
	}
	if (!sameSort(s.sort, rules.sort)) {
		params.push(
			`sort=${s.sort ? `${s.sort.desc ? "-" : ""}${encodeURIComponent(s.sort.field)}` : ""}`,
		);
	}
	if (s.search.trim()) {
		params.push(`q=${encodeURIComponent(s.search.trim())}`);
	}
	for (const [field, values] of Object.entries(s.filters)) {
		params.push(`f.${encodeURIComponent(field)}=${encode(values)}`);
	}
	if (s.open.length) {
		params.push(`open=${s.open.length === rules.groups.length ? "*" : encode(s.open)}`);
	}
	return params.length ? `${rules.id}?${params.join("&")}` : rules.id;
}

/** One param's effect on the state being read. */
function readParam(
	rules: StateRules,
	state: RecordsState,
	key: string,
	value: string,
): RecordsState {
	if (key === "view") {
		return { ...state, view: rules.views.find((view) => view === value) ?? state.view };
	}
	if (key === "sort") {
		const desc = value.startsWith("-");
		return {
			...state,
			sort: value ? { field: decode(desc ? value.slice(1) : value), desc } : null,
		};
	}
	if (key === "q") {
		return { ...state, search: decode(value) };
	}
	if (key === "open") {
		return { ...state, open: value === "*" ? rules.groups : decodeList(value) };
	}
	if (key.startsWith("f.")) {
		return { ...state, filters: { ...state.filters, [decode(key.slice(2))]: decodeList(value) } };
	}
	return state;
}

/**
 * The state a hash holds (with or without its `#`), or null when the hash is not this block's. A param that names something
 * the block does not have is dropped, so an old or hand-edited link still opens.
 */
export function readHash(rules: StateRules, hash: string): RecordsState | null {
	const text = hash.startsWith("#") ? hash.slice(1) : hash;
	const query = text.indexOf("?");
	const name = query < 0 ? text : text.slice(0, query);
	if (decode(name) !== rules.id) {
		return null;
	}
	let state = initialState(rules);
	for (const param of query < 0 ? [] : text.slice(query + 1).split("&")) {
		const eq = param.indexOf("=");
		state = eq < 0 ? state : readParam(rules, state, param.slice(0, eq), param.slice(eq + 1));
	}
	return normalize(rules, state);
}
