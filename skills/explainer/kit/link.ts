/* link: linked highlighting: elements sharing a data-ref light up together on hover, focus and click; Mermaid node ids are refs. pack includes it for data-ref.
   Elements that share a data-ref light up together (class is-lit) while one of them is hovered, focused or clicked:
     <p>The <span data-ref="cache">cache</span> answers most reads.</p>      a prose term (made focusable)
     <tr data-ref="cache">…</tr>   <div class="chart" data-ref="cache">…</div>   a table row, a chart panel, any element
     a ```mermaid fence                                                       pack gives every diagram part the data-ref of its Mermaid id
     ```mermaid tag:inv=2 and <span data-ref="inv">2</span>                     a number tag on node inv, and a mention pack draws as the same tag
     ```ts ref:cache="cache.get"                                              every cache.get in the code fence (kit code)
   A ref links only when its elements sit in two places or more. An element's place is its outermost SVG (HTML in a foreignObject
   too), else its pre, so the parts of one diagram or code block never link each other; the light and dark copies pack makes
   of an SVG file in <img> count once, as do a diagram and the copy pack lays out for phones; any other element is a place of
   its own. A prose term and a diagram part link, as do two diagrams sharing a node id.
   A part whose refs do not link does nothing: no highlight, no dimming, no focus or pointer, and it does not pass hover or click
   to a linked part around it. Linked elements carry class is-linked; kit reply keeps its note targets focusable on its own.
   One element may carry several refs, space separated: data-ref="cache db"; its linked ones light.
   A lit term takes the accent's tint; a lit SVG part is outlined in the accent, its text and wires keep their ink, and the rest of
   that SVG fades a little, whichever side is hovered. Keyboard focus lights a part too.
   A click pins the highlight until the next click elsewhere, Escape, or its part stops linking. Charts: document.addEventListener("ref", (e) => e.detail.refs)
   fires when the lit refs change, with the refs now lit ([] when none), for dispatching a highlight to ECharts.
   Refs a client component renders or removes after load link and unlink at once.
   States: a Stepper step (kit Stepper) or an Explore frame (kit Explore) can give the parts of a ref a named state, which this
   script writes as data-state on every element carrying that ref, wherever it is on the page (Mermaid parts too), linked or not:
     [data-state="imports"] { background: var(--accent-soft); }   the page's CSS styles its own state names
   The kit styles only the stepper's: now (lit) and not-yet (faded until its step, still there for keyboards and screen readers;
   print shows it). pack writes the starting state into the file, so it reads without scripts, and fails on a state for a ref no
   element has. A part given states by two controls carries both, space separated: match one with [data-state~="imports"]; now
   wins over not-yet. A data-state you write yourself on a part no control names stays as written, unstyled by the kit. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the IIFE only scopes the kit file's names away from the page; the code in it is split into small functions
(() => {
	const refsOf = (el: Part | null) => (el?.dataset.ref ?? "").split(/\s+/).filter(Boolean);
	/** Elements the browser already makes focusable. */
	const NATIVE = "a[href], button, input, select, textarea, summary";

	// What links, kept current by refresh: the refs whose elements sit in two places or more, and the elements carrying one of them.
	let linked = new Set<string>();
	let linkedParts: Part[] = [];

	// The active part is the hovered one, else the focused one while the reader is on the keyboard, else the pinned one. A click
	// focuses a term too, but that focus is not a request to light it: the click pins or unpins, and the light leaves with the
	// pointer. A key press other than Escape hands lighting back to focus, without moving it.
	let hovered: Part | null = null;
	let focused: Part | null = null;
	let pinned: Part | null = null;
	let onKeyboard = true;

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

	/**
	 * The place an element sits in: its outermost SVG, else its pre, else the element itself. pack's dark copy of an SVG file sits
	 * with its light copy, and a diagram's phone copy (svg[data-phone]) with the diagram before it.
	 */
	function placeOf(el: Part): Element {
		const svg = outermostSvg(el);
		if (svg) {
			const twin = svg.previousElementSibling;
			return svg.matches("svg[data-phone]") && twin instanceof SVGSVGElement ? twin : svg;
		}
		const pre = el.closest("pre");
		if (pre) {
			return pre;
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
	 * result the same whichever script runs first. Diagram parts are not made reachable, a diagram has dozens and prose links to
	 * the same refs, but a number tag (data-tag) is: the reader looks it up.
	 */
	function syncFocus(el: Part) {
		const wanted =
			el.matches(".is-linked, .is-annotatable") &&
			!el.matches(NATIVE) &&
			(!el.closest("svg") || el.matches("[data-tag]"));
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

	/** One declaration: the JSON map of ref to state ("" for none) that kit:steps.js or an Explore writes in data-ref-states. */
	function declared(el: Part): [string, unknown][] {
		try {
			const map: unknown = JSON.parse(el.dataset.refStates ?? "");
			return map !== null && typeof map === "object" ? Object.entries(map) : [];
		} catch {
			return [];
		}
	}

	/** The states the declarations give each ref they name, in page order, each once; a ref named with "" alone gets none. */
	function givenStates(): Map<string, string[]> {
		const given = new Map<string, string[]>();
		for (const el of document.querySelectorAll<Part>("[data-ref-states]")) {
			for (const [ref, state] of declared(el)) {
				const states = given.get(ref) ?? [];
				if (typeof state === "string" && state && !states.includes(state)) {
					states.push(state);
				}
				given.set(ref, states);
			}
		}
		return given;
	}

	/** The joined state of a part's refs, each once in page order; the kit's now wins over not-yet when two steppers name one part. */
	function joined(states: string[]): string {
		const set = new Set(states);
		if (set.has("now")) {
			set.delete("not-yet");
		}
		return [...set].join(" ");
	}

	/** Clears a state the kit wrote, with its data-kit-state marker. */
	function unstate(el: Part) {
		el.removeAttribute("data-state");
		delete el.dataset.kitState;
	}

	/** Writes `value` as the kit's state of `el`, marked data-kit-state, or clears it when empty; an unchanged one is left. */
	function state(el: Part, value: string) {
		if (!value) {
			unstate(el);
		} else if (el.getAttribute("data-state") !== value || el.dataset.kitState === undefined) {
			el.setAttribute("data-state", value);
			el.dataset.kitState = "";
		}
	}

	/**
	 * The one writer of data-state: every element carrying a ref some declaration names gets the states its refs are given,
	 * marked data-kit-state (the kit styles now and not-yet only there), and loses both when none is given. Elements no
	 * declaration names are left as they are, so a page's own data-state (a Table row's fit) stays.
	 */
	function writeStates(parts: Part[]) {
		const given = givenStates();
		const named = given.size ? parts.filter((el) => refsOf(el).some((ref) => given.has(ref))) : [];
		const still = new Set(named);
		for (const el of document.querySelectorAll<Part>("[data-kit-state]")) {
			if (!still.has(el)) {
				unstate(el);
			}
		}
		for (const el of named) {
			state(el, joined(refsOf(el).flatMap((ref) => given.get(ref) ?? [])));
		}
	}

	/** Recounts the places of every ref, re-marks the elements and repaints, since the lit part may have gained or lost its partners. */
	function refresh() {
		const parts = [...document.querySelectorAll<Part>("[data-ref]")];
		writeStates(parts);
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
		const active = hovered ?? (onKeyboard ? focused : null) ?? pinned;
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

	// A refresh reads every data-ref on the page, so it runs only for a changed data-ref or an added or removed node that holds a
	// ref or a declaration, not for every DOM change a page script or another kit script makes. A changed declaration alone (a
	// step, a choice) only rewrites the states.
	const WATCHED = "[data-ref], [data-ref-states]";
	const holdsRef = (n: Node) =>
		n instanceof Element && (n.matches(WATCHED) || n.querySelector(WATCHED) !== null);
	new MutationObserver((records) => {
		if (
			records.some(
				(r) =>
					r.attributeName === "data-ref" || [...r.addedNodes, ...r.removedNodes].some(holdsRef),
			)
		) {
			refresh();
		} else if (records.some((r) => r.attributeName === "data-ref-states")) {
			writeStates([...document.querySelectorAll<Part>("[data-ref]")]);
		}
	}).observe(document.documentElement, {
		subtree: true,
		childList: true,
		attributeFilter: ["data-ref", "data-ref-states"],
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
	document.addEventListener("pointerdown", () => {
		onKeyboard = false;
		paint();
	});
	document.addEventListener("click", (e) => {
		const target = partOf(e);
		pinned = target && target !== pinned ? target : null;
		paint();
	});
	document.addEventListener("keydown", (e) => {
		// Escape dismisses: it drops the pin and hands nothing back to a focus the mouse gave.
		if (e.key === "Escape") {
			pinned = null;
		} else {
			onKeyboard = true;
		}
		paint();
	});
})();
