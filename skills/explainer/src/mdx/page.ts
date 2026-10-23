import { realpathSync } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";
import { safeScript } from "../escape.ts";
import { PackError } from "../pack-error.ts";
import { KIT_DIR } from "../paths.ts";
import { clientBundle, prerender, type Seen } from "./bundle.ts";
import { compileMdx, type Frontmatter } from "./compile.ts";

/** Kit scripts a prerendered page needs, by what its HTML holds. */
const HTML_SCRIPTS: [selector: string, scripts: string[]][] = [
	[".chart", ["echarts.js", "charts.js"]],
	["[data-view], details", ["views.js"]],
	["[data-stepper]", ["steps.js"]],
	["[data-ref]", ["link.js"]],
	["[data-reply]", ["reply.js"]],
];
/** Kit scripts a kit component needs when a client component may render it later, though the first render does not. */
const COMPONENT_SCRIPTS: Record<string, string[]> = { "chart.tsx": ["echarts.js", "charts.js"] };
/**
 * The order the kit scripts run in. Libraries the client components call (Charts.make) load before the islands hydrate; scripts
 * that read and wire the page's DOM (views, steps, link, reply) load after, so they reach the markup Preact owns.
 */
const BEFORE_ISLANDS = ["echarts.js", "charts.js"];
const AFTER_ISLANDS = ["views.js", "steps.js", "link.js", "reply.js"];

/** Island markers, and the element a rendered View is wrapped in (VIEW_MARKER in kit/components/view.tsx) so pack can move it. */
const VIEW = /<!--island:\d+-->|<!--\/island-->|<explainer-view>|<\/explainer-view>/g;

/**
 * The page's HTML with every view moved, in page order, after the overview, wherever the page rendered it, as views.js expects
 * (it hides [data-overview] while a view shows). A View inside a View or inside a client component is a PackError: the first
 * would be cut in two, and the second would leave the island's DOM out of step with its component.
 */
function hoistViews(html: string, file: string): string {
	const views: string[] = [];
	let rest = "";
	let at = 0;
	let open: number | undefined;
	let inIsland = false;
	for (const { 0: token, index } of html.matchAll(VIEW)) {
		if (token.startsWith("<!--")) {
			inIsland = token !== "<!--/island-->";
		} else if (token === "<explainer-view>") {
			if (open !== undefined || inIsland) {
				throw new PackError(
					`${file}: a View is inside ${inIsland ? "a client component" : "another View"}; put it in the page or a static component, and put client components inside the View instead`,
				);
			}
			rest += html.slice(at, index);
			open = index + token.length;
		} else if (open !== undefined) {
			views.push(html.slice(open, index));
			at = index + token.length;
			open = undefined;
		}
	}
	return rest + html.slice(at) + views.join("");
}

const escapeHtml = (text: string) =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
/** JSON for an inline script: `<` escaped, so no `</script>` or `<!--` can occur in it. */
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

/** The kit scripts the page needs: what its prerendered HTML holds, the kit components its client code can render, and reply: true. */
async function kitScripts(html: string, client: Seen, front: Frontmatter): Promise<Set<string>> {
	const needed = new Set<string>(front.reply ? ["reply.js"] : []);
	let rewriter = new HTMLRewriter();
	for (const [selector, scripts] of HTML_SCRIPTS) {
		rewriter = rewriter.on(selector, {
			element() {
				for (const script of scripts) {
					needed.add(script);
				}
			},
		});
	}
	await rewriter.transform(new Response(html)).text();
	const components = join(KIT_DIR, "components");
	for (const module of client.modules) {
		if (dirname(module) === components) {
			for (const script of COMPONENT_SCRIPTS[basename(module)] ?? []) {
				needed.add(script);
			}
		}
	}
	return needed;
}

/**
 * The HTML page an .mdx file becomes, ready for pack's HTML pass (Mermaid, inlining, load checks): the MDX is compiled and
 * prerendered with Preact, then written into the page shell with the stylesheets its modules import, the islands' props and
 * client bundle, kitLabels and the kit scripts it needs. Every error the author can fix is a PackError.
 */
export async function mdxPage(file: string): Promise<string> {
	// The bundler loads modules by their real path (/tmp is /private/tmp on macOS), and the page is recognised by it.
	const path = realpathSync(file);
	const page = await compileMdx(path, true);
	const compiled = { path, js: page.js };
	const server: Seen = { css: new Set(), modules: new Set() };
	const client: Seen = { css: new Set(), modules: new Set() };
	const { html, islands } = await prerender(compiled, server);
	const modules = [...new Set(islands.map((island) => island.module))];
	const bundle = islands.length ? await clientBundle(compiled, modules, client) : "";
	const needed = await kitScripts(html, client, page.front);
	const kit = (names: string[]) =>
		names.filter((name) => needed.has(name)).map((name) => `<script src="kit:${name}"></script>`);
	const dir = dirname(path);
	const css = [...new Set([...server.css, ...client.css])].map(
		(file) => `<link rel="stylesheet" href="${escapeHtml(relative(dir, file))}">`,
	);
	const islandData = islands.map(({ module, name, props }) => ({
		m: modules.indexOf(module),
		e: name,
		p: props,
	}));
	return [
		"<!doctype html>",
		`<html lang="${escapeHtml(page.front.lang)}">`,
		"<head>",
		'<meta charset="utf-8">',
		'<meta name="viewport" content="width=device-width, initial-scale=1">',
		`<title>${escapeHtml(page.title ?? basename(path, extname(path)))}</title>`,
		'<link rel="stylesheet" href="kit:theme.css">',
		...css,
		"</head>",
		"<body>",
		`<main class="page">${hoistViews(html, relative(process.cwd(), path) || path)}</main>`,
		...(islands.length
			? [
					`<script type="application/json" id="explainer-islands">${scriptJson(islandData)}</script>`,
				]
			: []),
		...(page.front.labels
			? [`<script>var kitLabels = ${scriptJson(page.front.labels)};</script>`]
			: []),
		...kit(BEFORE_ISLANDS),
		...(bundle ? [`<script>${safeScript(bundle)}</script>`] : []),
		...kit(AFTER_ISLANDS),
		"</body>",
		"</html>",
		"",
	].join("\n");
}
