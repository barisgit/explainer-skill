import { realpathSync } from "node:fs";
import { basename, dirname, extname, relative } from "node:path";
import { safeScript } from "../escape.ts";
import { PackError } from "../pack-error.ts";
import { clientBundle, prerender } from "./bundle.ts";
import { compileMdx, type Frontmatter, frontmatterWarnings } from "./compile.ts";
import {
	AFTER_ISLANDS,
	BEFORE_ISLANDS,
	type KitScript,
	scriptsInCode,
	scriptsInHtml,
} from "./kit-scripts.ts";
import { MATH_ELEMENT } from "./math.ts";

/** Island markers, and the element a rendered View is wrapped in (VIEW_MARKER in kit/components/view.tsx) so pack can move it. */
const VIEW = /<!--island:\d+-->|<!--\/island-->|<explainer-view>|<\/explainer-view>/g;

/** How an island marker changes the depth of islands: a start opens one, an end closes one. */
const islandStep = (marker: string) => (marker === "<!--/island-->" ? -1 : 1);

const nestedView = (file: string, inside: string) =>
	new PackError(
		`${file}: a View is inside ${inside}; put it in the page or a static component, and put client components inside the View instead`,
	);

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
	// Islands nest: a kit Chart in another island's slot is an island of its own.
	let islands = 0;
	for (const { 0: token, index } of html.matchAll(VIEW)) {
		if (token.startsWith("<!--")) {
			islands += islandStep(token);
		} else if (token === "<explainer-view>") {
			if (open !== undefined || islands > 0) {
				throw nestedView(file, islands > 0 ? "a client component" : "another View");
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

/**
 * Questions that would mix up the reader's answers: one option name in two questions (data-reply or self-check fieldsets),
 * whose radios would form one group. A Question's option ids are its name and values, so two such Questions also repeat ids, which pack refuses for any page
 * (ids.ts). Controls a client component renders later are not seen.
 */
async function answerClashes(html: string): Promise<string[]> {
	const groups = new Map<string, Set<number>>();
	let fieldsets = 0;
	await new HTMLRewriter()
		.on("fieldset[data-reply], fieldset.self-check", { element: () => void fieldsets++ })
		.on("fieldset[data-reply] input[name], fieldset.self-check input[name]", {
			element(el) {
				const name = el.getAttribute("name") ?? "";
				groups.set(name, (groups.get(name) ?? new Set()).add(fieldsets));
			},
		})
		.transform(new Response(html))
		.text();
	return [...groups]
		.filter(([, inside]) => inside.size > 1)
		.map(
			([name, inside]) =>
				`${inside.size} questions use the name "${name}", so their options would form one group: give each Question its own name`,
		);
}

/** The kit scripts the page needs: for the markup its HTML holds, the markup its client code can write later, and reply: true. */
async function kitScripts(
	html: string,
	bundle: string,
	front: Frontmatter,
): Promise<Set<KitScript>> {
	return new Set([
		...(await scriptsInHtml(html)),
		...scriptsInCode(bundle),
		...(front.reply ? (["keep.js", "reply.js"] as const) : []),
	]);
}

/**
 * The HTML page an .mdx file becomes, ready for pack's HTML pass (inlining, load checks): the MDX is compiled and prerendered
 * with Preact, its Mermaid blocks drawn by `drawDiagrams` (so diagram parts count when the kit scripts are chosen), then written
 * into the page shell with kit:math.css when it holds math, the stylesheets its modules import, the islands' props and client bundle, kitLabels and the kit
 * scripts it needs, with `<html data-scheme>` when the frontmatter forces one. Every error the author can fix is a PackError;
 * `warnings` are what pack prints about the frontmatter (frontmatterWarnings).
 */
export async function mdxPage(
	file: string,
	drawDiagrams: (html: string) => Promise<string>,
): Promise<{ html: string; warnings: string[] }> {
	// The bundler loads modules by their real path (/tmp is /private/tmp on macOS), and the page is recognised by it.
	const path = realpathSync(file);
	const page = await compileMdx(path, true);
	const compiled = { path, js: page.js, lang: page.front.lang };
	const css = new Set<string>();
	const prerendered = await prerender(compiled, css, page.front.labels);
	const clashes = await answerClashes(prerendered.html);
	if (clashes.length) {
		const where = relative(process.cwd(), path) || path;
		throw new PackError(clashes.map((clash) => `${where}: ${clash}`).join("\n"));
	}
	const html = await drawDiagrams(prerendered.html);
	const islands = prerendered.islands;
	const modules = [...new Set(islands.map((island) => island.module))];
	const bundle = islands.length ? await clientBundle(compiled, modules, css) : "";
	const needed = await kitScripts(html, bundle, page.front);
	const kit = (names: KitScript[]) =>
		names.filter((name) => needed.has(name)).map((name) => `<script src="kit:${name}"></script>`);
	const dir = dirname(path);
	const links = [...css].map(
		(file) => `<link rel="stylesheet" href="${escapeHtml(relative(dir, file))}">`,
	);
	const islandData = islands.map(({ module, name, props, view }) => ({
		m: modules.indexOf(module),
		e: name,
		p: props,
		...(view === undefined ? {} : { v: view }),
	}));
	const scheme = page.front.scheme ? ` data-scheme="${page.front.scheme}"` : "";
	const shell = [
		"<!doctype html>",
		`<html lang="${escapeHtml(page.front.lang)}"${scheme}>`,
		"<head>",
		'<meta charset="utf-8">',
		'<meta name="viewport" content="width=device-width, initial-scale=1">',
		`<title>${escapeHtml(page.title ?? basename(path, extname(path)))}</title>`,
		'<link rel="stylesheet" href="kit:theme.css">',
		...(MATH_ELEMENT.test(html) ? ['<link rel="stylesheet" href="kit:math.css">'] : []),
		...links,
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
	];
	return { html: shell.join("\n"), warnings: frontmatterWarnings(page.front) };
}
