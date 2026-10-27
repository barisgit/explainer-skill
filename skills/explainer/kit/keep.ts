/* keep: what the reader entered in the page's controls, kept across reloads. pack includes it on a page with a control that has an id.
   Every text, textarea, radio, checkbox, select, range and number control that the reader moved off its default (what the markup
   says: value, checked, selected) is saved in localStorage under the page's own address and restored after the page's load
   handlers have run. Restored controls get input and change events, so the page's own listeners redraw charts and outputs; a
   control changed by script without events is saved at the next click or when the page is left. Controls the page renders later
   (views, panels) are picked up as they appear and get their saved value then; one the page replaces (also in answer to a restored
   value) keeps its answer. Controls are matched by id (else radio form, group and value, else position), so give inputs ids; a
   saved value is dropped when the control's own label or type differs from when it was saved (a regenerated page).
   Put data-keep="off" on a control or its container to leave it out. Without usable storage the page works as before. Open
   <details> are not kept. Once anything is saved, a Clear answers button at the end of the page puts every control back to its
   default, again with events, and drops the saved copy. It asks first: one click turns it red ("Clear everything?"), a second
   within 4 s clears; Escape, leaving the button or the wait cancels. With reply (kit reply) the reader's notes are kept too, and
   the same button sits in the reply bar instead, where a self-check's answer (a kit Question's choice, or its written answer
   beside a model one) alone does not bring it.
   Labels: clearAnswers "Clear answers", clearAnswersPrompt "Press again to clear all answers." (announced), and for both
   buttons clearConfirm "Clear everything?" and clearCancelled "Clear cancelled." (announced). */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the IIFE only scopes the kit file's names away from the page; the code in it is split into small functions
(() => {
	/** The English texts, by kitLabels key. */
	const LABELS = {
		clearAnswers: "Clear answers",
		clearAnswersPrompt: "Press again to clear all answers.",
		clearConfirm: "Clear everything?",
		clearCancelled: "Clear cancelled.",
	};
	/** The page's text for `key`, else the English one. Read at each use, so kitLabels may be set after this script. */
	const kitText = (key: keyof typeof LABELS) => window.kitLabels?.[key] || LABELS[key];
	const selector =
		"input:not([type=button], [type=submit], [type=reset], [type=hidden], [type=file], [type=password], [type=image]), select, textarea";
	const clean = (s: string) => s.replace(/\s+/g, " ").trim();
	/** A label's text without the controls and outputs inside it. */
	const ownText = (label: HTMLLabelElement) => {
		const copy = document.createElement("div");
		copy.innerHTML = label.innerHTML;
		for (const n of copy.querySelectorAll("input, select, textarea, output")) {
			n.remove();
		}
		return clean(copy.textContent ?? "");
	};
	/** The notes saved with the answers. Until reply.js takes them over, they are kept as they were stored, so saving answers never drops them. */
	let storedNotes: unknown = [];
	let notes: KeepNotes = {
		list: () => (Array.isArray(storedNotes) ? storedNotes : []),
		restore: (saved) => {
			storedNotes = saved;
		},
	};
	/** Called when something changed outside reply.js's own calls; alone, keep.js saves then and shows its own Clear. */
	let onChange: () => void = () => updateAlone();
	/** What a control is, by its own label and kind alone (never its group's): a saved value is put only into a control with the same one. */
	type Control = ReplyControl;
	/** What a control holds: checked, selected values (multiple select), or its text. */
	type Value = boolean | string | string[];
	/** A kept control: its identity across loads, its markup default and its signature. */
	interface Unit {
		el: Control;
		key: string;
		initial: Value;
		sig: string;
	}
	interface Write {
		el: Control;
		value: Value;
	}
	/** A saved entry no control has taken yet. */
	interface Saved {
		value: unknown;
		sig: string;
		/** A self-check's answer: kept, but not an answer for the reply, so it alone shows no Clear button. Saved, since the control may not be shown yet. */
		check?: true;
	}
	/** Where a kit Question that is a self-check keeps its options or its text box. */
	const SELF_CHECK = "fieldset.self-check";
	const isRadio = (c: Control): c is HTMLInputElement => c.type === "radio";
	const isToggle = (c: Control): c is HTMLInputElement => isRadio(c) || c.type === "checkbox";
	const isMultiSelect = (c: Control): c is HTMLSelectElement =>
		c instanceof HTMLSelectElement && c.multiple;

	const signature = (c: Control) =>
		clean(
			`${c.type}|${
				c.getAttribute("aria-label") ||
				(c.labels?.[0] && ownText(c.labels[0])) ||
				c.closest(".field")?.firstElementChild?.textContent ||
				c.name ||
				("placeholder" in c && c.placeholder) ||
				""
			}`,
		);

	// Chrome gives every file:// page one origin, so the page's own address is what tells their saved state apart.
	const storeKey = `explainer:${location.href.split(/[?#]/)[0]}`;
	/** The controls the reader has touched, which a value equal to the default cannot show. */
	let touched = new WeakSet<Control>();
	/** What the markup declares for each key, recorded when a control with that key is first seen: { initial, sig }. A control the page rebuilds the same way, with its current value in the markup, is still compared with the authored one. */
	const defaults = new Map<string, { initial: Value; sig: string }>();
	/** Saved entries { value, sig } by key that no control has taken for good yet. */
	let pending: Record<string, Saved> = {};
	/** Who last took each pending entry: { el, tries }. An entry is settled once its control is still in the page at the next look. */
	const taken = new Map<string, { el: Control; tries: number }>();
	const MAX_TRIES = 3;
	/** True while values are being written and announced; page listeners that rebuild controls run then, so nothing is settled yet. */
	let applying = false;
	/** False until the saved state is restored, so the page at script time cannot overwrite it. */
	let ready = false;

	const groupOf = (c: Control) => `${c.form ? [...document.forms].indexOf(c.form) : -1}:${c.name}`;
	/** A control's identity across loads: its id, else (radio) form, group and value, else its type and position among the kept controls. */
	function unitKey(c: Control, index: number) {
		if (c.id) {
			return `#${c.id}`;
		}
		return c.type === "radio" && c.name ? `radio:${groupOf(c)}=${c.value}` : `${c.type}@${index}`;
	}

	/** The value `c` has before the reader or a script touches it: that of a copy parsed from its markup. */
	function initialValue(c: Control) {
		const box = document.createElement("div");
		box.innerHTML = c.outerHTML;
		return readControl(box.querySelector<Control>(selector) ?? c);
	}

	function readControl(c: Control): Value {
		if (isToggle(c)) {
			return c.checked;
		}
		return isMultiSelect(c) ? [...c.selectedOptions].map((o) => o.value) : c.value;
	}

	function writeControl(c: Control, value: Value) {
		if (isToggle(c)) {
			c.checked = value === true;
		} else if (isMultiSelect(c) && Array.isArray(value)) {
			for (const o of c.options) {
				o.selected = value.includes(o.value);
			}
		} else {
			c.value = String(value);
		}
	}

	/** Storage can hold anything: a stored value is used only when it has the shape `readControl` gives. */
	const kind = (value: unknown) => Object.prototype.toString.call(value);
	const fits = (unit: Unit, value: unknown): value is Value => kind(value) === kind(unit.initial);
	const same = (a: Value, b: Value) => JSON.stringify(a) === JSON.stringify(b);

	/**
	 * The kept controls in the page now: { el, key, initial, sig }. A key keeps its recorded default only while the control
	 * under it is the same kind of control (same signature); a different one under a reused id starts from its own markup.
	 */
	function units(): Unit[] {
		const controls = [...document.querySelectorAll<Control>(selector)].filter(
			(c) => !c.closest(".reply-ui, [data-keep=off]"),
		);
		return controls.map((el, i) => {
			const key = unitKey(el, i);
			const sig = signature(el);
			let entry = defaults.get(key);
			if (entry?.sig !== sig) {
				entry = { initial: initialValue(el), sig };
				defaults.set(key, entry);
			}
			return { el, key, ...entry };
		});
	}

	const moved = (u: Unit) => !same(readControl(u.el), u.initial);
	/** Answered: moved off the default, or chosen by the reader even where that equals it. */
	const answered = (u: Unit) => moved(u) || touched.has(u.el);

	/** Page listeners hear a restored or cleared control the way they hear the reader: input, then change. */
	function announce(c: Control) {
		for (const type of ["input", "change"]) {
			c.dispatchEvent(new Event(type, { bubbles: true }));
		}
	}

	/** True when some radio of `c`'s group is checked; an unnamed radio is its own group. */
	const groupChosen = (c: Control) =>
		Boolean(c.name) &&
		[...document.getElementsByName(c.name)].some(
			(r) => r instanceof HTMLInputElement && r.type === "radio" && r.form === c.form && r.checked,
		);

	/** The controls to announce after `writes`: each written control except unchecked radios, plus one radio for a group left with no choice. */
	function speakers(writes: Write[]) {
		const spoken = new Map<string | Control, Control>();
		for (const { el } of writes) {
			if (!isRadio(el) || el.checked) {
				spoken.set(el, el);
			} else if (!groupChosen(el)) {
				spoken.set(el.name ? groupOf(el) : el, el);
			}
		}
		return [...spoken.values()];
	}

	/**
	 * Sets `writes` ({ el, value }) and tells the page. Every value is written before any event, so no listener sees a radio group half
	 * switched. Written controls count as the reader's.
	 */
	function apply(writes: Write[]) {
		applying = true;
		try {
			for (const { el, value } of writes) {
				writeControl(el, value);
				touched.add(el);
			}
			for (const el of speakers(writes)) {
				announce(el);
			}
		} finally {
			applying = false;
		}
	}

	/** Entries whose control survived the page's reaction to the restore are done. */
	function settle() {
		for (const [key, { el }] of taken) {
			if (el.isConnected) {
				taken.delete(key);
				delete pending[key];
			}
		}
	}

	/**
	 * Gives controls the saved value waiting for their key: one that appeared, or one that replaced the control that took it (a page
	 * that rebuilds a field when another is restored). An entry is dropped when the control is not the one it was saved from.
	 */
	function adopt() {
		settle();
		const writes: Write[] = [];
		for (const u of units()) {
			const entry = pending[u.key];
			if (!entry) {
				continue;
			}
			const tries = taken.get(u.key)?.tries ?? 0;
			if (tries && moved(u)) {
				taken.set(u.key, { el: u.el, tries }); // the page filled the replacement itself
			} else if (entry.sig === u.sig && fits(u, entry.value) && tries < MAX_TRIES) {
				writes.push({ el: u.el, value: entry.value });
				taken.set(u.key, { el: u.el, tries: tries + 1 });
			} else {
				delete pending[u.key];
				taken.delete(u.key);
			}
		}
		apply(writes);
	}

	/** What the last snapshot kept of controls with an id, for when one leaves the page. */
	let keptById: Record<string, Saved> = {};

	/**
	 * Everything to keep: the answered controls by key over the entries still waiting for theirs, and the notes. A control with an
	 * id that has left the page (a filled view showing another record) waits again for its return, as a saved entry does.
	 */
	function snapshot() {
		const present = units();
		const here = new Set(present.map((u) => u.key));
		for (const [key, entry] of Object.entries(keptById)) {
			if (!(here.has(key) || key in pending)) {
				pending[key] = entry;
			}
		}
		const controls = { ...pending };
		for (const u of present.filter(answered)) {
			const check = u.el.closest(SELF_CHECK) ? { check: true as const } : {};
			controls[u.key] = { value: readControl(u.el), sig: u.sig, ...check };
		}
		keptById = Object.fromEntries(Object.entries(controls).filter(([key]) => key.startsWith("#")));
		return { controls, notes: notes.list() };
	}

	/** What keep saves: the kept controls by key, and the notes. */
	interface State {
		controls: Record<string, Saved>;
		notes: unknown[];
	}

	const empty = (state: State) => !state.notes.length && !Object.keys(state.controls).length;

	function persist(state: State) {
		try {
			if (empty(state)) {
				localStorage.removeItem(storeKey);
			} else {
				localStorage.setItem(storeKey, JSON.stringify(state));
			}
		} catch {
			// Storage blocked or full (localStorage may throw even on access): the page goes on from memory, and the Clear button still resets it.
		}
	}

	function stored() {
		try {
			return JSON.parse(localStorage.getItem(storeKey) ?? "{}") ?? {};
		} catch {
			return {};
		}
	}

	function restore() {
		const state = stored();
		const saved = state.controls;
		pending = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
		notes.restore(state.notes);
		ready = true;
		onChange();
	}

	/** Puts every control back to its default (the page hears it), forgets what was touched and everything saved. */
	function clear() {
		apply(
			units()
				.filter(moved)
				.map((u) => ({ el: u.el, value: u.initial })),
		);
		touched = new WeakSet();
		pending = {};
		keptById = {};
		taken.clear();
		onChange();
	}

	/** Brings the saved copy in line with the page and returns what it saved; before the restore nothing is known or written. */
	function save(): State | undefined {
		if (!ready) {
			return undefined;
		}
		if (!applying) {
			adopt();
		}
		const state = snapshot();
		persist(state);
		return state;
	}

	/**
	 * Saves and says whether anything for the reply is kept: answers, answers waiting for a control that is not shown yet, or
	 * notes. A self-check's answer is saved but does not count. Before the restore only the notes are known.
	 */
	function update() {
		const state = save();
		if (!state) {
			return notes.list().length > 0;
		}
		return (
			state.notes.length > 0 || Object.values(state.controls).some((entry) => entry.check !== true)
		);
	}

	/** How long an armed Clear waits for its second press. */
	const CONFIRM_MS = 4000;

	/**
	 * A Clear button that asks first, since clearing cannot be undone: one press arms it (red, clearConfirm, `texts.prompt`
	 * announced), a second within CONFIRM_MS disarms it and calls `onClear`; Escape, leaving the button or the wait cancels.
	 */
	function clearButton(texts: KeepClearTexts, onClear: () => void): KeepClearButton {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "btn";
		// A live region announces the state change: screen readers do not reliably re-read a focused button whose text changed.
		const status = document.createElement("span");
		status.setAttribute("role", "status");
		status.className = "reply-invisible";
		let timer = 0;
		const armed = () => button.classList.contains("is-armed");

		function arm() {
			// The button never narrows under the pointer: a shorter confirm keeps the idle width, a longer one widens it on one line.
			button.style.minInlineSize = `${button.getBoundingClientRect().width}px`;
			button.classList.add("is-armed");
			button.textContent = kitText("clearConfirm");
			status.textContent = texts.prompt();
			timer = window.setTimeout(() => disarm(kitText("clearCancelled")), CONFIRM_MS);
		}

		/** Back to the idle label; `message` is announced for a cancel the reader did not make by moving on. */
		function disarm(message = "") {
			clearTimeout(timer);
			button.classList.remove("is-armed");
			button.style.minInlineSize = "";
			button.textContent = texts.label();
			status.textContent = message;
		}

		button.addEventListener("click", () => {
			if (!armed()) {
				arm();
				return;
			}
			disarm();
			onClear();
		});
		button.addEventListener("blur", () => disarm());
		document.addEventListener("keydown", (e) => {
			if (e.key === "Escape" && armed()) {
				disarm(kitText("clearCancelled"));
			}
		});
		return {
			button,
			status,
			show(visible) {
				button.hidden = !visible;
				if (!visible) {
					disarm();
				} else if (!armed()) {
					button.textContent = texts.label();
				}
			},
		};
	}

	/** keep.js's own Clear on a page without reply.js, made the first time something is saved. */
	let own: KeepClearButton | undefined;

	/**
	 * keep.js's own Clear, at the end of the page's main column: below everything it clears, so showing it moves nothing the reader
	 * is looking at. Notes saved by an earlier version of the page that had reply.js go too.
	 */
	function ownClear(): KeepClearButton {
		const texts = {
			label: () => kitText("clearAnswers"),
			prompt: () => kitText("clearAnswersPrompt"),
		};
		const made = clearButton(texts, () => {
			notes.restore([]);
			clear();
		});
		const box = document.createElement("div");
		box.className = "keep-clear";
		box.append(made.status, made.button);
		(document.querySelector("main") ?? document.body).append(box);
		return {
			...made,
			show(visible) {
				box.hidden = !visible;
				made.show(visible);
			},
		};
	}

	/** Alone: saves, and offers Clear while anything is saved, a self-check's answer included, since nothing else clears it. */
	function updateAlone() {
		const state = save();
		if (!state || (empty(state) && !own)) {
			return;
		}
		own ??= ownClear();
		own.show(!empty(state));
	}

	// Saving waits a tick so a click handler that sets a control by script is done first; leaving the page saves what is left.
	const later = () => setTimeout(() => onChange());
	for (const type of ["input", "change", "click"]) {
		document.addEventListener(type, later);
	}
	addEventListener("pagehide", () => onChange());
	// Controls the page renders, replaces or removes after load: only changes to the controls themselves matter, not to this UI.
	const isControl = (n: Node) =>
		n instanceof Element && (n.matches(selector) || n.querySelector(selector));
	new MutationObserver((records) => {
		if (
			records.some(
				(m) =>
					!(m.target instanceof Element && m.target.closest(".reply-ui")) &&
					[...m.addedNodes, ...m.removedNodes].some(isControl),
			)
		) {
			later();
		}
	}).observe(document.body, { childList: true, subtree: true });

	// After the page's own load handlers have run (they attach listeners and set initial values), so restored values reach them and survive them.
	if (document.readyState === "complete") {
		setTimeout(restore);
	} else {
		addEventListener("load", () => setTimeout(restore), { once: true });
	}

	window.Keep = {
		selector,
		ownText,
		update,
		clear,
		clearButton,
		touch: (el) => touched.add(el),
		touched: (el) => touched.has(el),
		attach(owner) {
			owner.notes.restore(notes.list());
			({ notes, onChange } = owner);
			onChange();
		},
	};
})();
