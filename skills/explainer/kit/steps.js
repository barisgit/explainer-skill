/* steps: stepper from attributes: data-stepper on a container, data-step="2 4" on parts, <ol data-captions>, data-steps="id:1,2" on a Mermaid block; adds Back/Play/Next, scrubber, arrow keys. Needs kit:theme.css.
   <figure class="fig" data-stepper>             any element; the controls are added before the captions (else at its end)
     <g data-step="2">  <p data-step="0 3">      a part appears at the first listed step and is lit (is-now) on every listed one;
                                                 0 = visible from the start, lit later; a part without data-step never changes
     <pre class="mermaid" data-steps="api:1 cache:2,4 e1:3">   steps for diagram parts by id: <ref>:<steps, comma separated>
     <ol data-captions><li>Step 1 text</li><li>Step 2 text</li></ol>   one li per step; the current one shows
   </figure>
   Steps count from 1; the number of steps is the number of captions, else the highest step used. The stepper opens on the last
   step (the complete picture, same as print and without JS); Play restarts from step 1 and never starts by itself.
   Mermaid ids are the diagram's own: `flowchart LR; api --> cache` has nodes api and cache; `api e1@--> cache` names the edge e1;
   sequence diagrams have participants by id and messages m1, m2, ... in order. pack fails when data-steps names an id the diagram lacks.
   Focus the stepper (Tab or click inside) and use Left/Right/Home/End. Listen for steps: el.addEventListener("stepchange", (e) => e.detail.step).
   Changing the content: a page may swap scenarios by replacing the captions (ol.innerHTML = ...) or the parts and data-steps. Replacing
   the children of the [data-captions] list is picked up by itself; after any other replacement call Steps.refresh(el, step?). It re-reads
   captions, parts and data-steps, so the step count follows the new content; each stepper counts for itself, so steppers on one page may
   have different lengths. Position: it stays on the current step (clamped to the new count), or on the new last step if it was on the last;
   Steps.refresh(el, 1) restarts. A stepper left with fewer than 2 steps hides its controls and shows everything; they return when it grows.
   stepchange fires when the step or the count changes (and on the first show), never for a refresh that changes neither: the page
   redraws its own state after replacing content, whether or not the event fires.
   Under reduced motion there are no transitions; Play still advances because the reader asked for it. */
(() => {
	const PLAY_MS = 3000;
	const steppers = new WeakMap();

	/** `data-steps="api:1 cache:2,4"` on a diagram: copies each id's steps onto the diagram parts that carry that data-ref. */
	function expandDiagramSteps(root) {
		for (const diagram of root.querySelectorAll("[data-steps]")) {
			for (const token of diagram.dataset.steps.split(/\s+/).filter(Boolean)) {
				const [ref = "", steps = ""] = token.split(":");
				for (const part of diagram.querySelectorAll(`[data-ref~="${CSS.escape(ref)}"]`)) part.dataset.step = steps.replaceAll(",", " ");
			}
		}
	}

	const button = (label, attrs, primary = false) => `<button type="button" class="btn${primary ? " primary" : ""}" ${attrs}>${label}</button>`;

	/** Wires one stepper once and returns its refresh(step?), which re-reads the content and re-applies the step. */
	function create(root) {
		let parts = [];
		let captions = [];
		let total = 0;
		let step = 0;
		let timer = null;
		let announced = "";
		let wired = false;

		const bar = document.createElement("div");
		bar.className = "player";
		bar.setAttribute("role", "group");
		bar.setAttribute("aria-label", "Step controls");
		bar.innerHTML = `${button("Back", 'data-go="-1"')}${button("Play", "data-play", true)}${button("Next", 'data-go="1"')}<input type="range" min="1" aria-label="Step"><output></output>`;
		const [back, play, next] = bar.querySelectorAll("button");
		const range = bar.querySelector("input");
		const readout = bar.querySelector("output");

		const show = (target) => {
			step = Math.max(1, Math.min(total, target));
			for (const { el, steps } of parts) {
				el.classList.toggle("is-on", Math.min(...steps) <= step);
				el.classList.toggle("is-now", steps.includes(step));
			}
			captions.forEach((c, i) => c.classList.toggle("is-now", i === step - 1));
			back.disabled = step === 1;
			next.disabled = step === total;
			range.value = step;
			readout.textContent = `${step} / ${total}`;
			if (announced !== `${step}/${total}`) {
				announced = `${step}/${total}`;
				root.dispatchEvent(new CustomEvent("stepchange", { bubbles: true, detail: { step, steps: total } }));
			}
		};
		const stop = () => {
			clearInterval(timer);
			timer = null;
			play.textContent = "Play";
		};

		bar.addEventListener("click", (e) => {
			const go = e.target.closest("[data-go]");
			if (go) { stop(); show(step + Number(go.dataset.go)); }
		});
		range.addEventListener("input", () => { stop(); show(Number(range.value)); });
		play.addEventListener("click", () => {
			if (timer) return stop();
			if (step === total) show(1);
			play.textContent = "Pause";
			timer = setInterval(() => (step < total ? show(step + 1) : stop()), PLAY_MS);
		});
		root.addEventListener("keydown", (e) => {
			if (!wired || e.target.matches("input, textarea, select") || e.altKey || e.ctrlKey || e.metaKey) return;
			const target = { ArrowLeft: step - 1, ArrowRight: step + 1, Home: 1, End: total }[e.key];
			if (target === undefined) return;
			e.preventDefault();
			stop();
			show(target);
		});

		// Replacing the captions' children re-reads without the page's help. Re-pointed at every refresh, since the list itself may be new.
		const watcher = new MutationObserver(() => refresh());

		function refresh(wanted) {
			const wasLast = step === total;
			expandDiagramSteps(root);
			parts = [...root.querySelectorAll("[data-step]")].map((el) => ({ el, steps: el.dataset.step.trim().split(/\s+/).map(Number) }));
			const captionList = root.querySelector("[data-captions]");
			captions = [...(captionList?.children ?? [])];
			total = captions.length || Math.max(0, ...parts.flatMap((p) => p.steps));
			watcher.disconnect();
			if (captionList) watcher.observe(captionList, { childList: true });

			wired = total >= 2;
			bar.hidden = !wired;
			if (!wired) {
				// Too short to step through: no controls, and without data-live everything shows (the no-JS picture).
				stop();
				delete root.dataset.live;
				step = total = 0; // so growing again reopens on the last step
				announced = "";
				return;
			}
			if (captionList) {
				if (bar.nextElementSibling !== captionList) captionList.before(bar);
			} else if (bar.parentElement !== root) root.append(bar);
			captionList?.setAttribute("aria-live", "polite");
			range.max = total;
			root.tabIndex = 0;
			root.setAttribute("role", "group");
			root.setAttribute("aria-label", root.getAttribute("aria-label") ?? "Step-through; use the arrow keys");
			root.dataset.live = "";
			// The first read opens on the last step (the complete picture); later ones keep the place, and a stepper on its last step stays on it.
			show(wanted ?? (wasLast ? total : step));
		}
		return refresh;
	}

	for (const root of document.querySelectorAll("[data-stepper]")) {
		const refresh = create(root);
		steppers.set(root, refresh);
		refresh();
	}

	window.Steps = {
		refresh(el, step) {
			const refresh = steppers.get(el);
			if (!refresh) throw new Error("Steps.refresh needs an element with data-stepper");
			refresh(step);
		},
	};
})();
