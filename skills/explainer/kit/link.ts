/* link: linked highlighting: elements sharing a data-ref light up together on hover, focus and click; Mermaid node ids are refs. Needs kit:theme.css.
   Elements that share a data-ref light up together (class is-lit) while one of them is hovered, focused or clicked:
     <p>The <span data-ref="cache">cache</span> answers most reads.</p>      a prose term (made focusable)
     <tr data-ref="cache">…</tr>   <div class="chart" data-ref="cache">…</div>   a table row, a chart panel, any element
     <pre class="mermaid">flowchart LR; api --> cache</pre>                   pack gives every diagram part the data-ref of its Mermaid id
   A ref links only when its elements sit in two places or more. One SVG is one place, so the parts of one diagram never link each
   other; any other element is a place of its own. A prose term and a diagram part link, as do two diagrams sharing a node id.
   A part whose refs do not link does nothing: no highlight, no dimming, no focus or pointer. Linked elements carry class is-linked.
   One element may carry several refs, space separated: data-ref="cache db"; its linked ones light. In a diagram that has a lit part, unlit parts dim.
   A click pins the highlight until the next click elsewhere or Escape. Charts: document.addEventListener("ref", (e) => e.detail.refs)
   fires when the lit refs change, with the refs now lit ([] when none), for dispatching a highlight to ECharts.
   Refs a page script writes or removes after load link and unlink at once. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the IIFE only scopes the kit file's names away from the page; the code in it is split into small functions
(() => {
	const refsOf = (el: Part | null) => (el?.dataset.ref ?? "").split(/\s+/).filter(Boolean);
	const NATIVE = "a[href], button, input, select, textarea, summary, [tabindex]";
	/** Refs whose elements sit in two places or more, and the elements carrying one of them; refresh keeps both current. */
	let linked = new Set<string>();
	let linkedParts: Part[] = [];
	/** Elements this script made focusable, so it can undo that when they stop linking. */
	const madeFocusable = new WeakSet<Part>();
	let hovered: Part | null = null;
	let focused: Part | null = null;
	let pinned: Part | null = null;
	let litKey = "";
	let lit: Part[] = [];
	let dimmed: SVGSVGElement[] = [];
	const partOf = (e: Event) =>
		e.target instanceof Element ? e.target.closest<Part>(".is-linked") : null;

	/** The place an element sits in: its outermost SVG, or the element itself. pack's dark copy of an SVG file sits with its light copy. */
	function placeOf(el: Part): Element {
		let svg =
			el instanceof SVGSVGElement ? el : el instanceof SVGElement ? el.ownerSVGElement : null;
		while (svg?.ownerSVGElement) {
			svg = svg.ownerSVGElement;
		}
		const twin = el.previousElementSibling;
		return svg ?? (el.matches("img.dark") && twin?.matches("img.light") ? twin : el);
	}

	/** Marks an element as linked or not. Prose terms and rows are keyboard-reachable; diagram parts are not (a diagram has dozens, prose links to the same refs). */
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
		const places = new Map<string, Set<Element>>();
		const parts = [...document.querySelectorAll<Part>("[data-ref]")];
		for (const el of parts) {
			for (const ref of refsOf(el)) {
				places.set(ref, (places.get(ref) ?? new Set()).add(placeOf(el)));
			}
		}
		linked = new Set([...places].filter(([, where]) => where.size > 1).map(([ref]) => ref));
		const was = linkedParts;
		linkedParts = parts.filter((el) => refsOf(el).some((ref) => linked.has(ref)));
		for (const el of was) {
			mark(el, false);
		}
		for (const el of linkedParts) {
			mark(el, true);
		}
		paint(true);
	}

	/** Lights the linked refs of the active part and announces them when they changed; `force` relights unchanged refs too. */
	function paint(force = false) {
		const active = hovered ?? focused ?? pinned;
		const refs = active?.isConnected ? refsOf(active).filter((ref) => linked.has(ref)) : [];
		const key = refs.join(" ");
		if (key === litKey && !force) {
			return;
		}
		light(refs);
		if (key !== litKey) {
			litKey = key;
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

	const holdsParts = (nodes: NodeList) =>
		[...nodes].some(
			(n) =>
				n instanceof Element && (n.matches("[data-ref]") || n.querySelector("[data-ref]") !== null),
		);
	new MutationObserver((records) => {
		if (
			records.some(
				(r) => r.type === "attributes" || holdsParts(r.addedNodes) || holdsParts(r.removedNodes),
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
