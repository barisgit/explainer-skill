import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KIT_DIR } from "./paths.ts";

const SCHEMES = ["light", "dark"] as const;
type Scheme = (typeof SCHEMES)[number];

/** The colour tokens of theme.css's `:root` block: the one place their values live, so a file sees what the page sees. */
function colourTokens(): string {
	const css = readFileSync(join(KIT_DIR, "theme.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
	return (/:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "")
		.split(";")
		.map((declaration) => declaration.trim())
		.filter((declaration) => /^--.*(light-dark|color-mix)\(/.test(declaration))
		.join(";");
}

/**
 * The svg with a first rule that gives its root the scheme's colours: `currentColor` is `--ink` and every colour token
 * resolves for `scheme`. The rule has no specificity, so anything the file sets itself wins. A root that is not a plain `<svg>`
 * (a prefixed one) is left as it is.
 */
function themedSvg(svg: string, scheme: Scheme, tokens: string): string {
	const rule = `<style>:where(:root){color-scheme:${scheme};color:var(--ink);${tokens}}</style>`;
	let done = false;
	return new HTMLRewriter()
		.on("svg", {
			element(root) {
				if (!done) {
					done = true;
					root.prepend(rule, { html: true });
				}
			},
		})
		.transform(svg);
}

const SVG_DATA = "data:image/svg+xml;base64,";

/**
 * Replaces each `<img>` of a base64 svg (what `pack` makes of a local svg file) with one image per colour scheme, classes `light`
 * and `dark`, shown by theme.css like the Mermaid diagrams: an image document cannot read the page's CSS, so each copy carries
 * the scheme's colours instead. Attributes go to both copies, the id only to the first so it stays unique. An `<img>` inside
 * `<picture>` stays as it is, since the browser picks among the sources.
 */
export async function themeSvgImages(html: string): Promise<string> {
	const tokens = colourTokens();
	let pictures = 0;
	return await new HTMLRewriter()
		.on("picture", {
			element(el) {
				pictures++;
				el.onEndTag(() => {
					pictures--;
				});
			},
		})
		.on(`img[src^="${SVG_DATA}"]`, {
			element(img) {
				if (pictures) {
					return;
				}
				const svg = Buffer.from((img.getAttribute("src") ?? "").slice(SVG_DATA.length), "base64");
				const copies = SCHEMES.map((scheme) => {
					const attrs = new Map(img.attributes);
					const themed = themedSvg(svg.toString("utf8"), scheme, tokens);
					attrs.set("src", SVG_DATA + Buffer.from(themed).toString("base64"));
					attrs.set("class", [attrs.get("class"), scheme].filter(Boolean).join(" "));
					if (scheme === "dark") {
						attrs.delete("id");
					}
					const written = [...attrs].map(
						([name, value]) => `${name}="${value.replaceAll('"', "&quot;")}"`,
					);
					return `<img ${written.join(" ")}>`;
				});
				img.replace(copies.join(""), { html: true });
			},
		})
		.transform(new Response(html))
		.text();
}
