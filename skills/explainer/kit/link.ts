/* link: linked highlighting: elements sharing a data-ref light up together on hover, focus and click; Mermaid node ids are refs. Needs kit:theme.css.
   Elements that share a data-ref light up together (class is-lit) while one of them is hovered, focused or clicked:
     <p>The <span data-ref="cache">cache</span> answers most reads.</p>      a prose term (made focusable)
     <tr data-ref="cache">…</tr>   <div class="chart" data-ref="cache">…</div>   a table row, a chart panel, any element
     <pre class="mermaid">flowchart LR; api --> cache</pre>                   pack gives every diagram part the data-ref of its Mermaid id
   Refs are page-wide: a prose data-ref lights every element with that ref on the page, across figures (two diagrams sharing a node id light together).
   One element may link several refs, space separated: data-ref="cache db". In a diagram that has a lit part, unlit parts dim.
   A click pins the highlight until the next click elsewhere or Escape. Charts: document.addEventListener("ref", (e) => e.detail.refs)
   fires with the refs now lit ([] when none), for dispatching a highlight to ECharts. Wired once at load: set data-ref in the markup. */
(() => {
	const refsOf = (el: Part | null) => (el?.dataset.ref ?? "").split(/\s+/).filter(Boolean);
	const NATIVE = "a[href], button, input, select, textarea, summary, [tabindex]";
	let hovered: Part | null = null;
	let focused: Part | null = null;
	let pinned: Part | null = null;
	let lit: Part[] = [];
	let dimmed: SVGSVGElement[] = [];
	const partOf = (e: Event) =>
		e.target instanceof Element ? e.target.closest<Part>("[data-ref]") : null;

	// Prose terms and rows are keyboard-reachable; diagram parts are not (a diagram has dozens, prose links to the same refs).
	for (const el of document.querySelectorAll<Part>("[data-ref]")) {
		if (!el.matches(NATIVE) && !el.closest("svg")) {
			el.tabIndex = 0;
		}
	}

	function paint() {
		const refs = refsOf(hovered ?? focused ?? pinned);
		const selector = refs.map((ref) => `[data-ref~="${CSS.escape(ref)}"]`).join(",");
		for (const el of lit) {
			el.classList.remove("is-lit");
		}
		for (const svg of dimmed) {
			svg.classList.remove("has-lit");
		}
		lit = selector ? [...document.querySelectorAll<Part>(selector)] : [];
		for (const el of lit) {
			el.classList.add("is-lit");
		}
		// A lone part has nothing to be linked with, so it does not dim its neighbours.
		dimmed =
			lit.length > 1
				? [
						...new Set(
							lit
								.map((el) => (el instanceof SVGElement ? el.ownerSVGElement : null))
								.filter((svg) => svg !== null),
						),
					]
				: [];
		for (const svg of dimmed) {
			svg.classList.add("has-lit");
		}
		document.dispatchEvent(new CustomEvent("ref", { detail: { refs } }));
	}

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
