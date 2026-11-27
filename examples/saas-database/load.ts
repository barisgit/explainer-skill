"use client";

/* Rough single-node planning ceilings for small committed writes per second: the page's own estimates, to be measured. */
const CEILINGS = [
	{ name: "SQLite, one writer", ceiling: 500 },
	{ name: "Postgres, one primary", ceiling: 2000 },
	{ name: "MySQL, one primary", ceiling: 2000 },
];

export function loadFrame(customers: number, users: number, perMinute: number) {
	const peak = (customers * users * 0.2 * perMinute) / 60;
	return {
		plot: {
			categories: ["Your peak load", ...CEILINGS.map((c) => c.name)],
			horizontal: true,
			series: [
				{
					name: "Writes per second",
					type: "bar",
					data: [peak, ...CEILINGS.map((c) => c.ceiling)],
					fill: ["accent", "", "", ""],
					label: { digits: 0 },
				},
			],
			x: { min: 0, max: 2500, format: { digits: 0 } },
		},
		readout: `${Math.round(customers * users).toLocaleString("en")} users, a fifth active at peak: ${Math.round(peak)} writes/s, ${Math.round((peak / 500) * 100)}% of SQLite's ceiling.`,
	};
}
