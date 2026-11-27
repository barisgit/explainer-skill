/* The comparison as data: the page's matrix, its toggles' frames and the decision rows all read it. */

export type Grade = "fit" | "maybe" | "out";

export interface Need {
	id: string;
	label: string;
}

/** A cell: its grade, shown as a mark, and the few words of what gives or prevents it, shown under the mark. */
export interface Cell {
	grade: Grade;
	note: string;
}

export interface Option {
	id: string;
	name: string;
	cells: Record<string, Cell>;
	wins: string;
	costs: string;
}

export const needs: Need[] = [
	{ id: "iso", label: "Isolation enforced by the database" },
	{ id: "ha", label: "Failover without a restore" },
	{ id: "report", label: "Reporting on live data" },
	{ id: "ddl", label: "Transactional migrations" },
	{ id: "ops", label: "Least to operate" },
];

const c = (grade: Grade, note = ""): Cell => ({ grade, note });

export const options: Option[] = [
	{
		id: "pg",
		name: "Postgres",
		cells: {
			iso: c("fit", "row-level security"),
			ha: c("fit", "managed standby"),
			report: c("fit", "materialized views, replicas"),
			ddl: c("fit", "DDL inside a transaction"),
			ops: c("maybe", "managed service"),
		},
		wins: "Isolation, failover and reporting in one engine",
		costs: "A managed service to pay for",
	},
	{
		id: "mysql",
		name: "MySQL",
		cells: {
			iso: c("out", "tenant filter in app code"),
			ha: c("fit", "managed standby"),
			report: c("maybe", "no materialized views"),
			ddl: c("out", "DDL commits implicitly"),
			ops: c("maybe", "managed service"),
		},
		wins: "The team already knows it",
		costs: "Isolation and migrations left to discipline",
	},
	{
		id: "litestream",
		name: "SQLite + Litestream",
		cells: {
			iso: c("maybe", "one file per tenant"),
			ha: c("out", "restore on a new host"),
			report: c("maybe", "shares the app's host"),
			ddl: c("fit", "DDL inside a transaction"),
			ops: c("fit", "runs inside the app"),
		},
		wins: "Fewest moving parts, fastest reads",
		costs: "Downtime and lost writes on a host failure",
	},
	{
		id: "turso",
		name: "SQLite on Turso",
		cells: {
			iso: c("maybe", "database per tenant"),
			ha: c("maybe", "hosted, read the SLA"),
			report: c("maybe", "remote, thin tooling"),
			ddl: c("fit", "DDL inside a transaction"),
			ops: c("fit", "hosted"),
		},
		wins: "SQLite's model without running the host",
		costs: "A young vendor and one database per tenant",
	},
];

/** The kit's status mark for each grade: its class and its word. */
export const MARKS: Record<Grade, { class: string; word: string }> = {
	fit: { class: "yes", word: "Yes" },
	maybe: { class: "part", word: "Partial" },
	out: { class: "no", word: "No" },
};

const rank: Record<Grade, number> = { fit: 0, maybe: 1, out: 2 };

/** How an option stands against the needs the reader switched on: its worst cell among them. */
export function standing(option: Option, picked: string[]): Grade {
	return picked.reduce<Grade>((worst, id) => {
		const g = option.cells[id]?.grade ?? "fit";
		return rank[g] > rank[worst] ? g : worst;
	}, "fit");
}
