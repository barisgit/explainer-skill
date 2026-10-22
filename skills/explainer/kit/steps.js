/* steps: stepper from attributes: data-stepper on a container, data-step="2 4" on parts, <ol data-captions>, data-steps="id:1,2" on a Mermaid block; adds Back/Play/Next, scrubber, arrow keys. Needs kit:theme.css.
   <figure class="fig" data-stepper>             any element; the controls are added before the captions (else at its end)
     <g data-step="2">  <p data-step="0 3">      a part appears at the first listed step and is lit (is-now) on every listed one;
                                                 0 = visible from the start, lit later; a part without data-step never changes
     <pre class="mermaid" data-steps="api:1 cache:2,4 e1:3">   steps for diagram parts by id: <ref>:<steps, comma separated>
     <ol data-captions><li>Step 1 text</li><li>Step 2 text</li></ol>   one li per step; the current one shows
   </figure>
   Steps count from 1; the number of steps is the number of captions, else the highest step used. The stepper opens on the last
   step (the complete picture, same as print and without JS); data-start="1" on the stepper opens it on step 1 instead (any
   number works; study pages start at the beginning). Play restarts from step 1 and never starts by itself.
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
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the IIFE only scopes the kit file's names away from the page; the code in it is split into small functions
(() => {
	const PLAY_MS = 3000;
	const steppers = new WeakMap();

	/** `data-steps="api:1 cache:2,4"` on a diagram: copies each id's steps onto the diagram parts that carry that data-ref. */
	function expandDiagramSteps(root) {
		for (const diagram of root.querySelectorAll("[data-steps]")) {
			for (const token of diagram.dataset.steps.split(/\s+/).filter(Boolean)) {
				const [ref = "", steps = ""] = token.split(":");
				for (const part of diagram.querySelectorAll(`[data-ref~="${CSS.escape(ref)}"]`)) {
					part.dataset.step = steps.replaceAll(",", " ");
				}
			}
		}
	}

	const button = (label, attrs, primary = false) =>
		`<button type="button" class="btn${primary ? " primary" : ""}" ${attrs}>${label}</button>`;

	/** One stepper: its controls, the current step and the content it steps through. */
	class Stepper {
		parts = [];
		captions = [];
		total = 0;
		step = 0;
		timer = null;
		announced = "";
		wired = false;

		constructor(root) {
			this.root = root;
			this.bar = document.createElement("div");
			this.bar.className = "player";
			this.bar.setAttribute("role", "group");
			this.bar.setAttribute("aria-label", "Step controls");
			this.bar.innerHTML = `${button("Back", 'data-go="-1"')}${button("Play", "data-play", true)}${button("Next", 'data-go="1"')}<input type="range" min="1" aria-label="Step"><output></output>`;
			[this.back, this.play, this.next] = this.bar.querySelectorAll("button");
			this.range = this.bar.querySelector("input");
			this.readout = this.bar.querySelector("output");
			this.bindControls();
			this.bindKeys();
			// Replacing the captions' children re-reads without the page's help. Re-pointed at every refresh, since the list itself may be new.
			this.watcher = new MutationObserver(() => this.refresh());
		}

		show(target) {
			this.step = Math.max(1, Math.min(this.total, target));
			for (const { el, steps } of this.parts) {
				el.classList.toggle("is-on", Math.min(...steps) <= this.step);
				el.classList.toggle("is-now", steps.includes(this.step));
			}
			for (const [i, caption] of this.captions.entries()) {
				caption.classList.toggle("is-now", i === this.step - 1);
			}
			this.back.disabled = this.step === 1;
			this.next.disabled = this.step === this.total;
			this.range.value = this.step;
			this.readout.textContent = `${this.step} / ${this.total}`;
			if (this.announced !== `${this.step}/${this.total}`) {
				this.announced = `${this.step}/${this.total}`;
				this.root.dispatchEvent(
					new CustomEvent("stepchange", {
						bubbles: true,
						detail: { step: this.step, steps: this.total },
					}),
				);
			}
		}

		stop() {
			clearInterval(this.timer);
			this.timer = null;
			this.play.textContent = "Play";
		}

		bindControls() {
			this.bar.addEventListener("click", (e) => {
				const go = e.target.closest("[data-go]");
				if (go) {
					this.stop();
					this.show(this.step + Number(go.dataset.go));
				}
			});
			this.range.addEventListener("input", () => {
				this.stop();
				this.show(Number(this.range.value));
			});
			this.play.addEventListener("click", () => {
				if (this.timer) {
					return this.stop();
				}
				if (this.step === this.total) {
					this.show(1);
				}
				this.play.textContent = "Pause";
				this.timer = setInterval(
					() => (this.step < this.total ? this.show(this.step + 1) : this.stop()),
					PLAY_MS,
				);
			});
		}

		bindKeys() {
			this.root.addEventListener("keydown", (e) => {
				if (
					!this.wired ||
					e.target.matches("input, textarea, select") ||
					e.altKey ||
					e.ctrlKey ||
					e.metaKey
				) {
					return;
				}
				const { step, total } = this;
				const target = { ArrowLeft: step - 1, ArrowRight: step + 1, Home: 1, End: total }[e.key];
				if (target === undefined) {
					return;
				}
				e.preventDefault();
				this.stop();
				this.show(target);
			});
		}

		/** Re-reads captions, parts and data-steps; returns the captions list element, if any. */
		readContent() {
			expandDiagramSteps(this.root);
			this.parts = [...this.root.querySelectorAll("[data-step]")].map((el) => ({
				el,
				steps: el.dataset.step.trim().split(/\s+/).map(Number),
			}));
			const captionList = this.root.querySelector("[data-captions]");
			this.captions = [...(captionList?.children ?? [])];
			this.total = this.captions.length || Math.max(0, ...this.parts.flatMap((p) => p.steps));
			this.watcher.disconnect();
			if (captionList) {
				this.watcher.observe(captionList, { childList: true });
			}
			return captionList;
		}

		/** Puts the controls before the captions (else at the end of the stepper) and makes the stepper keyboard-reachable. */
		mount(captionList) {
			const { root, bar } = this;
			if (captionList) {
				if (bar.nextElementSibling !== captionList) {
					captionList.before(bar);
				}
			} else if (bar.parentElement !== root) {
				root.append(bar);
			}
			captionList?.setAttribute("aria-live", "polite");
			this.range.max = this.total;
			root.tabIndex = 0;
			root.setAttribute("role", "group");
			root.setAttribute(
				"aria-label",
				root.getAttribute("aria-label") ?? "Step-through; use the arrow keys",
			);
			root.dataset.live = "";
		}

		/** Re-reads the content and re-applies the step: `wanted`, else the current one (or the new last step if it was on the last). */
		refresh(wanted) {
			const wasLast = this.step === this.total;
			const opening = this.step === 0;
			const captionList = this.readContent();
			this.wired = this.total >= 2;
			this.bar.hidden = !this.wired;
			if (!this.wired) {
				// Too short to step through: no controls, and without data-live everything shows (the no-JS picture).
				this.stop();
				delete this.root.dataset.live;
				this.step = this.total = 0; // so growing again reopens on the last step
				this.announced = "";
				return;
			}
			this.mount(captionList);
			// Opening (the first read, or growing back from too few steps) shows data-start, else the last step (the complete picture);
			// later reads keep the place, and a stepper on its last step stays on it.
			const stay = wasLast ? this.total : this.step;
			this.show(wanted ?? (opening ? Number(this.root.dataset.start) || this.total : stay));
		}
	}

	for (const root of document.querySelectorAll("[data-stepper]")) {
		const stepper = new Stepper(root);
		steppers.set(root, (step) => stepper.refresh(step));
		stepper.refresh();
	}

	window.Steps = {
		refresh(el, step) {
			const refresh = steppers.get(el);
			if (!refresh) {
				throw new Error("Steps.refresh needs an element with data-stepper");
			}
			refresh(step);
		},
	};
})();
