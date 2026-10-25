/* link: linked highlighting: elements sharing a data-ref light up together on hover, focus and click; Mermaid node ids are refs. Needs kit:theme.css.
   Elements that share a data-ref light up together (class is-lit) while one of them is hovered, focused or clicked:
     <p>The <span data-ref="cache">cache</span> answers most reads.</p>      a prose term (made focusable)
     <tr data-ref="cache">…</tr>   <div class="chart" data-ref="cache">…</div>   a table row, a chart panel, any element
     <pre class="mermaid">flowchart LR; api --> cache</pre>                   pack gives every diagram part the data-ref of its Mermaid id
   A ref links only when its elements sit in two places or more. One SVG is one place, so the parts of one diagram never link each
   other; any other element is a place of its own. A prose term and a diagram part link, as do two diagrams sharing a node id.
   A part whose refs do not link does nothing: no highlight, no dimming, no focus or pointer, and it does not pass hover or click
   to a linked part around it. Linked elements carry class is-linked.
   One element may carry several refs, space separated: data-ref="cache db"; its linked ones light. In a diagram that has a lit part, unlit parts dim.
   A click pins the highlight until the next click elsewhere or Escape. Charts: document.addEventListener("ref", (e) => e.detail.refs)
   fires when the lit refs change, with the refs now lit ([] when none), for dispatching a highlight to ECharts.
   Refs a page script writes or removes after load link and unlink at once. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the IIFE only scopes the kit file's names away from the page; the code in it is split into small functions
(() => {
	const refsOf = (el: Part | null) => (el?.dataset.ref ?? "").split(/\s+/).filter(Boolean);
	const NATIVE = "a[href], button, input, select, textarea, summary, [tabindex]";

	// What links, kept current by refresh: the refs whose elements sit in two places or more, and the elements carrying one of them.
	let linked = new Set<string>();
	let linkedParts: Part[] = [];
	/** Elements this script made focusable, so it can undo that when they stop linking. */
	const madeFocusable = new WeakSet<Part>();

	// The active part is the hovered one, else the focused one, else the pinned one.
	let hovered: Part | null = null;
	let focused: Part | null = null;
	let pinned: Part | null = null;

	// What paint last did: the refs it lit (space separated, as the ref event last announced them), and the elements it lit and dimmed.
	let litRefs = "";
	let lit: Part[] = [];
	let dimmed: SVGSVGElement[] = [];

	/** The place an element sits in: its outermost SVG, or the element itself. pack's dark copy of an SVG file sits with its light copy. */
	function placeOf(el: Part): Element {
		let svg =
			el instanceof SVGSVGElement ? el : el instanceof SVGElement ? el.ownerSVGElement : null;
		while (svg?.ownerSVGElement) {
			svg = svg.ownerSVGElement;
		}
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

	/** Sets or clears is-linked. Prose terms and rows become keyboard-reachable; diagram parts do not (a diagram has dozens, prose links to the same refs). */
	function mark(el: Part, on: boolean) {
		el.classList.toggle("is-linked", on);
		if (on && !el.matches(NATIVE) && !el.closest("svg")) {
			el.tabIndex = 0;
			madeFocusable.add(el);
		} else if (!on && madeFocusable.delete(el)) {
			el.removeAttribute("tabindex");
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
		dimmed = [
			...new Set(
				lit
					.map((el) => (el instanceof SVGElement ? el.ownerSVGElement : null))
					.filter((svg) => svg !== null),
			),
		];
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
