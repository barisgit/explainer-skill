/* reply keep: what the reader entered, kept across reloads. The persistence half of kit:reply.js, not referenced from pages: pack joins
   it in front of reply.js, which calls it once and gets back { update, clear, touch, touched }:
     selector        CSS selector of the controls that can be kept
     clean, ownText  text helpers of reply.js (whitespace-normalised text; a label's text without its controls)
     notes           { list(): the notes worth keeping, restore(saved): takes back what was saved }
     onChange        called when something changed outside reply.js's own calls: a page script moved a control, the DOM changed,
                     the page is being left, the restore finished
     update()        after any change: adopts new controls, saves, returns whether anything is kept
     clear()         every control back to its default, saved state dropped (notes are reply.js's to empty)
     touch(el), touched(el)   the reader acted on a control, even if the value equals the default
   Owns the saved copy completely: defaults and signatures of controls, entries waiting for controls not yet shown, restoring through
   the page's own rebuilds, localStorage, and watching the DOM. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the function only scopes the part's names away from the page; the code in it is split into small functions
window.ReplyKeep = ({ selector, clean, ownText, notes, onChange }) => {
	/** What a control is, by its own label and kind alone (never its group's): a saved value is put only into a control with the same one. */
	const signature = (c) =>
		clean(
			`${c.type}|${
				c.getAttribute("aria-label") ||
				(c.labels?.[0] && ownText(c.labels[0])) ||
				c.closest(".field")?.firstElementChild?.textContent ||
				c.name ||
				c.placeholder ||
				""
			}`,
		);

	// Chrome gives every file:// page one origin, so the page's own address is what tells their saved state apart.
	const storeKey = `explainer:${location.href.split(/[?#]/)[0]}`;
	/** The controls the reader has touched, which a value equal to the default cannot show. */
	let touched = new WeakSet();
	/** What the markup declares for each key, recorded when a control with that key is first seen: { initial, sig }. A control the page rebuilds the same way, with its current value in the markup, is still compared with the authored one. */
	const defaults = new Map();
	/** Saved entries { value, sig } by key that no control has taken for good yet. */
	let pending = {};
	/** Who last took each pending entry: { el, tries }. An entry is settled once its control is still in the page at the next look. */
	const taken = new Map();
	const MAX_TRIES = 3;
	/** True while values are being written and announced; page listeners that rebuild controls run then, so nothing is settled yet. */
	let applying = false;
	/** False until the saved state is restored, so the page at script time cannot overwrite it. */
	let ready = false;

	const groupOf = (c) => `${[...document.forms].indexOf(c.form)}:${c.name}`;
	/** A control's identity across loads: its id, else (radio) form, group and value, else its type and position among the kept controls. */
	function unitKey(c, index) {
		if (c.id) {
			return `#${c.id}`;
		}
		return c.type === "radio" && c.name ? `radio:${groupOf(c)}=${c.value}` : `${c.type}@${index}`;
	}

	/** The value `c` has before the reader or a script touches it: that of a copy parsed from its markup. */
	function initialValue(c) {
		const box = document.createElement("div");
		box.innerHTML = c.outerHTML;
		return readControl(box.firstElementChild);
	}

	function readControl(c) {
		if (c.type === "radio" || c.type === "checkbox") {
			return c.checked;
		}
		return c.multiple ? [...c.selectedOptions].map((o) => o.value) : c.value;
	}

	function writeControl(c, value) {
		if (c.type === "radio" || c.type === "checkbox") {
			c.checked = value;
		} else if (c.multiple) {
			for (const o of c.options) {
				o.selected = value.includes(o.value);
			}
		} else {
			c.value = value;
		}
	}

	/** Storage can hold anything: a stored value is used only when it has the shape `readControl` gives. */
	const kind = (value) => Object.prototype.toString.call(value);
	const fits = (unit, value) => kind(value) === kind(unit.initial);
	const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

	/**
	 * The kept controls in the page now: { el, key, initial, sig }. A key keeps its recorded default only while the control
	 * under it is the same kind of control (same signature); a different one under a reused id starts from its own markup.
	 */
	function units() {
		const controls = [...document.querySelectorAll(selector)].filter(
			(c) => !c.closest(".reply-ui, [data-keep=off]"),
		);
		return controls.map((el, i) => {
			const key = unitKey(el, i);
			const sig = signature(el);
			if (defaults.get(key)?.sig !== sig) {
				defaults.set(key, { initial: initialValue(el), sig });
			}
			return { el, key, ...defaults.get(key) };
		});
	}

	const moved = (u) => !same(readControl(u.el), u.initial);
	/** Answered: moved off the default, or chosen by the reader even where that equals it. */
	const answered = (u) => moved(u) || touched.has(u.el);

	/** Page listeners hear a restored or cleared control the way they hear the reader: input, then change. */
	function announce(c) {
		for (const type of ["input", "change"]) {
			c.dispatchEvent(new Event(type, { bubbles: true }));
		}
	}

	/** True when some radio of `c`'s group is checked; an unnamed radio is its own group. */
	const groupChosen = (c) =>
		Boolean(c.name) &&
		[...document.getElementsByName(c.name)].some(
			(r) => r.type === "radio" && r.form === c.form && r.checked,
		);

	/** The controls to announce after `writes`: each written control except unchecked radios, plus one radio for a group left with no choice. */
	function speakers(writes) {
		const spoken = new Map();
		for (const { el } of writes) {
			if (el.type !== "radio" || el.checked) {
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
	function apply(writes) {
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
		const writes = [];
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

	const empty = (state) => !state.notes.length && !Object.keys(state.controls).length;

	function persist(state) {
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
	const later = () => setTimeout(onChange);
	for (const type of ["input", "change", "click"]) {
		document.addEventListener(type, later);
	}
	addEventListener("pagehide", onChange);
	// Controls the page renders, replaces or removes after load: only changes to the controls themselves matter, not to this UI.
	const isControl = (n) => n.nodeType === 1 && (n.matches(selector) || n.querySelector(selector));
	new MutationObserver((records) => {
		if (
			records.some(
				(m) =>
					!m.target.closest?.(".reply-ui") && [...m.addedNodes, ...m.removedNodes].some(isControl),
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

	return { update, clear, touch: (el) => touched.add(el), touched: (el) => touched.has(el) };
};
