import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { classCollisions } from "./collisions.ts";
import { dataUri } from "./data-uri.ts";
import { safeScript, unescapeHtml } from "./escape.ts";
import { repeatedIdProblems } from "./ids.ts";
import { kitFiles, kitPath, readKitText } from "./kit.ts";
import { findLoads, type Load } from "./loads.ts";
import { mdxPage } from "./mdx/page.ts";
import { renderMermaid } from "./mermaid.ts";
import { PackError } from "./pack-error.ts";
import { themeSvgImages } from "./svg-theme.ts";

const IMPORT_FIX = 'import that stylesheet from the page instead (import "./other.css")';

const isRemote = (ref: string) => /^(https?:)?\/\//i.test(ref);
const isInline = (ref: string) => /^(data:|#|about:|javascript:)/i.test(ref);

/** The path a local reference names: `kit:name` points into the CLI's kit/, anything else is relative to `baseDir`. */
const refPath = (ref: string, baseDir: string): string =>
	ref.startsWith("kit:") ? kitPath(ref.slice(4)) : resolve(baseDir, ref.split(/[?#]/)[0] ?? ref);

/** Resolves a local reference to an existing file, or throws a PackError naming it. */
function locate(ref: string, baseDir: string): string {
	const path = refPath(ref, baseDir);
	if (!existsSync(path)) {
		const hint = ref.startsWith("kit:") ? ` (kit has: ${kitFiles().join(", ")})` : "";
		throw new PackError(`missing file: ${ref}${hint}`);
	}
	return path;
}

/** A CSS url(): its value in double quotes, single quotes or bare. */
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"']+))\s*\)/gi;

/** Inlines `url(...)` assets and rejects `@import` and remote URLs, so no stylesheet reaches the network. */
function inlineCss(css: string, baseDir: string, from: string): string {
	if (/@import/i.test(css)) {
		throw new PackError(`@import in ${from}: ${IMPORT_FIX}`);
	}
	// A quoted value is matched whole, so a url() inside it (an SVG data URI's url(%23marker)) stays part of its text.
	return css.replace(CSS_URL, (whole, double?: string, single?: string, bare?: string) => {
		const ref = (double ?? single ?? bare ?? "").trim();
		if (isInline(ref)) {
			return whole;
		}
		if (isRemote(ref)) {
			throw new PackError(`remote url(${ref}) in ${from}`);
		}
		return `url("${dataUri(locate(ref, baseDir))}")`;
	});
}

const DATA_REF = /\bdata-ref="([^"]*)"/g;
const refsIn = (markup: string) =>
	[...markup.matchAll(DATA_REF)].flatMap((m) => (m[1] ?? "").split(/\s+/).filter(Boolean));

const STEPPED = `diagrams do not step; drop data-steps, show the diagram whole and link its parts to the text with data-ref="<id>" (kit mermaid)`;

/**
 * Replaces the source of every `pre.mermaid` (or `div.mermaid`) block with its rendered diagram in a `div`: an SVG whose
 * colours follow the page's tokens (theme.css maps them), so light and dark need no second copy, then the phone copy when
 * renderMermaid makes one. The source is the block's text, decoded, as Mermaid reads it in a browser: a ```mermaid fence
 * becomes such a block with its source escaped, so a `<br>` in a label breaks the line. Syntax errors, unsupported types and data-steps or data-step on a block (diagrams do not step)
 * are returned as problems. `diagramRefs` collects every part id.
 */
function renderMermaidBlocks(
	html: string,
	problems: string[],
	diagramRefs: Set<string>,
): Promise<string> {
	let blocks = 0;
	let source: string[] = [];
	return new HTMLRewriter()
		.on("pre.mermaid, div.mermaid", {
			element(el) {
				const n = ++blocks;
				if (el.hasAttribute("data-steps") || el.hasAttribute("data-step")) {
					problems.push(`mermaid block ${n}: ${STEPPED}`);
				}
				const parts: string[] = [];
				source = parts;
				el.tagName = "div";
				el.onEndTag((end) => {
					const diagram = renderMermaid(unescapeHtml(parts.join("")), n - 1);
					if (diagram instanceof Error) {
						return void problems.push(`mermaid block ${n}: ${diagram.message}`);
					}
					for (const id of diagram.refs) {
						diagramRefs.add(id);
					}
					end.before(diagram.svg + (diagram.phone ?? ""), { html: true });
				});
			},
			text(chunk) {
				source.push(chunk.text);
				chunk.remove();
			},
		})
		.transform(new Response(html))
		.text();
}

/** data-ref values the author wrote that nothing else carries: a typo, or a link to nothing. Diagram parts count as partners. */
function loneRefs(source: string, diagramRefs: Set<string>): string[] {
	const counts = new Map<string, number>();
	for (const ref of refsIn(source)) {
		counts.set(ref, (counts.get(ref) ?? 0) + 1);
	}
	return [...counts]
		.filter(([ref, count]) => count === 1 && !diagramRefs.has(ref))
		.map(([ref]) => ref);
}

/**
 * The rewriter that inlines local CSS, scripts, images and fonts; every remote or unreadable reference is added to `problems`
 * instead of throwing, so one run reports them all.
 */
function inliningRewriter(baseDir: string, problems: string[]): HTMLRewriter {
	const attempt = <T>(fn: () => T, fallback: T): T => {
		try {
			return fn();
		} catch (e) {
			if (!(e instanceof PackError)) {
				throw e;
			}
			problems.push(e.message);
			return fallback;
		}
	};
	return new HTMLRewriter()
		.on("link[rel~=stylesheet][href]", {
			element(el) {
				const href = el.getAttribute("href") ?? "";
				if (isRemote(href)) {
					return void problems.push(`remote stylesheet: ${href}`);
				}
				const path = attempt(() => locate(href, baseDir), "");
				if (path) {
					el.replace(
						// readKitText puts kit:theme.css's parts in front of it, all in @layer kit; a page's own stylesheet is read as it is.
						`<style>${inlineCss(readKitText(path), dirname(path), href)}</style>`,
						{ html: true },
					);
				}
			},
		})
		.on("script[src]", {
			element(el) {
				const src = el.getAttribute("src") ?? "";
				if (isRemote(src)) {
					return void problems.push(`remote script: ${src}`);
				}
				const path = attempt(() => locate(src, baseDir), "");
				if (!path) {
					return;
				}
				const type = el.getAttribute("type");
				el.replace(
					`<script${type ? ` type="${type}"` : ""}>${safeScript(readKitText(path))}</script>`,
					{ html: true },
				);
			},
		})
		.on("img[src], source[src], video[poster], image[href], link[rel~=icon][href]", {
			element(el) {
				for (const attr of ["src", "poster", "href"]) {
					const ref = el.getAttribute(attr);
					if (!ref || isInline(ref)) {
						continue;
					}
					if (isRemote(ref)) {
						problems.push(`remote ${el.tagName}: ${ref}`);
					} else {
						el.setAttribute(
							attr,
							attempt(() => dataUri(locate(ref, baseDir)), ref),
						);
					}
				}
			},
		})
		.on("img[srcset], source[srcset]", {
			element: (el) =>
				void problems.push(
					`<${el.tagName} srcset> is not inlined: use src with one local image (srcset="${el.getAttribute("srcset")}")`,
				),
		})
		.on("[style]", {
			element(el) {
				const style = el.getAttribute("style") ?? "";
				const inlined = attempt(() => inlineCss(style, baseDir, "a style attribute"), style);
				if (inlined !== style) {
					el.setAttribute("style", inlined);
				}
			},
		})
		.on("iframe[src], audio[src], video[src], track[src], embed[src], object[data]", {
			element: (el) =>
				void problems.push(`<${el.tagName}> loads a separate resource; embed its content instead`),
		})
		.on("style", {
			text(chunk) {
				if (chunk.text) {
					chunk.replace(
						attempt(() => inlineCss(chunk.text, baseDir, "<style>"), chunk.text),
						{ html: true },
					);
				}
			},
		});
}

const DIAGRAM_COLOURS =
	"a packed page loads nothing, so give style, classDef and linkStyle colours (fill:#e33) or kit tokens (fill:var(--accent))";

/** A problem findLoads reports, as the author fixes it; one in a diagram points to the Mermaid style syntax. */
function loadMessage({ origin, kind, target }: Load): string {
	if (origin.block && kind !== "unreadable" && kind !== "entity") {
		return `mermaid block ${origin.block}: the diagram references ${target}; ${DIAGRAM_COLOURS}`;
	}
	const remote = isRemote(target);
	switch (kind) {
		case "url":
			return `remote url(${target}) in ${origin.label}`;
		case "local":
			return `url(${target}) in ${origin.label} is not inlined: write url() without CSS escapes so pack can inline it`;
		case "import":
			return `@import in ${origin.label}: ${IMPORT_FIX}`;
		case "href":
			return remote
				? `remote ${origin.label}: ${target}`
				: `${origin.label} loads ${target}: put what it points to in the page and point at its #id`;
		case "entity":
			return `${origin.label} uses the HTML entity ${target}, which pack does not read: write the character itself`;
		case "unreadable":
			return `pack cannot read the CSS in ${origin.label} (${target}), so it cannot tell what that CSS loads: fix the CSS`;
	}
}

/**
 * Packs an .mdx page into one HTML file: it is compiled and prerendered (mdx/page.ts), then goes through `packPage`.
 * Throws PackError listing everything the author must fix; `warnings` are the frontmatter's, then the HTML pass's.
 */
export async function pack(mdxPath: string): Promise<{ html: string; warnings: string[] }> {
	const path = resolve(mdxPath);
	const warnings: string[] = [];
	// The page draws its diagrams before it chooses its kit scripts, so diagram parts bring link.js.
	const packed = await packPage(dirname(path), async (drawDiagrams) => {
		const page = await mdxPage(path, drawDiagrams);
		warnings.push(...page.warnings);
		return page.html;
	});
	return { html: packed.html, warnings: [...warnings, ...packed.warnings] };
}

/**
 * Everything after prerendering: the page `render` returns (it draws the Mermaid blocks with the function it is given, in this
 * process) becomes one HTML file with local CSS, scripts, images and fonts inlined, relative to `baseDir`. Authors reach it only
 * through `pack`; the kit runtime tests hand it hand-written HTML. Throws PackError listing every remaining network dependency
 * (remote src/href/url(), srcset, and anything findLoads finds in the finished page) and every diagram that fails to render,
 * then, once those are fixed, every id the finished page has on more than one element.
 * `warnings` lists links that go nowhere and page classes the kit styles too (see classCollisions).
 */
export async function packPage(
	baseDir: string,
	render: (drawDiagrams: (html: string) => Promise<string>) => Promise<string>,
): Promise<{ html: string; warnings: string[] }> {
	const problems: string[] = [];
	const diagramRefs = new Set<string>();
	const source = await render((html) => renderMermaidBlocks(html, problems, diagramRefs));
	const inlined = await inliningRewriter(baseDir, problems).transform(new Response(source)).text();
	const html = await themeSvgImages(inlined);
	// The inliner names the loads it sees as written; findLoads also finds the escaped ones, so the same load can come twice.
	const all = [...new Set([...problems, ...(await findLoads(html)).map(loadMessage)])];
	if (all.length) {
		const remote = all.some((p) => !p.startsWith("mermaid block"));
		throw new PackError(
			`${all.map((p) => `- ${p}`).join("\n")}${remote ? "\nFix: save remote files next to the page and import or reference them relatively." : ""}`,
		);
	}
	const repeated = await repeatedIdProblems(html);
	if (repeated.length) {
		throw new PackError(repeated.map((p) => `- ${p}`).join("\n"));
	}
	const warnings = [
		...loneRefs(source, diagramRefs).map(
			(ref) => `data-ref="${ref}" is the only element with that ref, so it links to nothing`,
		),
		...(await classCollisions(source, (href) => {
			const path = isRemote(href) ? "" : refPath(href, baseDir);
			return path && existsSync(path) ? path : undefined;
		})),
	];
	return { html, warnings };
}
