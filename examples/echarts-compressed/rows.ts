import data from "./data.json";

/** Sizes in KB come from data.json (measure.ts); every reason is AGENTS.md, "ECharts ships compressed". `decodes`: whether
    Chrome 103, Firefox 113 and Safari 16.4, the kit's baseline, can turn the text back into ECharts. */
export const encodings = [
	{
		name: "deflate-raw in base64",
		size: data.packed,
		decodes: true,
		why: "shipped: tied smallest",
		state: "fit",
	},
	{
		name: "gzip in base64",
		size: data.gzip,
		decodes: true,
		why: "the same size as deflate-raw",
		state: "out",
	},
	{
		name: "Brotli in base64",
		size: data.brotli,
		decodes: false,
		why: "DecompressionStream does not read it",
		state: "out",
	},
	{
		name: "deflate-raw as Latin-1 text",
		size: data.latin1,
		decodes: true,
		why: "larger once the page is UTF-8",
		state: "out",
	},
];
export type Encoding = (typeof encodings)[number];
