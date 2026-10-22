import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Page, withPage } from "./browser.ts";
import { KIT_DIR, SKILL_ROOT } from "./paths.ts";

const THEMES = ["light", "dark"] as const;
const RENDER_SIZE = { width: 800, height: 600 };

/**
 * Runs in the render page: gives every diagram part the `data-ref` of its Mermaid id, so prose, steppers and replies can address it
 * (kit:link.js, kit:steps.js, kit:reply.js). Nodes and subgraphs carry their node id, edges their edge id (`a e1@--> b` names one `e1`),
 * sequence participants their id and messages `m1`, `m2`, ... in order. Returns the annotated SVG markup.
 */
const ANNOTATE_JS = `(markup) => {
	const host = document.createElement("div");
	host.innerHTML = markup;
	const svg = host.querySelector("svg");
	const ref = (el, name) => el.setAttribute("data-ref", name);
	const own = (id) => id.slice(svg.id.length + 1);
	for (const g of svg.querySelectorAll("g.node[id]")) ref(g, own(g.id).replace(/^(flowchart|state|classId|entity)-/, "").replace(/-\\d+$/, ""));
	for (const g of svg.querySelectorAll("g.cluster[id]")) ref(g, own(g.id));
	for (const e of svg.querySelectorAll('[data-et="edge"][data-id], [data-et="participant"][data-id], [data-et="life-line"][data-id]')) ref(e, e.dataset.id);
	for (const l of svg.querySelectorAll("g.edgeLabel > g.label[data-id]")) ref(l.parentElement, l.dataset.id);
	const messages = [...svg.querySelectorAll('[data-et="message"]')], texts = [...svg.querySelectorAll("text.messageText")];
	messages.forEach((m, i) => { ref(m, "m" + (i + 1)); if (texts[i]) ref(texts[i], "m" + (i + 1)); });
	return svg.outerHTML;
}`;

/** Mermaid theme variables from the kit's tokens, resolved in the render page for the colour scheme it was set to. */
const RENDER_JS = `(async (sources, theme) => {
	const annotate = ${ANNOTATE_JS};
	const probe = document.body.appendChild(document.createElement("i"));
	// Mermaid's colour maths parses only hex/rgb/hsl, and derived tokens such as --accent-soft compute to color(srgb ...): read them back through a pixel.
	const pixel = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
	const c = (name) => {
		probe.style.color = "var(--" + name + ")";
		pixel.clearRect(0, 0, 1, 1);
		pixel.fillStyle = getComputedStyle(probe).color;
		pixel.fillRect(0, 0, 1, 1);
		const [r, g, b] = pixel.getImageData(0, 0, 1, 1).data;
		return "rgb(" + r + ", " + g + ", " + b + ")";
	};
	const font = getComputedStyle(document.body).fontFamily;
	probe.style.fontFamily = "var(--mono)";
	const mono = getComputedStyle(probe).fontFamily;
	await Promise.all([document.fonts.load("500 14px " + font), document.fonts.load("400 12px " + mono)]);
	mermaid.initialize({
		startOnLoad: false, securityLevel: "strict", theme: "base", fontFamily: font,
		// Blueprint touches: edge annotations in mono, groups drawn as dashed outlines, sequence actors flat like every other box.
		themeCSS: ".edgeLabel, .edgeLabel p, .edgeLabel span { font-family: " + mono + "; font-size: 12px; } .cluster rect { stroke-dasharray: 5 4; } rect.actor { filter: none; }",
		themeVariables: {
			// Flat drawings: the default neo-look shadow is a light grey halo in dark mode.
			darkMode: theme === "dark", fontFamily: font, background: c("bg"), dropShadow: "none", useGradient: false,
			primaryColor: c("surface"), primaryTextColor: c("ink"), primaryBorderColor: c("rule-strong"),
			secondaryColor: c("sunken"), tertiaryColor: c("bg"), lineColor: c("muted"), textColor: c("ink"),
			mainBkg: c("surface"), nodeBorder: c("rule-strong"), clusterBkg: c("sunken"), clusterBorder: c("rule-strong"),
			edgeLabelBackground: c("bg"), titleColor: c("ink"),
			noteBkgColor: c("warn-soft"), noteBorderColor: c("warn"), noteTextColor: c("ink"),
			actorBkg: c("surface"), actorBorder: c("rule-strong"), actorTextColor: c("ink"), actorLineColor: c("rule-strong"),
			signalColor: c("ink"), signalTextColor: c("ink"), labelBoxBkgColor: c("sunken"), labelBoxBorderColor: c("rule-strong"),
			labelTextColor: c("ink"), loopTextColor: c("ink"), activationBkgColor: c("accent-soft"), activationBorderColor: c("accent"),
			sequenceNumberColor: c("accent-ink"),
			pie1: c("c1"), pie2: c("c2"), pie3: c("c3"), pie4: c("c4"), pie5: c("c5"), pie6: c("c6"),
		},
	});
	const out = [];
	for (const [i, source] of sources.entries()) {
		try { out.push({ svg: annotate((await mermaid.render("mm" + i + "-" + theme, source)).svg) }); }
		catch (e) { out.push({ error: String(e.message ?? e).split("\\n").slice(0, 3).join(" ") }); }
	}
	return out;
})`;

interface Rendered {
	svg?: string;
	error?: string;
}

/** Renders every source in the page under the colour scheme (`data-scheme` on <html>, which the kit honours); one entry per source. */
async function renderTheme(
	page: Page,
	sources: string[],
	theme: (typeof THEMES)[number],
): Promise<Rendered[]> {
	await page.evaluate(`document.documentElement.dataset.scheme = "${theme}"`);
	try {
		return await page.evaluate<Rendered[]>(`${RENDER_JS}(${JSON.stringify(sources)}, "${theme}")`);
	} catch (e) {
		throw new Error(`mermaid render failed: ${e instanceof Error ? e.message : String(e)}`);
	}
}

/**
 * Renders each Mermaid source to SVG once per colour scheme, in a headless browser with the kit's fonts and tokens.
 * Returns one `{ light, dark }` pair per source; a source that fails to parse is reported as an Error in its slot.
 * `pageCss` is the page's own inline <style> text, loaded after the kit stylesheet so per-page token overrides (a different `--accent`)
 * reach the diagram. The 5 MB Mermaid bundle stays in vendor/: only the finished SVG ships in the page.
 */
export async function renderMermaid(
	sources: string[],
	pageCss = "",
): Promise<Array<{ light: string; dark: string } | Error>> {
	const dir = mkdtempSync(join(tmpdir(), "artifact-mermaid-"));
	try {
		const file = join(dir, "render.html");
		writeFileSync(
			file,
			`<!doctype html><link rel="stylesheet" href="file://${join(KIT_DIR, "theme.css")}"><style>${pageCss}</style><body class="mermaid"><script src="file://${join(SKILL_ROOT, "vendor/mermaid.min.js")}"></script>`,
		);
		return await withPage(RENDER_SIZE.width, RENDER_SIZE.height, async (page) => {
			await page.load(`file://${file}`);
			const light = await renderTheme(page, sources, "light");
			const dark = await renderTheme(page, sources, "dark");
			return sources.map((_, i) => {
				const [l, d] = [light[i], dark[i]];
				if (!l?.svg || !d?.svg) {
					return new Error(l?.error ?? d?.error ?? "no SVG produced");
				}
				return { light: l.svg, dark: d.svg };
			});
		});
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
