/* Illustrative numbers for a 6 kW rooftop array on a four-person house; not measured. */
import type { RecordsProps } from "kit";

export const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];
/** kWh the panels produce each month. */
export const PRODUCTION = [180, 260, 420, 610, 740, 790, 820, 720, 540, 360, 200, 150];
/** kWh the house uses each month. */
export const USE = [520, 470, 450, 400, 370, 350, 360, 370, 390, 430, 480, 530];

export interface Size {
	id: string;
	name: string;
	kwh: number;
	price: number;
	/** Share of evenings, May to September, the battery carries to midnight. */
	evenings: number;
	/** Euro saved a year at 0.22 €/kWh bought and 0.06 €/kWh sold. */
	saved: number;
	note: string;
	/** Share of each month's use covered by the panels and the battery. */
	selfSufficiency: number[];
}

export const SIZES: Size[] = [
	{
		id: "s5",
		name: "5 kWh",
		kwh: 5,
		price: 4200,
		evenings: 0.8,
		saved: 410,
		note: "Fills by noon on most summer days and runs the evening peak.",
		selfSufficiency: [0.28, 0.4, 0.62, 0.78, 0.86, 0.9, 0.9, 0.87, 0.74, 0.55, 0.33, 0.24],
	},
	{
		id: "s10",
		name: "10 kWh",
		kwh: 10,
		price: 7900,
		evenings: 0.89,
		saved: 470,
		note: "Rarely fills in winter; in summer it carries the house to morning.",
		selfSufficiency: [0.29, 0.43, 0.68, 0.86, 0.94, 0.97, 0.97, 0.95, 0.82, 0.6, 0.35, 0.25],
	},
	{
		id: "s15",
		name: "15 kWh",
		kwh: 15,
		price: 11200,
		evenings: 0.91,
		saved: 490,
		note: "The last 5 kWh is charged on a handful of days a year.",
		selfSufficiency: [0.29, 0.43, 0.69, 0.88, 0.96, 0.98, 0.98, 0.97, 0.84, 0.61, 0.35, 0.25],
	},
];

export const payback = (s: Size) => Math.round(s.price / s.saved);

/**
 * What the 5 kWh installation costs, as the installer's quote lists it, as Records' config with the column names given; its
 * ref field names the part in the system diagram, which a page that draws the diagram links with refField="ref".
 */
export const quote = (item: string, price: string) =>
	({
		id: "quote",
		idField: "name",
		fields: {
			name: { label: item, kind: "text" },
			part: { label: "Part", kind: "text" },
			eur: { label: price, kind: "currency", currency: "EUR", digits: 0, sum: true },
			note: { label: "Note", kind: "text" },
			ref: { label: "System part", kind: "text" },
		},
		columns: ["name", "eur"],
		groupBy: ["part"],
		detail: "note",
		data: [
			{
				name: "Battery module, 5 kWh",
				part: "Hardware",
				eur: 2600,
				ref: "battery",
				note: "LFP cells, 6000 cycles to 80%.",
			},
			{
				name: "Hybrid inverter upgrade",
				part: "Hardware",
				eur: 750,
				ref: "inverter",
				note: "Replaces the string inverter.",
			},
			{
				name: "Electrician, 6 h",
				part: "Installation",
				eur: 540,
				ref: "inverter",
				note: "Mounting, wiring, commissioning.",
			},
			{
				name: "Meter and breaker",
				part: "Installation",
				eur: 310,
				ref: "grid",
				note: "Bidirectional meter swap by the grid operator.",
			},
		],
	}) satisfies RecordsProps;

export const euro = (n: number) => `${n.toLocaleString("en")} €`;
