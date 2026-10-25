/* keep: what the reader entered in the page's controls, kept across reloads. pack includes it on a page with a control that has an id.
   Every text, textarea, radio, checkbox, select, range and number control that the reader moved off its default (what the markup
   says: value, checked, selected) is saved in localStorage under the page's own address and restored after the page's load
   handlers have run. Restored controls get input and change events, so the page's own listeners redraw charts and outputs; a
   control changed by script without events is saved at the next click or when the page is left. Controls the page renders later
   (views, panels) are picked up as they appear and get their saved value then; one the page replaces (also in answer to a restored
   value) keeps its answer. Controls are matched by id (else radio form, group and value, else position), so give inputs ids; a
   saved value is dropped when the control's own label or type differs from when it was saved (a regenerated page).
   Put data-keep="off" on a control or its container to leave it out. Without usable storage the page works as before. Open
   <details> are not kept. With reply (kit reply) the reader's notes are kept too, and its Clear button puts every control back to its
   default, again with events. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the IIFE only scopes the kit file's names away from the page; the code in it is split into small functions
(() => {
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
	/** Called when something changed outside reply.js's own calls; alone, keep.js saves then. */
	let onChange: () => void = () => void update();
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
	}
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

	/** Everything to keep: the answered controls by key over the entries still waiting for theirs, and the notes. */
	function snapshot() {
		const controls = { ...pending };
		for (const u of units().filter(answered)) {
			controls[u.key] = { value: readControl(u.el), sig: u.sig };
		}
		return { controls, notes: notes.list() };
	}

	const empty = (state: { controls: object; notes: unknown[] }) =>
		!state.notes.length && !Object.keys(state.controls).length;

	function persist(state: { controls: object; notes: unknown[] }) {
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
		taken.clear();
		onChange();
	}

	/**
	 * Brings the saved copy in line with the page and says whether anything is kept: answers, answers waiting for a control that
	 * is not shown yet, or notes. Before the restore only the notes are known, and nothing is written.
	 */
	function update() {
		if (!ready) {
			return notes.list().length > 0;
		}
		if (!applying) {
			adopt();
		}
		const state = snapshot();
		persist(state);
		return !empty(state);
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
		touch: (el) => touched.add(el),
		touched: (el) => touched.has(el),
		attach(owner) {
			owner.notes.restore(notes.list());
			({ notes, onChange } = owner);
			onChange();
		},
	};
})();
