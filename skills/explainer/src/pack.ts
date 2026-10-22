import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { renderMermaid } from "./mermaid.ts";
import { KIT_DIR } from "./paths.ts";
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
		? join(KIT_DIR, ref.slice(4))
		: resolve(baseDir, ref.split(/[?#]/)[0] ?? ref);
	if (!existsSync(path)) {
		const hint = ref.startsWith("kit:") ? ` (kit has: ${readdirSync(KIT_DIR).join(", ")})` : "";
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

/**
 * The text of a text file as a page receives it. A kit script too long for one file keeps parts in `kit/parts/<name>/`; they come first,
 * in file name order, so the page still includes the one file. Anything else is the file itself.
 */
export function readKitText(path: string): string {
	const partsDir = join(KIT_DIR, "parts", basename(path, extname(path)));
	const parts =
		dirname(path) === KIT_DIR && existsSync(partsDir)
			? readdirSync(partsDir)
					.sort()
					.map((part) => readFileSync(join(partsDir, part), "utf8"))
			: [];
	return [...parts, readFileSync(path, "utf8")].join("\n");
}

/** `</script` and `<!--` inside inline script would end or alter the element. */
const safeScript = (js: string) => js.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");

const MERMAID_BLOCK = /<(pre|div)\b([^>]*\bclass="[^"]*\bmermaid\b[^"]*"[^>]*)>([\s\S]*?)<\/\1>/g;
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

/**
 * Replaces every `<pre class="mermaid">` block with its rendered diagram in both colour schemes
 * (`<svg class="light">` and `<svg class="dark">`, switched by theme.css). Syntax errors are returned as problems,
 * and so is a `data-steps="id:1,2 ..."` map that names an id the diagram does not have. `diagramRefs` collects every part id.
 */
async function renderMermaidBlocks(
	html: string,
	problems: string[],
	diagramRefs: Set<string>,
): Promise<string> {
	const blocks = [...html.matchAll(MERMAID_BLOCK)];
	if (!blocks.length) {
		return html;
	}
	const pageCss = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)]
		.map((m) => m[1])
		.join("\n");
	const rendered = await renderMermaid(
		blocks.map((b) => unescapeHtml(b[3] ?? "")),
		pageCss,
	);
	let n = 0;
	return html.replace(MERMAID_BLOCK, (_, _tag, attrs: string) => {
		const r = rendered[n++] ?? new Error("no rendering produced");
		if (r instanceof Error) {
			problems.push(`mermaid block ${n}: ${r.message}`);
			return "";
		}
		const ids = new Set(refsIn(r.light));
		for (const id of ids) {
			diagramRefs.add(id);
		}
		const mapped = (/\bdata-steps="([^"]*)"/.exec(attrs)?.[1] ?? "")
			.split(/\s+/)
			.filter(Boolean)
			.map((t) => t.split(":")[0] ?? "");
		const unknown = mapped.filter((id) => !ids.has(id));
		if (unknown.length) {
			problems.push(
				`mermaid block ${n}: data-steps names ${unknown.map((u) => `"${u}"`).join(", ")}, not in the diagram. Ids: ${[...ids].join(", ")}`,
			);
		}
		return `<div${attrs}>${r.light.replace("<svg ", '<svg class="light" ')}${r.dark.replace("<svg ", '<svg class="dark" ')}</div>`;
	});
}

/** data-ref values the author wrote that nothing else carries: a typo, or a link to nothing. Diagram parts count as partners. */
function loneRefs(source: string, diagramRefs: Set<string>): string[] {
	const counts = new Map<string, number>();
	for (const ref of refsIn(source.replace(MERMAID_BLOCK, ""))) {
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
						`<style>${inlineCss(readFileSync(path, "utf8"), dirname(path), href)}</style>`,
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

/**
 * Returns the page as one HTML file with local CSS, scripts, images and fonts inlined.
 * Mermaid blocks are pre-rendered (needs Chrome). Throws PackError listing every remaining network dependency
 * (remote src/href/url(), srcset) and every diagram that fails to render. `warnings` lists links that go nowhere.
 */
export async function pack(inputPath: string): Promise<{ html: string; warnings: string[] }> {
	const baseDir = dirname(resolve(inputPath));
	const problems: string[] = [];
	const diagramRefs = new Set<string>();
	const original = readFileSync(inputPath, "utf8");
	const source = await renderMermaidBlocks(original, problems, diagramRefs);
	const inlined = await inliningRewriter(baseDir, problems).transform(new Response(source)).text();
	const html = await themeSvgImages(inlined);
	if (problems.length) {
		const remote = problems.some((p) => !p.startsWith("mermaid block"));
		throw new PackError(
			`${problems.map((p) => `- ${p}`).join("\n")}${remote ? "\nFix: save remote files next to the page and reference them relatively, or use kit: files." : ""}`,
		);
	}
	const warnings = loneRefs(original, diagramRefs).map(
		(ref) => `data-ref="${ref}" is the only element with that ref, so it links to nothing`,
	);
	return { html, warnings };
}
