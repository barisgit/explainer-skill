/* reply marks: local anchors, the highlight on what a note is about, and its accessible margin button. The reader's selection and
   the page's DOM stay untouched (a noted part takes the class is-noted). A press on the button or on the highlight opens the note
   through `open`; the note open in reply.js's popover, a new one included, is lit more strongly than the others. `painted` runs
   after each drawing (a scroll, a fold, a changed page), so the popover can follow what it is about. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the function only scopes this kit script's names; its work is split into small functions
window.ReplyMarks = ({ root, label, open, painted }) => {
	const OMIT = ".reply-ui, .keep-clear, .fold-all, nav.toc, nav.trail";
	const children = (node: Node): Node[] =>
		[...node.childNodes].filter((child) => !(child instanceof Element && child.matches(OMIT)));
	const recordOf = (node: Element) => window.Views?.record(node) ?? null;
	const elementOf = (node: Node) => (node instanceof Element ? node : node.parentElement);

	/** A path through content, excluding kit controls that come and go as notes or views change. */
	function pathTo(node: Node, base: Node): number[] | null {
		const path: number[] = [];
		let at = node;
		while (at !== base) {
			const parent = at.parentNode;
			const index = parent ? children(parent).indexOf(at) : -1;
			if (!parent || index < 0) {
				return null;
			}
			path.push(index);
			at = parent;
		}
		return path.reverse();
	}

	function atPath(base: Node, path: number[]) {
		let node: Node | undefined = base;
		for (const index of path) {
			node = node && children(node)[index];
		}
		return node;
	}

	function anchor(target: Range | Part): NoteAnchor | undefined {
		const base = target instanceof Range ? elementOf(target.commonAncestorContainer) : target;
		const path = base && pathTo(base, root);
		if (!base || !path) {
			return;
		}
		const record = recordOf(base);
		if (target instanceof Range) {
			return rangeAnchor(target, base, path, record);
		}
		const ref = target.getAttribute("data-ref");
		return ref === null ? undefined : { path, record, ref };
	}

	function rangeAnchor(
		range: Range,
		base: Element,
		path: number[],
		record: string | null,
	): NoteAnchor | undefined {
		const start = pathTo(range.startContainer, base);
		const end = pathTo(range.endContainer, base);
		if (start && end) {
			return {
				path,
				record,
				start: [start, range.startOffset],
				end: [end, range.endOffset],
				text: signature(range),
			};
		}
		return undefined;
	}

	const signature = (range: Range) => range.toString().replace(/\s+/g, " ").trim();
	const index = (n: unknown): n is number =>
		typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
	const isPath = (value: unknown): value is number[] => Array.isArray(value) && value.every(index);
	const isPoint = (value: unknown): value is NotePoint =>
		Array.isArray(value) && value.length === 2 && isPath(value[0]) && index(value[1]);

	/** Keep older notes without guessing a target; current locators are read only after validation. */
	function read(value: unknown): NoteAnchor | undefined {
		if (
			typeof value !== "object" ||
			value === null ||
			!("path" in value && "record" in value) ||
			!isPath(value.path) ||
			!(value.record === null || typeof value.record === "string")
		) {
			return;
		}
		const { path, record } = value;
		if ("ref" in value && typeof value.ref === "string") {
			return { path, record, ref: value.ref };
		}
		if (
			"start" in value &&
			"end" in value &&
			"text" in value &&
			isPoint(value.start) &&
			isPoint(value.end) &&
			typeof value.text === "string"
		) {
			return { path, record, start: value.start, end: value.end, text: value.text };
		}
		return undefined;
	}

	function resolveRange(
		base: Element,
		{ start, end, text }: Extract<NoteAnchor, { text: string }>,
	) {
		const a = atPath(base, start[0]);
		const b = atPath(base, end[0]);
		const length = (node: Node) =>
			node instanceof CharacterData ? node.length : node.childNodes.length;
		if (!a || !b || start[1] > length(a) || end[1] > length(b)) {
			return null;
		}
		const range = document.createRange();
		range.setStart(a, start[1]);
		range.setEnd(b, end[1]);
		return !range.collapsed && signature(range) === text ? range : null;
	}

	const visible = (el: Element) =>
		el.getClientRects().length > 0 && getComputedStyle(el).visibility === "visible";

	/** Mermaid ships two layouts of one diagram. A note on a ref follows its visible copy, not a different figure. */
	function shownPart(el: Element, ref: string) {
		if (visible(el)) {
			return el;
		}
		const drawing = el.closest(".mermaid > svg");
		const copies = drawing?.parentElement?.querySelectorAll(":scope > svg [data-ref]");
		const matches = [...(copies ?? [])].filter(
			(part) => part.getAttribute("data-ref") === ref && visible(part),
		);
		return matches.length === 1 ? matches[0] : null;
	}

	function resolve(note: ReplyNote) {
		const at = note.anchor;
		const base = at && atPath(root, at.path);
		if (!at || !(base instanceof Element) || recordOf(base) !== at.record) {
			return null;
		}
		if ("ref" in at) {
			const el = base.getAttribute("data-ref") === at.ref ? shownPart(base, at.ref) : null;
			// When a noted part folds, its open body is not where the reader marked it.
			return el instanceof HTMLDetailsElement ? (el.querySelector(":scope > summary") ?? el) : el;
		}
		return visible(base) ? resolveRange(base, at) : null;
	}

	const buttons = new Map<ReplyNote, HTMLButtonElement>();
	const highlights = typeof Highlight === "function" ? new Highlight() : null;
	if (highlights) {
		CSS.highlights.set("explainer-notes", highlights);
	}
	let outlined = new Set<Element>();

	function buttonFor(note: ReplyNote) {
		const existing = buttons.get(note);
		if (existing) {
			return existing;
		}
		const button = document.createElement("button");
		button.className = "reply-ui reply-mark";
		button.type = "button";
		button.setAttribute("aria-label", label(note));
		button.setAttribute("aria-haspopup", "dialog");
		button.addEventListener("click", () => open(note, button));
		document.body.append(button);
		buttons.set(note, button);
		return button;
	}

	/** A wide heading box or a full-width figure is not the edge of its visible content. */
	function markEdge(el: Element) {
		const block = el.closest(".mermaid, figure, p, li, h1, h2, h3, h4, h5, h6, pre, table") ?? root;
		const edge = block.getBoundingClientRect().right;
		const svg = el.closest("svg");
		if (svg) {
			return Math.min(edge, svg.getBoundingClientRect().right);
		}
		if (block.matches("h1, h2, h3, h4, h5, h6")) {
			const text = document.createRange();
			text.selectNodeContents(block);
			return text.getBoundingClientRect().right;
		}
		return edge;
	}

	function position(button: HTMLButtonElement, target: Element | Range, below: number) {
		const el = target instanceof Range ? elementOf(target.commonAncestorContainer) : target;
		const line = [...target.getClientRects()].find((rect) => rect.width > 0 && rect.height > 0);
		if (!el || !line) {
			button.hidden = true;
			return below;
		}
		const right = Math.max(markEdge(el), line.right);
		const gutter = Math.min(document.documentElement.clientWidth - 24, right);
		const top = Math.max(below, line.top + scrollY + (line.height - 24) / 2);
		// Only the gutter is clickable. On narrow screens the visual dot fits even when the 24 px box does not.
		button.style.clipPath = `inset(0 0 0 ${Math.min(12, Math.max(0, right - gutter))}px)`;
		button.style.left = `${gutter + scrollX}px`;
		button.style.top = `${top}px`;
		button.hidden = false;
		return top + 24;
	}

	let notes: ReplyNote[] = [];
	/** The note the popover is on, lit as the current one; a new note (`draft`) has no button yet, and `live` is its target. */
	let active: { note: ReplyNote; live?: Range | Element | undefined; draft: boolean } | null = null;
	const current = typeof Highlight === "function" ? new Highlight() : null;
	const hover = typeof Highlight === "function" ? new Highlight() : null;
	if (current && hover) {
		hover.priority = 1;
		current.priority = 2;
		CSS.highlights.set("explainer-note-hover", hover);
		CSS.highlights.set("explainer-note-current", current);
	}
	/** Each shown note with what it marks now, in reading order: what clicks and hovers are tested against. */
	let placed: { note: ReplyNote; target: Element | Range }[] = [];
	let hovered: ReplyNote | null = null;

	const shown = () => (active && !notes.includes(active.note) ? [...notes, active.note] : notes);
	// A new note has no anchor to resolve until it is saved; a saved one whose anchor no longer resolves has no target.
	const targetOf = (note: ReplyNote) =>
		resolve(note) ?? (active?.note === note && active.draft ? (active.live ?? null) : null);

	/** Highlights a range or outlines a part, in `set` (the saved notes' marks) or as the open or hovered note. */
	function light(target: Element | Range, note: ReplyNote, lit: Set<Element>) {
		const group = note === active?.note ? current : note === hovered ? hover : null;
		if (target instanceof Range) {
			highlights?.add(target);
			group?.add(target);
			return;
		}
		lit.add(target);
		if (!target.classList.contains("is-noted")) {
			target.classList.add("is-noted");
		}
	}

	function paint() {
		for (const set of [highlights, current, hover]) {
			set?.clear();
		}
		const next = new Set<Element>();
		const found = shown().flatMap((note) => {
			const target = targetOf(note);
			const drafted = active?.note === note && active.draft;
			const button = drafted ? null : buttonFor(note);
			if (button) {
				button.hidden = !target;
				button.setAttribute("aria-expanded", String(note === active?.note));
			}
			return target ? [{ note, target, button, top: target.getBoundingClientRect().top }] : [];
		});
		found.sort((a, b) => a.top - b.top);
		placed = found;
		let below = 0;
		for (const { note, target, button } of found) {
			if (button) {
				below = position(button, target, below);
			}
			light(target, note, next);
		}
		// A part may carry several notes: it is the current one's while any of them is open.
		const opened = found.find(({ note }) => note === active?.note)?.target;
		for (const el of next) {
			el.classList.toggle("is-note-current", el === opened);
		}
		for (const el of outlined) {
			if (!next.has(el)) {
				el.classList.remove("is-noted", "is-note-current");
			}
		}
		outlined = next;
		painted();
	}

	const inside = (target: Element | Range, x: number, y: number) =>
		[...target.getClientRects()].some(
			(r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom,
		);
	/** The note marking what is at a point: a noted part that holds `el`, else highlighted text under the point. */
	function at(x: number, y: number, el: Node | null = null) {
		// Drawn at the last frame; a note closed or removed since then is no longer there.
		const now = shown();
		const hits = placed.filter(
			({ note, target }) =>
				now.includes(note) &&
				(target instanceof Range ? inside(target, x, y) : el !== null && target.contains(el)),
		);
		// Where notes overlap, the open one is the one under the pointer.
		return (hits.find(({ note }) => note === active?.note) ?? hits[0])?.note ?? null;
	}

	// Hovering highlighted text tints it and shows the pointer a click opens it with; a noted part does both in CSS.
	let moved = 0;
	document.addEventListener("pointermove", (e) => {
		if (moved || e.pointerType === "touch" || !placed.length) {
			return;
		}
		moved = requestAnimationFrame(() => {
			moved = 0;
			const el = document.elementFromPoint(e.clientX, e.clientY);
			const hit = el?.closest(OMIT) ? null : at(e.clientX, e.clientY);
			if (hit !== hovered) {
				hovered = hit;
				document.documentElement.classList.toggle("reply-over-note", hit !== null);
				paint();
			}
		});
	});

	let frame = 0;
	function schedule() {
		// Something to draw, or a light left from the note just closed.
		if (!frame && (notes.length || active || buttons.size || outlined.size || current?.size)) {
			frame = requestAnimationFrame(() => {
				frame = 0;
				paint();
			});
		}
	}
	addEventListener("resize", schedule);
	addEventListener("scroll", schedule, { capture: true, passive: true });
	root.addEventListener("toggle", schedule, true);
	new ResizeObserver(schedule).observe(root);
	new MutationObserver((records) => {
		if (records.some(({ target }) => !elementOf(target)?.closest(OMIT))) {
			schedule();
		}
	}).observe(root, {
		subtree: true,
		childList: true,
		characterData: true,
		attributeFilter: ["class", "style", "hidden", "data-ref"],
	});
	return {
		anchor,
		read,
		at,
		target: targetOf,
		button: (note) => buttons.get(note),
		flush() {
			cancelAnimationFrame(frame);
			frame = 0;
			paint();
		},
		show(note, live, draft = false) {
			active = note ? { note, live, draft } : null;
			schedule();
		},
		sync(saved) {
			notes = saved.filter((note) => note.anchor);
			schedule();
			for (const [note, button] of buttons) {
				if (!(notes.includes(note) || note === active?.note)) {
					button.remove();
					buttons.delete(note);
				}
			}
		},
	};
};
