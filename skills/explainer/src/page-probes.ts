/**
 * What check measures inside the page, as source text for `Runtime.evaluate`: each screen's layout and SVG text (PAGE_JS), the
 * first viewport, the drill-down views it links to, the scroll sweep before the shots and the stepper pass. check.ts drives
 * Chrome through them and turns their results into the report.
 */
import { READABLE_PX } from "./mermaid.ts";
import { ELEMENT_NAME_JS, PAINTS_JS, REGION_VISIBLE_JS } from "./page-js.ts";

const TINY_TEXT_PX = 9;
const TALL_FIGURE = 1.5;

/**
 * Page-side function: what to do about an SVG whose smallest text renders at `px`. A diagram pack drew has a readable minimum
 * width unless page CSS overrides it or an older pack made it; a hand-built SVG can be redrawn for the phone width, or keep the
 * width that brings its text to READABLE_PX, as pack does for diagrams, inside a sideways-scrolling block.
 */
const TINY_TEXT_FIX_JS = `(svg, px) => {
	if (svg.parentElement?.matches(".mermaid")) {
		return getComputedStyle(svg).getPropertyValue("--mermaid-min")
			? "a page rule makes the diagram narrower than the min-width pack gives it; drop that rule, and the diagram scrolls sideways at a readable size instead"
			: "pack it again: pack now keeps diagram text at ${READABLE_PX} px or more and lays wide flowcharts out top-down on phones";
	}
	const width = Math.ceil((svg.getBoundingClientRect().width * ${READABLE_PX}) / px);
	return "redraw it in a viewBox about 360 wide with 14-unit text, or keep it at min-width: " + width + "px inside a .scroll block, which scrolls sideways";
}`;

/** What PAGE_JS returns; check reports `overflow` with its culprits and `repeated` as problems, the rest as warnings. */
export interface PageReport {
	overflow: boolean;
	culprits: string[];
	scrolls: string[];
	warnings: string[];
	repeated: string[];
}

/**
 * Runs in the page for the current viewport (`narrow`: the phone width). `culprits`: elements sticking out of the viewport that no scrolling
 * ancestor contains (only auto/scroll counts: hidden/clip would silently cut the content off). `scrolls`: containers whose content is wider
 * than their box and scrolls sideways (a wide data table or equation may, as may an SVG its min-width holds wider, such as a diagram
 * at its readable minimum, so a container holding one is not listed). `warnings`: content cut off inside an overflow hidden/clip box
 * (ellipsis truncation excepted), a missing viewport meta and SVG text rendered under 9 px (narrow only, with the fix TINY_TEXT_FIX_JS
 * names), diagrams and charts (Mermaid, .chart, svg, canvas) taller than 1.5 viewports. Interactive panels (tables, matrices, players
 * with a log) are tall by design and are not measured. SVG text is measured at its on-screen size: font size times the svg's scale to
 * the screen. `repeated`: ids on more than one element, as the page's scripts and `--do` steps left them (problems).
 */
export const PAGE_JS = (narrow: boolean) => `(() => {
	const vw = document.documentElement.clientWidth;
	const name = ${ELEMENT_NAME_JS};
	const scrolls = (el) => { const o = getComputedStyle(el).overflowX; return o === "auto" || o === "scroll"; };
	const clipped = (el) => { for (let p = el.parentElement; p; p = p.parentElement) if (scrolls(p)) return true; return false; };
	const shown = ${PAINTS_JS};
	const region = ${REGION_VISIBLE_JS};
	const all = [...document.body.querySelectorAll("*")];
	const bad = all.filter((el) => el.getBoundingClientRect().right > vw + 1 && !clipped(el) && getComputedStyle(el).position !== "fixed");
	const heldWide = (svg, el) => shown(svg) && parseFloat(getComputedStyle(svg).minWidth) > el.clientWidth + 1;
	const wideByDesign = (el) => [...el.querySelectorAll("table, math")].some((t) => t.getBoundingClientRect().width > el.clientWidth + 1)
		|| [...el.querySelectorAll("svg")].some((svg) => heldWide(svg, el));
	const tinyFix = ${TINY_TEXT_FIX_JS};
	const inner = all.filter((el) => scrolls(el) && region(el) && !wideByDesign(el) && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1);
	const hides = (el) => { const o = getComputedStyle(el); return (o.overflowX === "hidden" || o.overflowX === "clip") && o.textOverflow !== "ellipsis"; };
	const cut = all.filter((el) => hides(el) && region(el) && el.clientWidth > 1 && el.scrollWidth > el.clientWidth + 1);
	const warnings = cut.slice(0, 6).map((el) => name(el) + " has content cut off: " + el.scrollWidth + "px of content in " + el.clientWidth + "px (overflow " + getComputedStyle(el).overflowX + "): let it wrap or shrink, or move it into a .scroll table");
	if (${narrow} && !document.querySelector('meta[name="viewport"]')) warnings.push('no <meta name="viewport" content="width=device-width, initial-scale=1">: phones lay the page out at desktop width and shrink it');
	if (${narrow}) for (const svg of document.querySelectorAll("svg")) {
		if (!shown(svg)) continue;
		const scale = svg.getScreenCTM()?.a ?? 1;
		const tiny = [...svg.querySelectorAll("text, foreignObject *")]
			.filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
			.map((el) => ({ px: parseFloat(getComputedStyle(el).fontSize) * scale, text: el.textContent.trim().slice(0, 24) }))
			.filter((t) => t.px < ${TINY_TEXT_PX}).sort((a, b) => a.px - b.px);
		if (tiny.length) warnings.push(name(svg.parentElement) + " svg: " + tiny.length + " text item(s) render under ${TINY_TEXT_PX} px at " + vw + " px wide (smallest " + tiny[0].px.toFixed(1) + " px, '" + tiny[0].text + "'): " + tinyFix(svg, tiny[0].px));
	}
	const tall = [...document.querySelectorAll(".mermaid, .chart, svg, canvas")].filter((el) => shown(el) && el.getBoundingClientRect().height > innerHeight * ${TALL_FIGURE});
	for (const el of tall.filter((el) => !tall.some((o) => o !== el && o.contains(el)))) {
		const h = el.getBoundingClientRect().height;
		warnings.push(name(el) + " is " + Math.round(h) + " px tall, " + (h / innerHeight).toFixed(1) + " viewports (limit ${TALL_FIGURE}): shrink it, split it or move detail behind a click");
	}
	const ids = new Map();
	for (const el of document.querySelectorAll("[id]")) if (el.id) ids.set(el.id, [...(ids.get(el.id) ?? []), el]);
	const repeated = [...ids].filter(([, els]) => els.length > 1).map(([id, els]) => 'the id "' + id + '" is on ' + els.length + " elements (" + els.map(name).join(", ") + "): scripts, label for, #links and --do steps find only the first; give each its own id");
	return {
		overflow: document.documentElement.scrollWidth > vw + 1, culprits: bad.slice(0, 4).map(name), warnings, repeated,
		scrolls: inner.slice(0, 6).map((el) => name(el) + " (content " + el.scrollWidth + "px in " + el.clientWidth + "px)"),
	};
})()`;

/** Runs in the page before any step: the headline, the figures at least partly in the first viewport (outermost only) and the largest list of in-page links in view. */
export const FIRST_SCREEN_JS = `(() => {
	const name = ${ELEMENT_NAME_JS};
	const shown = ${PAINTS_JS};
	const seen = (el) => { if (!shown(el)) return false; const r = el.getBoundingClientRect(); return r.width >= 120 && r.height >= 80 && Math.min(r.bottom, innerHeight) - Math.max(r.top, 0) >= Math.min(200, r.height * 0.4); };
	const found = [...document.querySelectorAll("figure, .fig, .chart, .mermaid, .dg, svg, canvas, img")].filter(seen);
	const outer = found.filter((el) => !found.some((o) => o !== el && o.contains(el)));
	const headline = document.querySelector("h1")?.textContent.replace(/\\s+/g, " ").trim() ?? "";
	const lists = new Map();
	for (const a of document.querySelectorAll('a[href^="#"]')) {
		const r = a.getBoundingClientRect();
		const list = a.closest("ol, ul, nav");
		if (list && shown(a) && r.width > 0 && r.top >= 0 && r.bottom <= innerHeight) lists.set(list, (lists.get(list) ?? 0) + 1);
	}
	return { links: Math.max(0, ...lists.values()), headline: headline.length > 110 ? headline.slice(0, 107) + "..." : headline, figures: outer.map(name) };
})()`;

/** Runs in the page: every drill-down hash the page links to ("#repo/mobile") or declares (static views, data-view="a/b"), in document order; view templates nothing links to. */
export const DISCOVER_JS = `(() => {
	const names = new Set([...document.querySelectorAll("[data-view]")].map((v) => v.dataset.view));
	const hashes = new Set([...names].filter((n) => n.includes("/")).map((n) => "#" + n));
	for (const a of document.querySelectorAll('a[href^="#"]')) {
		const h = a.getAttribute("href").slice(1);
		if (h && (names.has(h) || names.has(h.split("/")[0]))) hashes.add("#" + h);
	}
	const reached = (n) => [...hashes].some((h) => h === "#" + n || h.startsWith("#" + n + "/"));
	return { hashes: [...hashes], templates: [...names].filter((n) => !n.includes("/") && !reached(n)) };
})()`;

const SWEEP_BUDGET_MS = 3000;
const SWEEP_TICK_MS = 80;
/**
 * Runs in the page: scrolls the document down one viewport at a time to its end and back to the top in one jump, waiting after each step for the
 * frames that deliver IntersectionObserver callbacks and scroll events. Every position is seen, content that grows while scrolling is
 * followed, and the run is cut off after 3 s. Page errors those handlers throw reach the check as they would at any other time.
 */
export const SWEEP_JS = `(async () => {
	const end = performance.now() + ${SWEEP_BUDGET_MS};
	const tick = () => new Promise((done) => {
		const timer = setTimeout(done, ${SWEEP_TICK_MS});
		requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); done(); }));
	});
	const maxTop = () => document.documentElement.scrollHeight - innerHeight;
	let y = 0;
	const to = async (top) => { y = top; scrollTo({ top, behavior: "instant" }); await tick(); };
	while (y < maxTop() && performance.now() < end) await to(Math.min(y + innerHeight, maxTop()));
	if (y > 0) await to(0);
})()`;

const STEPPER_BUDGET_MS = 3000;
const STEPPER_MAX_STEPS = 40;
/**
 * Runs in the page: steps every working stepper (kit:steps.js) until its content, captions and controls aside, looks different
 * from the step it opened on, then returns it there, also when stepping throws. A caption-only stepper is legitimate when the
 * page redraws on stepchange (the stepper's own markup then changes), so pack cannot tell; stepping it shows it. Canvases
 * count by their pixels, since a chart redraw leaves the markup as it was. One stepper takes at most 40 steps and the page 3 s;
 * a stepper still unchanged when either runs out is reported as not fully checked rather than as caption-only.
 */
export const STEPPERS_JS = `(async () => {
	if (!window.Steps) return [];
	const name = ${ELEMENT_NAME_JS};
	const end = performance.now() + ${STEPPER_BUDGET_MS};
	const frame = () => new Promise((done) => requestAnimationFrame(() => setTimeout(done, 30)));
	const look = (root) => {
		const copy = root.cloneNode(true);
		copy.querySelectorAll("[data-captions], .player").forEach((el) => el.remove());
		return copy.innerHTML + [...root.querySelectorAll("canvas")].map((c) => c.toDataURL()).join("");
	};
	/** The steps taken before the stepper looked different, or -1 when it did. */
	const unchangedSteps = async (root, start, total) => {
		const baseline = look(root);
		let taken = 0;
		for (let step = 1; step <= total; step++) {
			if (step === start) continue;
			if (taken === ${STEPPER_MAX_STEPS} || performance.now() > end) return taken;
			Steps.refresh(root, step);
			taken++;
			await frame();
			if (look(root) !== baseline) return -1;
		}
		return taken;
	};
	const warnings = [];
	for (const root of document.querySelectorAll("[data-stepper][data-live]")) {
		const range = root.querySelector(".player input[type=range]");
		const total = Number(range?.max) || 0;
		const start = Number(range?.value) || total;
		let taken;
		try {
			taken = await unchangedSteps(root, start, total);
		} finally {
			Steps.refresh(root, start);
			await frame();
		}
		if (taken < 0 || total < 2) continue;
		warnings.push(taken + 1 < total
			? name(root) + " was not fully checked: its first " + (taken + 1) + " of " + total + " steps change only the captions, and check stops after ${STEPPER_MAX_STEPS} steps or ${STEPPER_BUDGET_MS / 1000} s: step through the rest by hand"
			: name(root) + " steps through " + total + " captions, but nothing else in it changes: show it whole without a Stepper, or mark its parts with data-step=\\"<n>\\" (kit Stepper)");
	}
	return warnings;
})()`;
