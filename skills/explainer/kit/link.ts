/* link: linked highlighting: elements sharing a data-ref light up together on hover, focus and click; Mermaid node ids are refs. pack includes it for data-ref.
   Elements that share a data-ref light up together (class is-lit) while one of them is hovered, focused or clicked:
     <p>The <span data-ref="cache">cache</span> answers most reads.</p>      a prose term (made focusable)
     <tr data-ref="cache">…</tr>   <div class="chart" data-ref="cache">…</div>   a table row, a chart panel, any element
     a ```mermaid fence                                                       pack gives every diagram part the data-ref of its Mermaid id
   A ref links only when its elements sit in two places or more. An element's place is its outermost SVG (HTML in a foreignObject
   too), so the parts of one diagram never link each other; the light and dark copies pack makes of an SVG file in <img> count
   once; any other element is a place of its own. A prose term and a diagram part link, as do two diagrams sharing a node id.
   A part whose refs do not link does nothing: no highlight, no dimming, no focus or pointer, and it does not pass hover or click
   to a linked part around it. Linked elements carry class is-linked; kit reply keeps its note targets focusable on its own.
   One element may carry several refs, space separated: data-ref="cache db"; its linked ones light. In an SVG that has a lit part, unlit parts dim.
   A click pins the highlight until the next click elsewhere, Escape, or its part stops linking. Charts: document.addEventListener("ref", (e) => e.detail.refs)
   fires when the lit refs change, with the refs now lit ([] when none), for dispatching a highlight to ECharts.
   Refs a client component renders or removes after load link and unlink at once. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the IIFE only scopes the kit file's names away from the page; the code in it is split into small functions
(() => {
	const refsOf = (el: Part | null) => (el?.dataset.ref ?? "").split(/\s+/).filter(Boolean);
	/** Elements the browser already makes focusable. */
	const NATIVE = "a[href], button, input, select, textarea, summary";

	// What links, kept current by refresh: the refs whose elements sit in two places or more, and the elements carrying one of them.
	let linked = new Set<string>();
	let linkedParts: Part[] = [];

	// The active part is the hovered one, else the focused one, else the pinned one.
	let hovered: Part | null = null;
	let focused: Part | null = null;
	let pinned: Part | null = null;

	// What paint last did: the refs it lit (space separated, as the ref event last announced them), and the elements it lit and dimmed.
	let litRefs = "";
	let lit: Part[] = [];
	let dimmed: SVGSVGElement[] = [];

	/** The outermost SVG holding `el` (HTML in a foreignObject included), or null outside any SVG. */
	function outermostSvg(el: Element): SVGSVGElement | null {
		let svg = el.closest("svg");
		for (let up = svg?.parentElement?.closest("svg"); up; up = up.parentElement?.closest("svg")) {
			svg = up;
		}
		return svg;
	}

	/** The place an element sits in: its outermost SVG, or the element itself. pack's dark copy of an SVG file sits with its light copy. */
	function placeOf(el: Part): Element {
		const svg = outermostSvg(el);
		if (svg) {
			return svg;
		}
		const twin = el.previousElementSibling;
		return el.matches("img.dark") && twin?.matches("img.light") ? twin : el;
	}

	/** The refs among `parts` whose elements sit in two places or more. */
	function linkingRefs(parts: Part[]): Set<string> {
		const places = new Map<string, Set<Element>>();
		for (const el of parts) {
			for (const ref of refsOf(el)) {
				places.set(ref, (places.get(ref) ?? new Set()).add(placeOf(el)));
			}
		}
		return new Set([...places].filter(([, where]) => where.size > 1).map(([ref]) => ref));
	}

	/** Sets or clears is-linked and, through syncFocus, the focus it gives. */
	function mark(el: Part, on: boolean) {
		el.classList.toggle("is-linked", on);
		syncFocus(el);
	}

	/**
	 * Makes a part keyboard-reachable while it is linked or a kit:reply.js note target (is-annotatable), and undoes only what the
	 * kit set (data-kit-focusable, while the tabindex is still its 0), so a tabindex the author or a page script wrote stays.
	 * reply.js keeps the same rule, which cannot be shared: each kit file is a script of its own. Reading both classes makes the
	 * result the same whichever script runs first. Diagram parts are not made reachable: a diagram has dozens, and prose links to
	 * the same refs.
	 */
	function syncFocus(el: Part) {
		const wanted =
			el.matches(".is-linked, .is-annotatable") && !el.matches(NATIVE) && !el.closest("svg");
		if (wanted && !el.hasAttribute("tabindex")) {
			el.tabIndex = 0;
			el.dataset.kitFocusable = "";
		} else if (!wanted && el.dataset.kitFocusable !== undefined) {
			// The marker says the kit set a tabindex once; a page script may have written its own since (views.js writes -1).
			if (el.getAttribute("tabindex") === "0") {
				el.removeAttribute("tabindex");
			}
			delete el.dataset.kitFocusable;
		}
	}

	/** Recounts the places of every ref, re-marks the elements and repaints, since the lit part may have gained or lost its partners. */
	function refresh() {
		const parts = [...document.querySelectorAll<Part>("[data-ref]")];
		linked = linkingRefs(parts);
		// Unmark the previous set, then mark the new one (the sets overlap, so the order matters). The previous set also holds
		// elements removed from the page or stripped of their data-ref, which the query no longer finds.
		for (const el of linkedParts) {
			mark(el, false);
		}
		linkedParts = parts.filter((el) => refsOf(el).some((ref) => linked.has(ref)));
		for (const el of linkedParts) {
			mark(el, true);
		}
		// A pin outlives no partner: once its part stops linking it ends, so a partner written back later does not revive it.
		if (pinned && !linkedParts.includes(pinned)) {
			pinned = null;
		}
		paint(true);
	}

	/**
	 * Lights the linked refs of the active part and announces them when they changed. `force` relights unchanged refs too, for
	 * refresh: the elements carrying them may have changed.
	 */
	function paint(force = false) {
		const active = hovered ?? focused ?? pinned;
		const refs = active?.isConnected ? refsOf(active).filter((ref) => linked.has(ref)) : [];
		const joined = refs.join(" ");
		if (joined === litRefs && !force) {
			return;
		}
		light(refs);
		if (joined !== litRefs) {
			litRefs = joined;
			document.dispatchEvent(new CustomEvent("ref", { detail: { refs } }));
		}
	}

	/** Lights every element carrying one of `refs` and dims the rest of the SVGs that hold one. */
	function light(refs: string[]) {
		for (const el of lit) {
			el.classList.remove("is-lit");
		}
		for (const svg of dimmed) {
			svg.classList.remove("has-lit");
		}
		const selector = refs.map((ref) => `[data-ref~="${CSS.escape(ref)}"]`).join(",");
		lit = selector ? [...document.querySelectorAll<Part>(selector)] : [];
		for (const el of lit) {
			el.classList.add("is-lit");
		}
		dimmed = [...new Set(lit.map(outermostSvg).filter((svg) => svg !== null))];
		for (const svg of dimmed) {
			svg.classList.add("has-lit");
		}
	}

	// A refresh reads every data-ref on the page, so it runs only for a changed data-ref (the one observed attribute) or an added or
	// removed node that holds one, not for every DOM change a page script or another kit script makes.
	const holdsRef = (n: Node) =>
		n instanceof Element && (n.matches("[data-ref]") || n.querySelector("[data-ref]") !== null);
	new MutationObserver((records) => {
		if (
			records.some(
				(r) => r.type === "attributes" || [...r.addedNodes, ...r.removedNodes].some(holdsRef),
			)
		) {
			refresh();
		}
	}).observe(document.documentElement, {
		subtree: true,
		childList: true,
		attributeFilter: ["data-ref"],
	});
	refresh();

	/** The part an event happened in when it is linked: an unlinked part takes no hover, focus or click, nor passes them to a linked ancestor. */
	const partOf = (e: Event) => {
		const part = e.target instanceof Element ? e.target.closest<Part>("[data-ref]") : null;
		return part?.classList.contains("is-linked") ? part : null;
	};
	document.addEventListener("pointerover", (e) => {
		if (e.pointerType === "touch") {
			return;
		}
		hovered = partOf(e);
		paint();
	});
	document.addEventListener("focusin", (e) => {
		focused = partOf(e);
		paint();
	});
	document.addEventListener("focusout", () => {
		focused = null;
		paint();
	});
	document.addEventListener("click", (e) => {
		const target = partOf(e);
		pinned = target && target !== pinned ? target : null;
		paint();
	});
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && pinned) {
			pinned = null;
			paint();
		}
	});
})();
