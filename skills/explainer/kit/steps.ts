/* steps: stepper from attributes: data-stepper on a container, data-step="2 4" on parts (HTML or hand-built SVG), <ol data-captions>; adds Back/Play/Next, scrubber, arrow keys. Needs kit:theme.css.
   <figure class="fig" data-stepper>             any element; the controls are added before the captions (else at its end)
     <g data-step="2">  <p data-step="0 3">      a part appears at the first listed step and is lit (is-now) on every listed one;
                                                 0 = visible from the start, lit later; a part without data-step never changes
     <ol data-captions><li>Step 1 text</li><li>Step 2 text</li></ol>   one li per step; the current one shows
   </figure>
   Steps count from 1; the number of steps is the number of captions, else the highest step used. The stepper opens on the last
   step (the complete picture, same as print and without JS); data-start="1" on the stepper opens it on step 1 instead (any
   number works; study pages start at the beginning). Play restarts from step 1 and never starts by itself.
   A Mermaid diagram does not step (pack refuses data-steps on one): show it whole and link its parts to the text with data-ref (kit mermaid).
   Labels: the texts the stepper adds are English. A page in another language sets them, with those of the other kit scripts, in one
   object before the kit scripts: <script>var kitLabels = { back: "Nazaj", play: "Predvajaj", ... }</script> in <head>. Keys here:
   back "Back", play "Play", pause "Pause", next "Next", stepControls "Step controls" (the controls' accessible name), step "Step"
   (the scrubber's), stepper "Step-through; use the arrow keys" (the stepper's, unless it has an aria-label). A key left out stays English.
   Controls: <button data-go="-1"> is Back and <button data-go="1"> is Next (check --do click:'[data-go="1"]' steps forward), <button data-play>
   is Play, then the scrubber. Focus the stepper (Tab or click inside) and use Left/Right/Home/End.
   Listen for steps: el.addEventListener("stepchange", (e) => e.detail.step). A stepper with no data-step parts must redraw on it;
   check warns about one whose steps change only the captions.
   Changing the content: a page may swap scenarios by replacing the captions (ol.innerHTML = ...) or the parts. Replacing
   the children of the [data-captions] list is picked up by itself; after any other replacement call Steps.refresh(el, step?). It re-reads
   captions and parts, so the step count follows the new content; each stepper counts for itself, so steppers on one page may
   have different lengths. Position: it stays on the current step (clamped to the new count), or on the new last step if it was on the last;
   Steps.refresh(el, 1) restarts. A stepper left with fewer than 2 steps hides its controls and shows everything; they return when it grows.
   stepchange fires when the step or the count changes, never for a refresh that changes neither: the page redraws its own state after
   replacing content, whether or not the event fires. The opening step is announced once the page has loaded (after its scripts and
   DOMContentLoaded handlers), so a listener added while loading hears it, also with data-start; one added after load misses it.
   Under reduced motion there are no transitions; Play still advances because the reader asked for it. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the IIFE only scopes the kit file's names away from the page; the code in it is split into small functions
(() => {
	const PLAY_MS = 3000;
	const steppers = new WeakMap<Element, (step?: number) => void>();
	// Until the page's own scripts have run, steppers show their state but announce nothing: a listener the page adds later must hear the opening step.
	let loaded = false;

	/** The English texts; the page's kitLabels replace any of them. */
	const LABELS = {
		back: "Back",
		play: "Play",
		pause: "Pause",
		next: "Next",
		stepControls: "Step controls",
		step: "Step",
		stepper: "Step-through; use the arrow keys",
	};
	const TEXT: typeof LABELS = { ...LABELS, ...window.kitLabels };

	/** An element the stepper's own markup is known to contain. */
	function need<T extends Element>(root: ParentNode, selector: string): T {
		const el = root.querySelector<T>(selector);
		if (!el) {
			throw new Error(`kit:steps.js: no ${selector}`);
		}
		return el;
	}

	// Texts are set as text afterwards: a page's label is never parsed as markup.
	const button = (attrs: string, primary = false) =>
		`<button type="button" class="btn${primary ? " primary" : ""}" ${attrs}></button>`;

	/** One stepper: its controls, the current step and the content it steps through. */
	class Stepper {
		parts: { el: Part; steps: number[] }[] = [];
		captions: Element[] = [];
		total = 0;
		step = 0;
		timer: number | undefined;
		announced = "";
		wired = false;
		readonly root: HTMLElement;
		readonly bar = document.createElement("div");
		readonly back: HTMLButtonElement;
		readonly play: HTMLButtonElement;
		readonly next: HTMLButtonElement;
		readonly range: HTMLInputElement;
		readonly readout: HTMLOutputElement;
		readonly watcher: MutationObserver;

		constructor(root: HTMLElement) {
			this.root = root;
			if (root.dataset.labels !== undefined) {
				// v0.7.0 read per-stepper labels; a page written for it would otherwise turn English without a word.
				console.warn(
					"kit:steps.js: data-labels is no longer read; set the texts in kitLabels (kit steps.js)",
				);
			}
			this.bar.className = "player";
			this.bar.setAttribute("role", "group");
			this.bar.setAttribute("aria-label", TEXT.stepControls);
			this.bar.innerHTML = `${button('data-go="-1"')}${button("data-play", true)}${button('data-go="1"')}<input type="range" min="1" data-keep="off"><output></output>`;
			this.back = need(this.bar, "[data-go='-1']");
			this.play = need(this.bar, "[data-play]");
			this.next = need(this.bar, "[data-go='1']");
			this.back.textContent = TEXT.back;
			this.play.textContent = TEXT.play;
			this.next.textContent = TEXT.next;
			this.range = need(this.bar, "input");
			this.range.setAttribute("aria-label", TEXT.step);
			this.readout = need(this.bar, "output");
			this.bindControls();
			this.bindKeys();
			// Replacing the captions' children re-reads without the page's help. Re-pointed at every refresh, since the list itself may be new.
			this.watcher = new MutationObserver(() => this.refresh());
		}

		show(target: number) {
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
			this.range.value = String(this.step);
			this.readout.textContent = `${this.step} / ${this.total}`;
			if (loaded) {
				this.announce();
			}
		}

		/** Fires stepchange when the step or the count differs from the last announcement. */
		announce() {
			const state = `${this.step}/${this.total}`;
			if (this.step && this.announced !== state) {
				this.announced = state;
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
			this.timer = undefined;
			this.play.textContent = TEXT.play;
		}

		bindControls() {
			this.bar.addEventListener("click", (e) => {
				const go = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-go]") : null;
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
				this.play.textContent = TEXT.pause;
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
					(e.target instanceof Element && e.target.matches("input, textarea, select")) ||
					e.altKey ||
					e.ctrlKey ||
					e.metaKey
				) {
					return;
				}
				const { step, total } = this;
				const keys: Record<string, number> = {
					ArrowLeft: step - 1,
					ArrowRight: step + 1,
					Home: 1,
					End: total,
				};
				const target = keys[e.key];
				if (target === undefined) {
					return;
				}
				e.preventDefault();
				this.stop();
				this.show(target);
			});
		}

		/** Re-reads captions and parts; returns the captions list element, if any. */
		readContent() {
			this.parts = [...this.root.querySelectorAll<Part>("[data-step]")].map((el) => ({
				el,
				steps: (el.dataset.step ?? "").trim().split(/\s+/).map(Number),
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
		mount(captionList: Element | null) {
			const { root, bar } = this;
			if (captionList) {
				if (bar.nextElementSibling !== captionList) {
					captionList.before(bar);
				}
			} else if (bar.parentElement !== root) {
				root.append(bar);
			}
			captionList?.setAttribute("aria-live", "polite");
			this.range.max = String(this.total);
			root.tabIndex = 0;
			root.setAttribute("role", "group");
			root.setAttribute("aria-label", root.getAttribute("aria-label") ?? TEXT.stepper);
			root.dataset.live = "";
		}

		/** Re-reads the content and re-applies the step: `wanted`, else the current one (or the new last step if it was on the last). */
		refresh(wanted?: number) {
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

	const all = [...document.querySelectorAll<HTMLElement>("[data-stepper]")].map((root) => {
		const stepper = new Stepper(root);
		steppers.set(root, (step) => stepper.refresh(step));
		stepper.refresh();
		return stepper;
	});

	/** The first announcement waits for DOMContentLoaded handlers too (the timeout runs after them), so any listener added during load hears it. */
	function announceOpening() {
		setTimeout(() => {
			loaded = true;
			for (const stepper of all) {
				stepper.announce();
			}
		});
	}
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", announceOpening, { once: true });
	} else {
		announceOpening();
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
