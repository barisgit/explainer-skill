/* The records of the page's table: every place with its change into the last year, in extract order (regions, then countries). */
import type { RecordsProps } from "kit";
import { latest, PLACES, Y1 } from "./model.ts";

const tenth = (v: number) => Math.round(v * 10) / 10;

const data = PLACES.map((p) => {
	const s = latest(p);
	return {
		id: p.slug,
		name: p.name,
		kind: p.region ? "Region" : "Country",
		total: s ? tenth(s.total) : null,
		windSolar: s ? tenth(s.windSolar) : null,
		coal: s ? tenth(s.coal) : null,
	};
});

export default {
	id: "places",
	data,
	idField: "id",
	fields: {
		name: { label: "Place", kind: "text" },
		kind: {
			label: "Kind",
			kind: "category",
			values: [
				{ value: "Region", label: "Region" },
				{ value: "Country", label: "Country" },
			],
		},
		total: { label: `Generation added in ${Y1}, TWh`, kind: "number", digits: 1 },
		windSolar: { label: "Wind and solar", kind: "number", digits: 1 },
		coal: { label: "Coal", kind: "number", digits: 1 },
	},
	columns: ["name", "total", "windSolar", "coal"],
	views: ["table"],
	sort: { field: "total", desc: true },
	search: ["name"],
	facets: ["kind"],
	link: "place",
	width: "wide",
} satisfies RecordsProps;
