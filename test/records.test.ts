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
	expect(total[likely]).toMatchObject({ value: sumOf(data), text: "3,116\u00a0h" });
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

test("a sum over records with unknown values reads as a lower bound, or as unknown when none has one", () => {
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
	// The texts join a number to its unit and to ≥ with no-break spaces; the expectations write plain ones.
	const plain = (text: string | undefined) => text?.replace(/\u00a0/g, " ");
	const hours = (cells: readonly Cell[]) => {
		const { text, value, incomplete } = cells[1] ?? {};
		return { text: plain(text), value, incomplete: plain(incomplete) };
	};
	const { body: treeBody } = partial.view();
	const groups = treeBody.kind === "tree" ? treeBody.groups : [];
	expect(groups.map((g) => hours(g.cells))).toEqual([
		{ text: "1,364 h", value: 1364, incomplete: undefined },
		{ text: "≥ 8 h", value: 8, incomplete: "at least 8 h, 1 without a value" },
		// Unknown is not zero: the sum of nothing known is unknown.
		{ text: "?", value: null, incomplete: "unknown, 2 without a value" },
	]);
	expect(treeBody.kind === "tree" && hours(treeBody.total)).toEqual({
		text: "≥ 1,372 h",
		value: 1372,
		incomplete: "at least 1,372 h, 3 without a value",
	});
	const { body: table } = partial.view({ ...partial.initial, view: "table" });
	expect(table.kind === "table" && hours(table.total).text).toBe("≥ 1,372 h");
	const { body: board } = partial.view({ ...partial.initial, view: "board" });
	expect(board.kind === "board" && board.lanes.map((l) => hours(l.cells).text)).toEqual([
		"1,364 h",
		"≥ 8 h",
		"?",
	]);
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
	expect(() => createRecords({ ...(plan as object), detail: "rationale" })).toThrow(
		'detail: a row links to its view (link "item") or opens in place to its detail, not both',
	);
});
