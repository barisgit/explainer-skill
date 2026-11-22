/**
 * The reading load of the light-desktop overview as it arrives, measured on the rendered DOM: the words a reader sees on the first
 * screen and on load, the number of sections, and per section the words outside a figure, table, diagram or code and whether one
 * is in it. Words count only where text paints: closed folds, hidden views, `display: none`, screen-reader-only text and the kit's
 * own controls (reply bar, Question choices, Explore controls, contents rail) are out.
 */
import { IN_CLOSED_FOLD_JS } from "./page-js.ts";

/**
 * Bare words a section with no figure, table, diagram or code may hold before check warns: the guide's "more than about 150",
 * with room for a closing basis section (electricity-mix's Sources holds 153; no other example passes 98).
 */
export const BARE_WORDS_LIMIT = 175;

/**
 * Evidence: what a figure, table, diagram or code block is made of (Chart, Plot, Mermaid and schematic drawings, SVG, images, tables,
 * code blocks, formulas, stats, Records). A `.fig` or `figure` wrapper alone is no evidence: Controls renders a `.fig` of controls.
 */
const VISUAL =
	"svg, canvas, img, video, table, pre, math, .chart, .mermaid, .schematic, .stats, .records, .tree, .board";

/** The kit's own controls: a question's choices and legend, buttons, the contents rail, the reply bar. Not words of the page. */
const CHROME =
	"legend, button, label, nav, dialog, .reply-bar, .toolbar, .facets, .controls, .controls-state, .seg, .plot-strip";

/** Headings name a section; they count as words on load but not as its prose. */
const HEADINGS = "h1, h2, h3, h4, h5, h6";

export interface SectionLoad {
	/** Its own heading (the closest section of the heading is this one), "" without one. */
	heading: string;
	/** Words outside every figure, table, diagram, code block, heading and piece of chrome. */
	words: number;
	/** Whether a figure, table, diagram or code block shows in the section. */
	visual: boolean;
}

export interface ReadingLoad {
	firstScreenWords: number;
	loadWords: number;
	sections: number;
	/** Per section that shows anything, in document order. */
	bare: SectionLoad[];
}

/** Runs in the page: see the module comment. */
export const READING_JS = `(() => {
	const visual = ${JSON.stringify(VISUAL)};
	const chrome = ${JSON.stringify(CHROME)};
	const bareSkip = visual + ", " + chrome + ", " + ${JSON.stringify(HEADINGS)};
	const folded = ${IN_CLOSED_FOLD_JS};
	const found = new Map();
	const register = (el) => {
		const s = el.closest("section");
		if (s && !found.has(s)) found.set(s, { words: 0, visual: false });
		return s && found.get(s);
	};
	for (const s of document.querySelectorAll("section")) if (s.getClientRects().length && !folded(s)) register(s);
	// A box a pixel wide is no figure; neither is an icon.
	for (const el of document.querySelectorAll(visual)) {
		const r = el.getBoundingClientRect();
		if (r.width >= 48 && r.height >= 32 && getComputedStyle(el).visibility === "visible" && !folded(el)) {
			const section = register(el);
			if (section) section.visual = true;
		}
	}
	const styles = new Map();
	const styleOf = (el) => { if (!styles.has(el)) styles.set(el, getComputedStyle(el)); return styles.get(el); };
	// Screen-reader-only text: a box of a pixel that hides its overflow, or a legacy clip rect. A clip-path alone (the kit's .band) hides nothing.
	const hidden = (el) => {
		for (let p = el; p && p !== document.body; p = p.parentElement) {
			const style = styleOf(p);
			if (style.clip !== "auto" && style.position === "absolute") return true;
			if (style.overflow !== "visible") { const r = p.getBoundingClientRect(); if (r.width <= 1 || r.height <= 1) return true; }
		}
		return false;
	};
	// The part of the page the reader sees: the viewport cut by every clipping or scrolling ancestor.
	const windows = new Map();
	const windowOf = (el) => {
		if (!windows.has(el)) {
			const style = styleOf(el);
			const up = el.parentElement && el.parentElement !== document.body ? windowOf(el.parentElement) : { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
			const own = style.overflowX !== "visible" || style.overflowY !== "visible" ? el.getBoundingClientRect() : up;
			windows.set(el, { left: Math.max(up.left, own.left), top: Math.max(up.top, own.top), right: Math.min(up.right, own.right), bottom: Math.min(up.bottom, own.bottom) });
		}
		return windows.get(el);
	};
	const shows = (r, w) => r.left < w.right && r.right > w.left && r.top < w.bottom && r.bottom > w.top && w.right > w.left && w.bottom > w.top;
	const range = document.createRange();
	let firstScreenWords = 0, loadWords = 0;
	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const el = node.parentElement;
		const words = (node.nodeValue.match(/\\S+/g) ?? []).length;
		if (!words || !el || el.closest("script, style, noscript, template, " + chrome) || styleOf(el).visibility !== "visible" || folded(node)) continue;
		range.selectNodeContents(node);
		const rects = [...range.getClientRects()].filter((r) => r.width >= 2 && r.height >= 2);
		if (!rects.length || hidden(el)) continue;
		const view = windowOf(el);
		loadWords += words;
		firstScreenWords += (words * rects.filter((r) => shows(r, view)).length) / rects.length;
		const section = register(el);
		if (section && !el.closest(bareSkip)) section.words += words;
	}
	const bare = [...found].sort(([a], [b]) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)).map(([s, { words, visual }]) => {
		const own = [...s.querySelectorAll("h1, h2, h3, h4, h5, h6")].find((h) => h.closest("section") === s);
		return { heading: own?.textContent.replace(/\\s+/g, " ").trim() ?? "", words: Math.round(words), visual };
	});
	return { firstScreenWords: Math.round(firstScreenWords), loadWords, sections: bare.length, bare };
})()`;

/** One warning per section over BARE_WORDS_LIMIT words with no figure, table, diagram or code, located by its place in the page and its heading. */
export function readingWarnings({ bare }: ReadingLoad): string[] {
	return bare.flatMap((s, i) =>
		s.words > BARE_WORDS_LIMIT && !s.visual
			? [
					`section ${i + 1}${s.heading ? ` "${s.heading}"` : ""} has ${s.words} words and no figure, table, diagram or code (more than about 150 read as a wall): make its answer a figure, table or diagram and keep the prose to interpreting it`,
				]
			: [],
	);
}

/** The report's lines for the overview on arrival: first screen, load, sections, and the bare words of each section. */
export function readingLines({
	firstScreenWords,
	loadWords,
	sections,
	bare,
}: ReadingLoad): string[] {
	return [
		`Reading load (light desktop overview, on arrival): ${firstScreenWords} words on the first screen, ${loadWords} on load, ${sections} section${sections === 1 ? "" : "s"}`,
		...(bare.length ? [`  bare words per section: ${bare.map((s) => s.words).join(", ")}`] : []),
	];
}
