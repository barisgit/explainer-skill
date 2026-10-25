/**
 * Which kit scripts an .mdx page needs, from one table of the markup each script reads. A page needs a script when its
 * prerendered HTML holds that markup, or when its client code can write it later: the code is searched for the same markup as
 * it appears in compiled JSX and DOM calls (`"data-reply"`, `dataset.reply`, `Charts.make`). The kit components are markup
 * generators, so their code holds the markers too and needs no list of its own; a new attribute a kit script reads needs a row.
 * Markup a client component builds from computed names (`"data-" + kind`) is not found.
 */

/** A kit script's file name as pages reference it. */
export type KitScript =
	| "echarts.js"
	| "charts.js"
	| "plot.js"
	| "views.js"
	| "steps.js"
	| "link.js"
	| "keep.js"
	| "reply.js";

/** A string literal in compiled code, in any quotes. */
const literal = (text: string) => `["'\`]${text}["'\`]`;

/** What each script reads: as a selector over the HTML, and as a pattern over compiled code. */
const MARKERS: { html: string; code: RegExp; scripts: KitScript[] }[] = [
	{ html: ".chart:not(.plot)", code: /\bCharts\.make\b/, scripts: ["echarts.js", "charts.js"] },
	{ html: ".plot", code: /\bPlot\.make\b/, scripts: ["plot.js"] },
	{
		html: "[data-view], details",
		code: new RegExp(`${literal("data-view")}|${literal("details")}|\\bdataset\\.view\\b`),
		scripts: ["views.js"],
	},
	{
		html: "[data-stepper]",
		code: new RegExp(`${literal("data-stepper")}|\\bdataset\\.stepper\\b|\\bSteps\\.refresh\\b`),
		scripts: ["steps.js"],
	},
	{
		html: "[data-ref]",
		code: new RegExp(`${literal("data-ref")}|\\bdataset\\.ref\\b`),
		scripts: ["link.js"],
	},
	{
		html: "input[id], select[id], textarea[id]",
		// A control element made with an id in its props: jsx("input", { type: "range", id: "scale" }).
		code: /["'`](?:input|select|textarea)["'`],\s*\{[^}]*\bid:/,
		scripts: ["keep.js"],
	},
	{
		html: "[data-reply]",
		code: new RegExp(`${literal("data-reply")}|\\bdataset\\.reply\\b`),
		scripts: ["keep.js", "reply.js"],
	},
];

/**
 * The order the kit scripts run in. Libraries the client components call (Charts.make, Plot.make) load before the islands
 * hydrate; scripts that read and wire the page's DOM (views, steps, link, keep, reply) load after, so they reach the markup Preact
 * owns. reply.js drives keep.js, so keep.js comes first.
 */
export const BEFORE_ISLANDS: KitScript[] = ["echarts.js", "charts.js", "plot.js"];
export const AFTER_ISLANDS: KitScript[] = [
	"views.js",
	"steps.js",
	"link.js",
	"keep.js",
	"reply.js",
];

/** The kit scripts compiled JavaScript (a client bundle, a transpiled component) can need for the markup it writes. */
export function scriptsInCode(code: string): Set<KitScript> {
	return new Set(MARKERS.filter((marker) => marker.code.test(code)).flatMap((m) => m.scripts));
}

/** The kit scripts an HTML page or fragment needs for the markup it holds. */
export async function scriptsInHtml(html: string): Promise<Set<KitScript>> {
	const needed = new Set<KitScript>();
	let rewriter = new HTMLRewriter();
	for (const { html: selector, scripts } of MARKERS) {
		rewriter = rewriter.on(selector, {
			element() {
				for (const script of scripts) {
					needed.add(script);
				}
			},
		});
	}
	await rewriter.transform(new Response(html)).text();
	return needed;
}
