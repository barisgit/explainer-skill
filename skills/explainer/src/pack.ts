import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { kitFiles, kitPath, readKitText } from "./kit.ts";
import { findLoads, type Load } from "./loads.ts";
import { renderMermaid } from "./mermaid.ts";
import { themeSvgImages } from "./svg-theme.ts";

const MIME: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".avif": "image/avif",
	".woff2": "font/woff2",
	".woff": "font/woff",
	".ttf": "font/ttf",
	".otf": "font/otf",
};

/** The page cannot become an offline file; the message lists every cause (remote references, missing files, failed diagrams). */
export class PackError extends Error {}

const isRemote = (ref: string) => /^(https?:)?\/\//i.test(ref);
const isInline = (ref: string) => /^(data:|#|about:|javascript:)/i.test(ref);

/** Resolves a reference to a file: `kit:name` points into the CLI's kit/, anything else is relative to `baseDir`. */
function locate(ref: string, baseDir: string): string {
	const path = ref.startsWith("kit:")
		? kitPath(ref.slice(4))
		: resolve(baseDir, ref.split(/[?#]/)[0] ?? ref);
	if (!existsSync(path)) {
		const hint = ref.startsWith("kit:") ? ` (kit has: ${kitFiles().join(", ")})` : "";
		throw new PackError(`missing file: ${ref}${hint}`);
	}
	return path;
}

function dataUri(path: string): string {
	const mime = MIME[extname(path).toLowerCase()];
	if (!mime) {
		throw new PackError(`unsupported asset type: ${path}`);
	}
	return `data:${mime};base64,${readFileSync(path).toString("base64")}`;
}

/** Inlines `url(...)` assets and rejects `@import` and remote URLs, so no stylesheet reaches the network. */
function inlineCss(css: string, baseDir: string, from: string): string {
	if (/@import/i.test(css)) {
		throw new PackError(`@import in ${from}: put the CSS in a <link> or <style> instead`);
	}
	return css.replace(/url\(\s*(["']?)([^)"']+)\1\s*\)/gi, (whole, _q, ref: string) => {
		if (isInline(ref)) {
			return whole;
		}
		if (isRemote(ref)) {
			throw new PackError(`remote url(${ref}) in ${from}`);
		}
		return `url("${dataUri(locate(ref, baseDir))}")`;
	});
}

/** `</script` and `<!--` inside inline script would end or alter the element. */
const safeScript = (js: string) => js.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");

const unescapeHtml = (s: string) =>
	s
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&");

const DATA_REF = /\bdata-ref="([^"]*)"/g;
const refsIn = (markup: string) =>
	[...markup.matchAll(DATA_REF)].flatMap((m) => (m[1] ?? "").split(/\s+/).filter(Boolean));

const STEPPED = `diagrams do not step; drop data-steps, show the diagram whole and link its parts to the text with data-ref="<id>" (kit mermaid)`;

/** A start tag as innerHTML writes it, from the parser's raw (still escaped) attribute values. */
const startTag = (el: HTMLRewriterTypes.Element) =>
	`<${el.tagName}${[...el.attributes].map(([name, value]) => ` ${name}="${value}"`).join("")}>`;

/**
 * Replaces the source of every `pre.mermaid` (or `div.mermaid`) block with its rendered diagram in a `div`: one SVG whose
 * colours follow the page's tokens (theme.css maps them), so light and dark need no second copy. The source is the block's
 * inner HTML, decoded, as Mermaid reads it in a browser, so a literal `<br>` in a label breaks the line like `&lt;br&gt;`.
 * Blocks and attributes are found by the HTML parser, so any spelling the browser accepts counts. Syntax errors, unsupported
 * types, data-steps or data-step on a block (diagrams do not step) and a block left open at the end of the page are returned
 * as problems. `diagramRefs` collects every part id.
 */
function renderMermaidBlocks(
	html: string,
	problems: string[],
	diagramRefs: Set<string>,
): Promise<string> {
	let blocks = 0;
	let open: { n: number; tag: string } | undefined;
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
				open = { n, tag: el.tagName };
				el.tagName = "div";
				el.onEndTag((end) => {
					open = undefined;
					const diagram = renderMermaid(unescapeHtml(parts.join("")), n - 1);
					if (diagram instanceof Error) {
						return void problems.push(`mermaid block ${n}: ${diagram.message}`);
					}
					for (const id of diagram.refs) {
						diagramRefs.add(id);
					}
					end.before(diagram.svg, { html: true });
				});
			},
			// Text inside the block's child elements arrives here too, in document order with their tags.
			text(chunk) {
				source.push(chunk.text);
				chunk.remove();
			},
		})
		.on(".mermaid *", {
			element(el) {
				if (!open) {
					return;
				}
				const parts = source;
				const tag = el.tagName;
				parts.push(startTag(el));
				if (el.canHaveContent) {
					el.onEndTag(() => void parts.push(`</${tag}>`));
				}
				el.removeAndKeepContent();
			},
		})
		.onDocument({
			end() {
				if (open) {
					problems.push(
						`mermaid block ${open.n} has no end tag, so the rest of the page is its source: close it with </${open.tag}>`,
					);
				}
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
		.on("iframe[src], audio[src], embed[src], object[data]", {
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
			return `@import in ${origin.label}: put the CSS in a <link> or <style> instead`;
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
 * Returns the page as one HTML file with local CSS, scripts, images and fonts inlined.
 * Mermaid blocks are pre-rendered in this process. Throws PackError listing every remaining network dependency
 * (remote src/href/url(), srcset, and anything findLoads finds in the finished page) and every diagram that fails to render. `warnings` lists links that go nowhere.
 */
export async function pack(inputPath: string): Promise<{ html: string; warnings: string[] }> {
	const baseDir = dirname(resolve(inputPath));
	const problems: string[] = [];
	const diagramRefs = new Set<string>();
	const original = readFileSync(inputPath, "utf8");
	const source = await renderMermaidBlocks(original, problems, diagramRefs);
	const inlined = await inliningRewriter(baseDir, problems).transform(new Response(source)).text();
	const html = await themeSvgImages(inlined);
	// The inliner names the loads it sees as written; findLoads also finds the escaped ones, so the same load can come twice.
	const all = [...new Set([...problems, ...(await findLoads(html)).map(loadMessage)])];
	if (all.length) {
		const remote = all.some((p) => !p.startsWith("mermaid block"));
		throw new PackError(
			`${all.map((p) => `- ${p}`).join("\n")}${remote ? "\nFix: save remote files next to the page and reference them relatively, or use kit: files." : ""}`,
		);
	}
	const warnings = loneRefs(original, diagramRefs).map(
		(ref) => `data-ref="${ref}" is the only element with that ref, so it links to nothing`,
	);
	return { html, warnings };
}
