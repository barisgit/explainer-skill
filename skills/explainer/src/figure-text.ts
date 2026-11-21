/**
 * What check measures of the text inside a Chart's or Plot's SVG: text that crosses the figure's box (a phone copy's label cut at
 * the edge) or overlaps other text (a legend over the axis labels, two tick labels run together). Pack's drawings are measured on a
 * load with the page's scripts off, where they are what the reader sees until the kit scripts draw; a live drawing where it is SVG
 * (a Plot, redrawn at the element's own size). A live Chart is a canvas, whose text cannot be measured, so its drawing stands for it.
 */
import { ELEMENT_NAME_JS, PAINTS_JS } from "./page-js.ts";

/**
 * A glyph cell spans the font's ascent and descent (Geist: 1.01 and 0.29 em); the band from the baseline up to the capitals'
 * height (0.7 em), without the cell's top quarter and bottom 22 %, is the letters' body, so labels set a line apart, or a
 * descender over the next line's ascender space, never count as touching.
 */
const BAND_TOP = 0.25;
const BAND_BOTTOM = 0.22;
/** Pixels two bodies must overlap by before it shows: anti-aliasing and side bearings stay below. */
const OVERLAP_PX = 1;
/** Pixels a body must cross the figure's edge by: a tick label's baseline a pixel past a Plot's box (which does not clip) is not cut. */
const CROSS_PX = 2;
/** Texts quoted per kind and figure. */
const QUOTED = 3;
/** The page's measuring time: a figure with thousands of labels on one spot stops here and says how far it got. */
const BUDGET_MS = 1000;

/** What FIGURE_TEXT_JS found in one figure: counts and the first texts of each kind; `complete` false when the budget ran out. */
export interface FigureText {
	/** The figure's id, else its place and name: the same figure in the script-free load and the live one. */
	key: string;
	figure: string;
	out: number;
	outTexts: string[];
	pairs: number;
	pairTexts: string[];
	complete: boolean;
}

/**
 * Runs in the page: what each figure (a `.chart`) with a shown SVG has of text crossing the figure's box or overlapping other
 * text. `drawn` measures pack's copies (a `.chart-drawn > svg`, a Chart's or inside a Plot's area), else the live SVG the kit
 * scripts drew. Each character is a polygon on screen (its cell's body band through the text's transform, so rotated labels
 * count as drawn), and two texts overlap when bodies of theirs intersect by OVERLAP_PX (a separating axis test). A text drawn twice in place (a halo under its
 * copy) counts once; a character is cut to its rectangular clip-paths (a scrolling legend's other pages are no text), and text
 * that paints nothing is left out. Texts are compared in order of their left edge, within one budget for the page, checked inside
 * every loop; once it runs out, each figure left reports itself incomplete.
 */
export const FIGURE_TEXT_JS = (drawn: boolean) => `(() => {
	const end = performance.now() + ${BUDGET_MS};
	let over = false;
	const late = () => over || (over = performance.now() > end);
	const name = ${ELEMENT_NAME_JS};
	const shown = ${PAINTS_JS};
	const quote = (t) => "'" + (t.length > 32 ? t.slice(0, 29) + "..." : t) + "'";
	const figureName = (chart) => {
		const label = chart.getAttribute("aria-label") ?? "";
		return name(chart) + (label ? ' "' + (label.length > 48 ? label.slice(0, 45) + "..." : label) + '"' : "");
	};
	const paints = (s) => (s.fill !== "none" && Number(s.fillOpacity) > 0)
		|| (s.stroke !== "none" && Number(s.strokeOpacity) > 0 && parseFloat(s.strokeWidth) > 0);
	const map = (t, x, y) => ({ x: t.a * x + t.c * y + t.e, y: t.b * x + t.d * y + t.f });
	/** The screen boxes of the clip-paths on the text and its ancestors up to the svg, or null when one is not a url() clip. */
	const clips = (text, svg) => {
		const boxes = [];
		for (let el = text; el; el = el === svg ? null : el.parentElement) {
			const s = getComputedStyle(el);
			if (Number(s.opacity) === 0) return null;
			if (s.clipPath === "none") continue;
			const id = /^url\\("?#([^")]+)"?\\)$/.exec(s.clipPath)?.[1];
			const clip = id && document.getElementById(id);
			const m = el.getScreenCTM();
			if (!clip || !m || clip.getAttribute("clipPathUnits") === "objectBoundingBox") return null;
			for (const shape of clip.children) {
				const own = shape.transform?.baseVal.consolidate()?.matrix;
				const t = own ? m.multiply(own) : m;
				const b = shape.getBBox();
				const pts = [map(t, b.x, b.y), map(t, b.x + b.width, b.y), map(t, b.x, b.y + b.height), map(t, b.x + b.width, b.y + b.height)];
				boxes.push(bounds([pts]));
			}
		}
		return boxes;
	};
	/** A convex polygon cut to an axis-aligned box (Sutherland-Hodgman): what of a character a rectangular clip lets through. */
	const cut = (poly, box) => {
		const edges = [(p) => p.x - box.left, (p) => box.right - p.x, (p) => p.y - box.top, (p) => box.bottom - p.y];
		for (const inside of edges) {
			const next = [];
			for (let i = 0; i < poly.length; i++) {
				const p = poly[i], q = poly[(i + 1) % poly.length], dp = inside(p), dq = inside(q);
				if (dp >= 0) next.push(p);
				if ((dp >= 0) !== (dq >= 0)) { const k = dp / (dp - dq); next.push({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k }); }
			}
			poly = next;
			if (poly.length < 3) return [];
		}
		return poly;
	};
	/** The characters' body bands as screen polygons, cut to the text's clips: whitespace and hidden characters left out. */
	const bodies = (text, boxes) => {
		const m = text.getScreenCTM();
		if (!m) return [];
		const polys = [];
		for (let i = 0; i < text.getNumberOfChars() && !late(); i++) {
			if (/\\s/.test(text.textContent[i] ?? "")) continue;
			let r;
			try { r = text.getExtentOfChar(i); } catch { continue; }
			if (!r.width || !r.height) continue;
			const top = r.y + r.height * ${BAND_TOP}, bottom = r.y + r.height * (1 - ${BAND_BOTTOM});
			let poly = [map(m, r.x, top), map(m, r.x + r.width, top), map(m, r.x + r.width, bottom), map(m, r.x, bottom)];
			for (const box of boxes) poly = poly.length ? cut(poly, box) : poly;
			if (poly.length >= 3) polys.push(poly);
		}
		return polys;
	};
	function bounds(polys) {
		const xs = polys.flat().map((p) => p.x), ys = polys.flat().map((p) => p.y);
		return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
	}
	/** How deep two convex polygons overlap along their least overlapping axis (separating axis test); 0 when apart. */
	const depth = (a, b) => {
		let least = Infinity;
		for (const poly of [a, b]) for (let i = 0; i < poly.length; i++) {
			const p = poly[i], q = poly[(i + 1) % poly.length];
			const len = Math.hypot(q.x - p.x, q.y - p.y);
			if (len < 1e-6) continue;
			const nx = (p.y - q.y) / len, ny = (q.x - p.x) / len;
			const span = (s) => { const v = s.map((r) => r.x * nx + r.y * ny); return [Math.min(...v), Math.max(...v)]; };
			const [a0, a1] = span(a), [b0, b1] = span(b);
			least = Math.min(least, Math.min(a1, b1) - Math.max(a0, b0));
			if (least <= 0) return 0;
		}
		return least;
	};
	const meet = (a, b) => {
		if (a.box.top > b.box.bottom || b.box.top > a.box.bottom) return false;
		for (const pa of a.polys) {
			if (late()) return false;
			if (b.polys.some((pb) => depth(pa, pb) > ${OVERLAP_PX})) return true;
		}
		return false;
	};
	const near = (a, b) => Math.abs(a.left - b.left) < 1 && Math.abs(a.right - b.right) < 1 && Math.abs(a.top - b.top) < 1;
	/** The figure's texts that paint something, each once. */
	const measure = (svgs) => {
		const texts = [];
		for (const svg of svgs) for (const el of svg.querySelectorAll("text")) {
			if (late()) return texts;
			const content = el.textContent.replace(/\\s+/g, " ").trim();
			if (!content || !shown(el) || !paints(getComputedStyle(el))) continue;
			const boxes = clips(el, svg);
			const polys = boxes ? bodies(el, boxes) : [];
			if (!polys.length) continue;
			const box = bounds(polys);
			if (!texts.some((t) => t.content === content && near(t.box, box))) texts.push({ content, polys, box });
		}
		return texts;
	};
	/** A Chart's copies sit in .chart-drawn, a Plot's in its .plot-area's; the live pass takes the SVGs outside them. */
	const figureSvgs = (chart) => [...chart.querySelectorAll(${drawn ? '".chart-drawn > svg"' : '"svg"'})]
		.filter((svg) => svg.closest(".chart") === chart && ${drawn ? "true" : '!svg.closest(".chart-drawn") && !svg.parentElement?.closest("svg")'}
			&& shown(svg) && svg.getBoundingClientRect().width > 0);
	const results = [];
	[...document.querySelectorAll(".chart")].forEach((chart, index) => {
		const svgs = figureSvgs(chart);
		if (!svgs.length) return;
		const frame = chart.getBoundingClientRect();
		const texts = measure(svgs).sort((a, b) => a.box.left - b.box.left);
		const outs = texts.filter((t) => t.box.left < frame.left - ${CROSS_PX} || t.box.right > frame.right + ${CROSS_PX} || t.box.top < frame.top - ${CROSS_PX} || t.box.bottom > frame.bottom + ${CROSS_PX});
		const pairTexts = [];
		let pairs = 0;
		for (let i = 0; i < texts.length && !late(); i++) {
			for (let j = i + 1; j < texts.length && texts[j].box.left <= texts[i].box.right && !late(); j++) {
				if (!meet(texts[i], texts[j])) continue;
				pairs++;
				if (pairTexts.length < ${QUOTED}) pairTexts.push(quote(texts[i].content) + " and " + quote(texts[j].content));
			}
		}
		if (outs.length || pairs || over) results.push({
			key: chart.id ? "#" + chart.id : index + " " + figureName(chart), figure: figureName(chart),
			out: outs.length, outTexts: outs.slice(0, ${QUOTED}).map((t) => quote(t.content)), pairs, pairTexts, complete: !over,
		});
	});
	return results;
})()`;

/** What one figure's findings say, or "" when it has none. */
function findings(f: FigureText): string {
	const parts: string[] = [];
	if (f.out) {
		parts.push(`${f.out} text(s) cross the figure's box (${f.outTexts.join(", ")})`);
	}
	if (f.pairs) {
		parts.push(`${f.pairs} pair(s) of texts overlap (${f.pairTexts.join("; ")})`);
	}
	return parts.join(" and ");
}

/**
 * The warnings for one width: a figure whose drawing and live SVG show the same findings is named once. A figure whose texts
 * ran past the page's budget says so.
 */
export function figureTextWarnings(
	width: number,
	drawn: FigureText[],
	live: FigureText[],
): string[] {
	const fix =
		": give the texts room (grid or axis bounds, shorter or fewer labels, a taller figure with height) or move one";
	const at = (f: FigureText, where: string) => `${f.figure}${where} at ${width} px wide: `;
	const same = (a: FigureText, b: FigureText) =>
		a.key === b.key && findings(a) !== "" && findings(a) === findings(b);
	const warnings = [
		...drawn
			.filter((f) => findings(f))
			.map((f) => {
				const where = live.some((l) => same(f, l))
					? " as pack drew it and live"
					: " as pack drew it";
				return `${at(f, where)}${findings(f)}${fix}`;
			}),
		...live
			.filter((f) => findings(f) && !drawn.some((d) => same(d, f)))
			.map((f) => `${at(f, " live")}${findings(f)}${fix}`),
	];
	const cutShort = (f: FigureText, where: string) =>
		`${at(f, where)}figure text not fully measured, the page's ${BUDGET_MS / 1000} s ran out: look at its texts in the PNGs`;
	warnings.push(
		...drawn.filter((f) => !f.complete).map((f) => cutShort(f, " as pack drew it")),
		...live.filter((f) => !f.complete).map((f) => cutShort(f, " live")),
	);
	return warnings;
}
