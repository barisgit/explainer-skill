import data from "./data.json";

/** Sizes in KB come from data.json (measure.ts); the island and CSS ranges and every reason are AGENTS.md, "ECharts ships compressed". */
export const alternatives = [
	{
		name: "deflate-raw in base64",
		size: `${data.packed} KB`,
		why: "Shipped: tied smallest for Chrome 103, Firefox 113 and Safari 16.4.",
		state: "fit",
	},
	{ name: "gzip", size: `${data.gzip} KB`, why: "The same size as deflate-raw.", state: "out" },
	{
		name: "Brotli",
		size: `${data.brotli} KB`,
		why: "Smaller, but DecompressionStream does not read it in those baseline versions.",
		state: "out",
	},
	{
		name: "Bytes as Latin-1 text",
		size: `${data.latin1} KB`,
		why: "Larger than base64 once the page is UTF-8.",
		state: "out",
	},
	{
		name: "Island bundle, plain",
		size: "60 to 300 KB",
		why: "Must run before the views and steps scripts; waiting to unpack would delay them.",
		state: "out",
	},
	{ name: "CSS, plain", size: "", why: "CSS cannot wait for a script.", state: "out" },
];
export type Alternative = (typeof alternatives)[number];
