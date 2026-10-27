/* Made-up token use of a coding assistant: two hosts, two harnesses, four models, 30 days. Not measured. */

const MODELS = [
	{ name: "Opus", weight: 0.9, price: 30 },
	{ name: "Sonnet", weight: 1.6, price: 6 },
	{ name: "Haiku", weight: 0.7, price: 1.2 },
	{ name: "Codex", weight: 1.1, price: 10 },
];
const HOSTS = ["Mac", "yocto"];
const HARNESSES = ["Claude Code", "Codex CLI"];
const DAYS = 30;

interface Row {
	day: number;
	host: string;
	harness: string;
	model: string;
	/** Million tokens, by what they were spent on. */
	input: number;
	output: number;
	cached: number;
	/** Euro. */
	cost: number;
}

/** One row per day, host, harness and model, from a fixed pattern (a weekly rhythm and a wobble) so the page packs the same every time. */
const ROWS: Row[] = Array.from({ length: DAYS }, (_, day) =>
	HOSTS.flatMap((host, h) =>
		HARNESSES.flatMap((harness, k) =>
			MODELS.map((m, i): Row => {
				const week = day % 7 > 4 ? 0.35 : 1;
				const total =
					m.weight * week * (1 + 0.5 * Math.sin(day * 0.9 + 2 * h + 3 * k + i)) * (h ? 0.6 : 1);
				const [input, output, cached] = [total * 0.2, total * 0.05, total * 0.75];
				return {
					day,
					host,
					harness,
					model: m.name,
					input,
					output,
					cached,
					cost: (input + 5 * output + 0.1 * cached) * (m.price / 6),
				};
			}),
		),
	),
).flat(2);

const sum = (rows: Row[], key: "input" | "output" | "cached" | "cost") =>
	rows.reduce((total, r) => total + r[key], 0);
const tokens = (rows: Row[]) => sum(rows, "input") + sum(rows, "output") + sum(rows, "cached");
const million = (n: number) => `${n.toFixed(1)} M`;

/** The rows of the last `period` days on `host` and `harness`. */
function pick(period: string, host: string, harness: string) {
	const days = period === "7 days" ? 7 : DAYS;
	const rows = ROWS.filter(
		(r) =>
			r.day >= DAYS - days &&
			(host === "all" || r.host === host) &&
			(harness === "all" || r.harness === harness),
	);
	return { rows, days };
}

export const CONTROLS = [
	{ id: "period", label: "Period", choice: ["7 days", "30 days"], value: "30 days" },
	{ id: "host", label: "Host", choice: { all: "All", Mac: "Mac", yocto: "yocto" } },
	{
		id: "harness",
		label: "Harness",
		choice: { all: "All", "Claude Code": "Claude Code", "Codex CLI": "Codex CLI" },
	},
	{ id: "view", label: "Show", choice: { total: "Total", breakdown: "Breakdown" } },
];

/** Tokens per day: one bar a day, or the day split by model. */
export function daily(period: string, host: string, harness: string, view: string) {
	const { rows, days } = pick(period, host, harness);
	const dayRows = (day: number, model?: string) =>
		rows.filter((r) => r.day === day && (model === undefined || r.model === model));
	const labels = Array.from({ length: days }, (_, i) => `${i + 1 + DAYS - days} Mar`);
	const series = (model?: string) => ({
		type: "bar",
		stack: "tokens",
		...(model && { name: model }),
		data: labels.map((_, i) => +tokens(dayRows(i + DAYS - days, model)).toFixed(2)),
	});
	const busiest = Math.max(...labels.map((_, i) => tokens(dayRows(i + DAYS - days))));
	return {
		chart: {
			legend: { show: view === "breakdown" },
			xAxis: { type: "category", data: labels },
			yAxis: { axisLabel: { formatter: { unit: " M" } } },
			series: view === "breakdown" ? MODELS.map((m) => series(m.name)) : [series()],
		},
		stats: {
			Total: million(tokens(rows)),
			"Per day": million(tokens(rows) / days),
			"Busiest day": million(busiest),
		},
	};
}

/** Models ranked by tokens: one bar each, or split by what the tokens were spent on. */
export function ranking(period: string, host: string, harness: string, view: string) {
	const { rows } = pick(period, host, harness);
	const byModel = MODELS.map((m) => ({
		name: m.name,
		rows: rows.filter((r) => r.model === m.name),
	})).sort((a, b) => tokens(b.rows) - tokens(a.rows));
	const series = (key: "input" | "output" | "cached") => ({
		type: "bar",
		stack: "tokens",
		name: key,
		data: byModel.map((m) => +sum(m.rows, key).toFixed(2)),
	});
	return {
		chart: {
			legend: { show: view === "breakdown" },
			xAxis: { axisLabel: { formatter: { unit: " M" } } },
			yAxis: { type: "category", data: byModel.map((m) => m.name), inverse: true },
			series:
				view === "breakdown"
					? [series("input"), series("output"), series("cached")]
					: [{ type: "bar", data: byModel.map((m) => +tokens(m.rows).toFixed(2)) }],
		},
		readout: `${byModel[0]?.name} leads with ${((100 * tokens(byModel[0]?.rows ?? [])) / tokens(rows)).toFixed(0)}% of the tokens.`,
	};
}

/** What the tokens cost, and how much of them the cache served. */
export function cost(period: string, host: string, harness: string) {
	const { rows, days } = pick(period, host, harness);
	return {
		stats: {
			Cost: `€${sum(rows, "cost").toFixed(0)}`,
			"Per day": `€${(sum(rows, "cost") / days).toFixed(1)}`,
			"From cache": `${((100 * sum(rows, "cached")) / tokens(rows)).toFixed(0)}%`,
		},
	};
}
