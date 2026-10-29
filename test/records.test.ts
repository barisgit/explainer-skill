/**
 * The records core at its interface: config in, view model and hash out. The fixture is the fictional 96-item RC-2 plan
 * (fixtures/t6-plan.json), whose source order is not phase order: the WP0 project-management items of all three phases come
 * first.
 */
import { expect, test } from "bun:test";
import {
	type Cell,
	createRecords,
	type DataRecord,
	type GroupRow,
	type ItemRow,
	RecordsConfigError,
	type RecordsState,
} from "../skills/explainer/kit/records/index.ts";

const plan: unknown = await Bun.file(`${import.meta.dir}/fixtures/t6-plan.json`).json();
const records = createRecords(plan);
const { data } = records.config;

/** A record's value as text, the oracle the tests compute expectations with. */
const get = (record: DataRecord, key: string) => String(record[key]);
const idOf = (record: DataRecord) => get(record, "id");
const sumOf = (rows: readonly DataRecord[]) =>
	rows.reduce((n, r) => n + Number(get(r, "likely")), 0);
const leaves = (rows: readonly (GroupRow | ItemRow)[]): ItemRow[] =>
	rows.flatMap((row) => (row.kind === "group" ? leaves(row.children) : [row]));
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function tree(state: RecordsState = records.initial) {
	const { body } = records.view(state);
	if (body.kind !== "tree") {
		throw new Error(`expected the tree, got the ${body.kind}`);
	}
	return body;
}

test("the tree groups every item by phase and package, in source order, with subtotals", () => {
	const { groups, total } = tree();
	expect(groups.map((g) => [g.id, g.count])).toEqual([
		["1", 39],
		["2", 29],
		["3", 28],
	]);
	// WP0-06 comes before every Phase 1 package in the source and still lands in Phase 3; WP9 stays ahead of WP10.
	expect(groups[2]?.children.map((g) => g.id)).toEqual([
		"3.wp0",
		"3.wp9",
		"3.wp10",
		"3.wp11",
		"3.wp12",
	]);
	const likely = tree().columns.findIndex((c) => c.field === "likely");
	for (const phase of groups) {
		for (const pkg of phase.children) {
			const expected = data.filter(
				(r) => `${get(r, "phase")}.${get(r, "package").toLowerCase()}` === pkg.id,
			);
			expect(pkg.kind === "group" && leaves(pkg.children).map((i) => i.id)).toEqual(
				expected.map(idOf),
			);
			expect(pkg.kind === "group" && pkg.cells[likely]?.value).toBe(sumOf(expected));
		}
	}
	expect(total?.[likely]).toMatchObject({ value: sumOf(data), text: "3,116\u00a0h" });
});

test("source order is the default; a sort reorders only the table", () => {
	const table = records.view({ ...records.initial, view: "table" }).body;
	expect(table.kind === "table" && table.rows.map((r) => r.id)).toEqual(data.map(idOf));
	const sorted = { ...records.initial, sort: { field: "likely", desc: true } };
	expect(leaves(tree(sorted).groups).map((i) => i.id)).toEqual(
		leaves(tree().groups).map((i) => i.id),
	);
	const ranked = records.view({ ...sorted, view: "table" }).body;
	const hours =
		ranked.kind === "table" ? ranked.rows.map((r) => Number(r.cells.at(-3)?.value)) : [];
	expect(hours).toEqual([...hours].sort((a, b) => b - a));
});

test("a filter and a search hide rows in the table and board, highlight them in the tree, and count facets", () => {
	const state = { ...records.initial, filters: { owner: ["JV", "PS"] }, search: "BOARD" };
	const searched = (r: DataRecord) =>
		["id", "title", "rationale"].some((key) => fold(get(r, key)).includes("board"));
	const expected = data.filter((r) => ["JV", "PS"].includes(get(r, "owner")) && searched(r));
	const view = records.view({ ...state, view: "table" });
	expect(view.body.kind === "table" && view.body.rows.map((r) => r.id)).toEqual(expected.map(idOf));
	expect(view.shownText).toBe(`${expected.length} of 96`);

	const { groups } = tree(state);
	const items = leaves(groups);
	expect(items).toHaveLength(96);
	expect(items.filter((i) => i.match).map((i) => i.id)).toEqual(expected.map(idOf));
	expect(groups.map((g) => [g.matches, g.open])).toEqual(
		groups.map((g) => {
			const n = expected.filter((r) => get(r, "phase") === g.id).length;
			return [n, n > 0];
		}),
	);

	const board = records.view({ ...state, view: "board" }).body;
	expect(board.kind === "board" && board.lanes.map((l) => [l.id, l.count])).toEqual(
		["1", "2", "3"].map((p) => [p, expected.filter((r) => get(r, "phase") === p).length]),
	);

	// A facet's counts leave out its own selection, so the reader sees what adding another owner would bring.
	const owners = view.facets.find((f) => f.field === "owner")?.options ?? [];
	expect(owners.map((o) => [o.value, o.count, o.selected])).toEqual(
		["HO", "JV", "PS", "RC", "EM"].map((o) => [
			o,
			data.filter((r) => get(r, "owner") === o && searched(r)).length,
			o === "JV" || o === "PS",
		]),
	);
});

test("a state goes to the URL hash and back, beside the views routes", () => {
	const state: RecordsState = {
		view: "table",
		sort: { field: "labour", desc: true },
		filters: { owner: ["PS", "JV"], analogue: ["none"] },
		search: "50% čas, a/b",
		open: ["1.wp1", "1"],
		details: [],
	};
	const hash = records.writeHash(state);
	expect(hash).toStartWith("plan?view=table&sort=-labour&q=");
	// No "/" means no #name/param route claims it; Back to it gives the block its state again.
	expect(hash).not.toContain("/");
	expect(records.readHash(`#${hash}`)).toEqual({
		...state,
		filters: { owner: ["JV", "PS"], analogue: ["none"] },
		open: ["1", "1.wp1"],
	});
	expect(records.writeHash(records.initial)).toBe("plan");
	expect(records.readHash("#item/WP1-02")).toBeNull();
	expect(records.readHash("#plan")).toEqual(records.initial);
});

test("a bad config is rejected with every problem, where it is and what to write", () => {
	const bad = {
		id: "plan",
		idField: "id",
		fields: {
			id: { label: "Item", kind: "text" },
			hours: { label: "Hours", kind: "number", subtotal: true },
			__global__: { label: "Global", kind: "text" },
		},
		// "constructor" is on every object's prototype; only declared fields count.
		columns: ["id", "likely", "constructor"],
		views: ["tree"],
		data: [{ id: "A-1", hours: "12h" }, { id: "A-1" }],
	};
	expect(() => createRecords(bad)).toThrow(RecordsConfigError);
	const problems = (() => {
		try {
			createRecords(bad);
			return [];
		} catch (error) {
			return error instanceof RecordsConfigError ? error.problems : [];
		}
	})();
	expect(problems).toEqual([
		'fields.hours.subtotal: unknown property; expected one of "label", "kind", "unit", "digits", "sum"',
		"fields.__global__: a field key must be a plain name (letters, digits, - and _, starting with a letter); rename it in the data",
		'columns[1]: "likely" is not a field; the fields are "id", "hours"',
		'columns[2]: "constructor" is not a field; the fields are "id", "hours"',
		"views[0]: the tree view needs groupBy, the fields it groups by",
		'data[0].hours: expected a finite number or null; got "12h"',
		'data[1].id: "A-1" is also the id of data[0]; ids must be unique',
	]);
});

test("a sum over records with unknown values shows the known part and how many it leaves out, or unknown when none has one", () => {
	const partial = createRecords({
		id: "gaps",
		idField: "id",
		fields: {
			id: { label: "Id", kind: "text" },
			team: { label: "Team", kind: "text" },
			hours: { label: "Hours", kind: "number", unit: "h", sum: true },
		},
		columns: ["id", "hours"],
		groupBy: ["team"],
		views: ["tree", "table", "board"],
		data: [
			{ id: "a", team: "known", hours: 1200 },
			{ id: "b", team: "known", hours: 164 },
			{ id: "c", team: "mixed", hours: 8 },
			{ id: "d", team: "mixed", hours: null },
			{ id: "e", team: "none" },
			{ id: "f", team: "none", hours: null },
		],
	});
	// The texts join a number to its unit and to + ? with no-break spaces; the expectations write plain ones.
	const plain = (text: string | undefined) => text?.replace(/\u00a0/g, " ");
	const hours = (cells: readonly Cell[]) => {
		const { text, value, incomplete } = cells[1] ?? {};
		return { text: plain(text), value, incomplete: plain(incomplete) };
	};
	const { body: treeBody } = partial.view();
	const groups = treeBody.kind === "tree" ? treeBody.groups : [];
	expect(groups.map((g) => hours(g.cells))).toEqual([
		{ text: "1,364 h", value: 1364, incomplete: undefined },
		{ text: "8 h + ?", value: 8, incomplete: "8 h known, 1 without a value" },
		// Unknown is not zero: the sum of nothing known is unknown.
		{ text: "?", value: null, incomplete: "unknown, 2 without a value" },
	]);
	expect(treeBody.kind === "tree" && hours(treeBody.total ?? [])).toEqual({
		text: "1,372 h + ?",
		value: 1372,
		incomplete: "1,372 h known, 3 without a value",
	});
	const { body: table } = partial.view({ ...partial.initial, view: "table" });
	expect(table.kind === "table" && hours(table.total ?? []).text).toBe("1,372 h + ?");
	const { body: board } = partial.view({ ...partial.initial, view: "board" });
	expect(board.kind === "board" && board.lanes.map((l) => hours(l.cells).text)).toEqual([
		"1,364 h",
		"8 h + ?",
		"?",
	]);
});

test("a signed sum with an unknown value is not read as a bound: a known 100 and a refund without an amount show 100 + ?", () => {
	const ledger = createRecords({
		id: "ledger",
		idField: "id",
		fields: {
			id: { label: "Id", kind: "text" },
			amount: { label: "Amount", kind: "currency", currency: "EUR", sum: true },
		},
		columns: ["id", "amount"],
		views: ["table"],
		data: [
			{ id: "sale", amount: 130 },
			{ id: "fee", amount: -30 },
			{ id: "refund", amount: null },
		],
	});
	const { body } = ledger.view();
	const total = body.kind === "table" ? body.total?.[1] : undefined;
	expect({
		text: total?.text.replace(/\u00a0/g, " "),
		incomplete: total?.incomplete?.replace(/\u00a0/g, " "),
	}).toEqual({ text: "€100.00 + ?", incomplete: "€100.00 known, 1 without a value" });
});

test("a field named like an object's built-in property reads only the record's own value", () => {
	// Every object inherits "constructor" and "toString"; a record that leaves them out holds no value there.
	const built = createRecords({
		id: "own",
		idField: "id",
		fields: {
			id: { label: "Id", kind: "text" },
			constructor: { label: "Builder", kind: "number", sum: true },
			toString: { label: "Kind", kind: "text" },
		},
		columns: ["id", "constructor", "toString"],
		groupBy: ["toString"],
		views: ["tree", "table"],
		data: [
			{ id: "a", constructor: 2, toString: "x" },
			{ id: "b", toString: "x" },
		],
	});
	const { body } = built.view({ ...built.initial, view: "table" });
	expect(body.kind === "table" && body.rows.map((r) => r.cells[1]?.value)).toEqual([2, null]);
	expect(() =>
		createRecords({
			id: "own",
			idField: "id",
			fields: { id: { label: "Id", kind: "text" }, toString: { label: "Kind", kind: "text" } },
			columns: ["id"],
			groupBy: ["toString"],
			data: [{ id: "a" }],
		}),
	).toThrow("data[0].toString: every record needs a value in a groupBy field");
});

test("a row opens in place to its detail or links to its view, and carries its ref", () => {
	const { link: _, ...rest } = plan as Record<string, unknown>;
	const folded = createRecords({ ...rest, detail: "rationale", refField: "owner" });
	const { body } = folded.view();
	const first = body.kind === "tree" ? leaves(body.groups)[0] : undefined;
	expect(first).toMatchObject({ id: "WP0-01", ref: "HO" });
	expect(first?.detail).toStartWith("RC-1 kick-off took 30 h");
	expect(first?.href).toBeUndefined();
	expect(first?.open).toBe(false);
	// Expand all opens the groups and every detail, and only then does the tree read as expanded.
	const whole = body.kind === "tree" ? body.expandAll : folded.initial;
	const groupsOnly = { ...whole, details: [] };
	const expanded = (state: RecordsState) => {
		const view = folded.view(state).body;
		return view.kind === "tree" && view.expanded;
	};
	expect([expanded(folded.initial), expanded(groupsOnly), expanded(whole)]).toEqual([
		false,
		false,
		true,
	]);
	expect(whole.details).toHaveLength(96);
	const open = folded.view(whole).body;
	expect(open.kind === "tree" && leaves(open.groups).every((row) => row.open)).toBe(true);
	expect(open.kind === "tree" && open.collapseAll).toMatchObject({ open: [], details: [] });
	// Open details go in the hash, all of them as *; the table and board open the same ones.
	expect(folded.writeHash({ ...folded.initial, details: ["WP0-02", "WP0-01"] })).toBe(
		"plan?detail=WP0-01,WP0-02",
	);
	expect(folded.writeHash(whole)).toEndWith("&detail=*");
	expect(folded.readHash("#plan?detail=WP0-02,nothing")?.details).toEqual(["WP0-02"]);
	const table = folded.view({ ...folded.initial, view: "table", details: ["WP0-02"] }).body;
	expect(table.kind === "table" && table.rows.filter((r) => r.open).map((r) => r.id)).toEqual([
		"WP0-02",
	]);
	expect(() => createRecords({ ...(plan as object), detail: "rationale" })).toThrow(
		'detail: a row links to its view (link "item") or opens in place to its detail, not both',
	);
});

test("groups open at load by levels or all, and the hash writes only what differs from that", () => {
	const unlinked = { ...(plan as Record<string, unknown>), link: undefined, detail: "rationale" };
	const topLevel = createRecords({ ...unlinked, open: 1 });
	const openGroups = (r: typeof records) => {
		const body = r.view().body;
		return body.kind === "tree" ? body.groups.map((g) => g.open) : [];
	};
	expect(openGroups(records)).toEqual([false, false, false]);
	expect(openGroups(topLevel)).toEqual([true, true, true]);
	const nested = topLevel.view().body;
	expect(
		nested.kind === "tree" && nested.groups[0]?.children.some((c) => c.kind === "group" && c.open),
	).toBe(false);
	const all = createRecords({ ...unlinked, open: true });
	const everything = all.view().body;
	expect(everything.kind === "tree" && everything.expanded).toBe(true);
	// The defaults write no hash; closing a group the block opened, or all of them, is a difference and is written.
	expect(topLevel.writeHash(topLevel.initial)).toBe("plan");
	expect(topLevel.writeHash({ ...topLevel.initial, open: ["2", "3"] })).toBe("plan?open=2,3");
	expect(topLevel.writeHash({ ...topLevel.initial, open: [] })).toBe("plan?open=");
	expect(topLevel.readHash("#plan?open=")?.open).toEqual([]);
	expect(topLevel.readHash("#plan?view=table")?.open).toEqual(["1", "2", "3"]);
	expect(all.writeHash(all.initial)).toBe("plan");
	expect(all.writeHash({ ...all.initial, details: [] })).toBe("plan?detail=");
	expect(() => createRecords({ ...unlinked, open: 3 })).toThrow(
		"open: expected true, false or a number of levels from 1 to 2; got 3",
	);
});

test("a reply puts the same choices on every record, and the records a view leaves out keep theirs", () => {
	const answering = createRecords({
		...(plan as Record<string, unknown>),
		search: ["id", "title"],
		reply: { options: { agree: "Agree", change: "Change" }, note: true },
		width: "full",
	});
	const view = answering.view();
	expect(view.reply).toEqual({
		choices: [
			{ value: "agree", label: "Agree" },
			{ value: "change", label: "Change" },
		],
		note: true,
	});
	expect(view.width).toBe("full");
	// The tree shows every record; the table drops those a search excludes, and hands them back as unlisted.
	expect(view.unlisted).toEqual([]);
	const table = answering.view({ ...answering.initial, view: "table", search: "board" });
	expect(table.shown).toBeLessThan(96);
	expect(table.unlisted).toHaveLength(96 - table.shown);
	expect(table.body.kind === "table" && table.body.rows).toHaveLength(table.shown);
	expect(records.view().reply).toBeNull();
	expect(() =>
		createRecords({ ...(plan as object), reply: { options: ["Yes", "Yes"], note: 1 } }),
	).toThrow(
		/reply.options: the label "Yes" is used twice[\s\S]*reply.note: expected true or false; got 1/,
	);
	expect(() =>
		createRecords({ ...(plan as object), reply: { options: [] }, width: "huge" }),
	).toThrow(
		/reply.options: expected a list of labels[\s\S]*width: expected "wide" or "full"; got "huge"/,
	);
});

test("a total row exists only where some column is summed", () => {
	const { fields } = plan as { fields: Record<string, { sum?: boolean }> };
	const unsummed = Object.fromEntries(
		Object.entries(fields).map(([name, field]) => [
			name,
			"sum" in field ? { ...field, sum: false } : field,
		]),
	);
	const noSums = createRecords({
		...(plan as Record<string, unknown>),
		fields: unsummed,
		views: ["tree", "table"],
	});
	for (const view of ["tree", "table"] as const) {
		const body = noSums.view({ ...noSums.initial, view }).body;
		expect(body.kind === view && body.total).toBeNull();
	}
	const body = records.view().body;
	expect(body.kind === "tree" && body.total?.length).toBeGreaterThan(1);
});
