/* reply notes: the note-taking half of kit:reply.js (select text or click a [data-ref] part, write a note) and the one popover a
   note is written and edited in. Not referenced from pages: pack joins it in front of reply.js, which calls it once with
     kitText(key)       reply.js's text for a key: the hint's and the popover's texts
     h, clean, quoted   the element and text helpers of reply.js
     root               the element whose content takes notes
     marks              kit reply marks: anchors, what a note marks, the note at a point, the open note's mark
   and places its hint and popover with kit/parts/reply/place.ts.
     addNote(note)      receives { quote | part, place, where, anchor?, text } when the reader saves a new note
     removeNote(note)   drops a saved note (Delete, or a note left empty)
     changed()          a saved note's text changed in the popover
     label(note)        a saved note's accessible name, "Note on “…”"
     toReply()          brings the reader to the Reply button, from the saved note's "Go to Reply"
     paused()           true while the reply dialog is open, when no hint or popover should appear
   It returns { edit(note), close(), row(note, head, then), follow() }: edit opens a saved note's popover (its margin button),
   close puts the popover away, row draws the note in the reply dialog, follow moves the popover with its target after the marks
   are drawn again (a scroll, a fold, a changed page), closing it when its target is gone. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the function only scopes the part's names away from the page; the code in it is split into small functions
window.ReplyNotes = ({
	kitText,
	h,
	clean,
	quoted,
	root,
	marks,
	addNote,
	removeNote,
	changed,
	label,
	toReply,
	paused,
}) => {
	const NATIVE = "a[href], button, input, select, textarea, summary, label, .reply-ui";

	/** Where a note sits: its figure's aria-label, else the section heading, else the figure caption, else the page. */
	function placeOf(el: Element): NotePlace {
		const figure = el.closest("figure");
		const label = figure?.getAttribute("aria-label");
		if (label) {
			return { kind: "figure", name: quoted(label) };
		}
		const heading = el.closest("[data-view], section")?.querySelector("h1, h2");
		if (heading) {
			return { kind: "section", name: quoted(heading.textContent ?? "") };
		}
		const caption = figure?.querySelector("figcaption");
		return caption
			? { kind: "figure", name: quoted(caption.textContent ?? "").slice(0, 60) }
			: { kind: "page" };
	}

	/** The note's place, and its locator in the agent's Markdown, which stays English whatever the page's labels. */
	function located(el: Element) {
		const place = placeOf(el);
		const where =
			place.kind === "page"
				? "page"
				: place.kind === "figure"
					? `figure "${place.name}"`
					: `§ ${place.name}`;
		return { place, where };
	}

	type Target = Omit<ReplyNote, "text">;
	/** What a new note is on: the selected text (a copy of its range) or the part. */
	const anchorOf = (target: Range | Part) => {
		const at = marks.anchor(target);
		return at ? { anchor: at } : {};
	};
	let hint: HTMLButtonElement | null = null;
	let hintFromSelection = false;
	let pop: HTMLElement | null = null;
	let popSize: ResizeObserver | null = null;
	/** Moves the open popup with its target (null while none is open): `true` when it must also fit, after a size change. */
	let follow: ((fit: boolean) => void) | null = null;
	/** The frame that fits it again after a size change. */
	let moved = 0;
	/**
	 * The note the popover is on: `saved` once it is one of the reply's notes, `live` what it is about now; focus goes back to
	 * `origin` when it closes.
	 */
	let editing: {
		note: ReplyNote;
		saved: boolean;
		live: () => NoteTarget | null;
		origin: Part | null;
	} | null = null;
	const clearHint = () => {
		hint?.remove();
		hint = null;
	};
	// Cleared before removing: removing a focused pop fires its focusout, which closes it too.
	const closePop = () => {
		const open = pop;
		pop = null;
		follow = null;
		cancelAnimationFrame(moved);
		moved = 0;
		popSize?.disconnect();
		popSize = null;
		open?.remove();
	};

	const place = window.ReplyPlace(root);
	/** Keep an anchor in document coordinates, so growing an editor after a scroll still measures the same target. */
	const documentRect = (at: DOMRect) =>
		new DOMRect(at.x + scrollX, at.y + scrollY, at.width, at.height);

	/** Clicking the small button opens the note's popover at the same target. */
	function showHint(
		text: string,
		at: DOMRect,
		target: Target,
		live: NoteTarget,
		origin: Part | null,
	) {
		clearHint();
		hintFromSelection = live instanceof Range;
		const button = h("button", { type: "button", class: "btn reply-ui reply-hint" }, text);
		button.addEventListener("pointerdown", (e) => e.preventDefault()); // keeps the text selection alive until the click
		button.addEventListener("click", () => {
			clearHint();
			create(target, live, origin);
		});
		document.body.append(button);
		place.hint(button, documentRect(at));
		hint = button;
	}

	/** Shows a popup next to its target and keeps it there as it grows, the window changes or its target scrolls. */
	function showPop(popup: HTMLElement, live: () => NoteTarget | null) {
		document.body.append(popup);
		const beside = place.beside(popup, live, () => (editing ? close() : closePop()));
		pop = popup;
		follow = beside;
		beside(true);
		if (pop === popup) {
			// Still open: placing it closes it when its target is already gone.
			popSize = new ResizeObserver(() => follow?.(true));
			popSize.observe(popup);
		}
	}
	/** The window changed size, a phone's keyboard included: the open popup fits again at the next frame. */
	const refit = () => {
		if (!follow) {
			return;
		}
		if (!moved) {
			moved = requestAnimationFrame(() => {
				moved = 0;
				follow?.(true);
			});
		}
	};
	addEventListener("resize", refit);
	window.visualViewport?.addEventListener("resize", refit);

	/**
	 * Where the popover was: "Note saved." with the way to the Reply button, which stays under the last question however far below
	 * it the note is. Focus moves to that button, so a keyboard reader is one Enter from Reply; leaving it or Escape closes it.
	 */
	function showSaved(note: ReplyNote, live: NoteTarget) {
		const go = h(
			"button",
			{
				type: "button",
				class: "btn",
				onclick: () => {
					toReply();
					closePop();
				},
			},
			kitText("toReply"),
		);
		const popup = h(
			"div",
			{
				class: "reply-ui reply-pop reply-note-pop",
				role: "group",
				"aria-label": kitText("noteSaved"),
			},
			h("p", { class: "meta" }, kitText("noteSaved")),
			h("div", { class: "reply-row" }, go),
		);
		popup.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				closePop();
				marks.button(note)?.focus();
			}
		});
		popup.addEventListener("focusout", (e) => {
			if (pop === popup && !(e.relatedTarget instanceof Node && popup.contains(e.relatedTarget))) {
				closePop();
			}
		});
		showPop(popup, () => marks.target(note) ?? live);
		go.focus({ preventScroll: true });
	}

	/**
	 * Puts the popover away. Closing keeps what the reader wrote, a new note included (a note left empty is no note); `drop`
	 * (Cancel, Delete) leaves no note. With `back`, focus goes where the note was opened from, else to its margin button, else,
	 * when neither is left (a text note cancelled or deleted), the reading position is put back at its text.
	 */
	function close({ drop = false, back = false } = {}) {
		const open = editing;
		if (!open) {
			return;
		}
		const at = open.live();
		editing = null;
		closePop();
		marks.show(null);
		const { note, saved } = open;
		const empty = !note.text.trim();
		if (saved && (drop || empty)) {
			removeNote(note);
		} else if (!(saved || drop || empty)) {
			note.text = note.text.trim();
			addNote(note);
		}
		if (back) {
			giveBack(open.origin, note, at);
		}
	}

	function giveBack(origin: Part | null, note: ReplyNote, at: NoteTarget | null) {
		marks.flush(); // the note's button, made or removed just now
		const button = marks.button(note);
		const to = origin?.isConnected ? origin : button && !button.hidden ? button : null;
		if (to) {
			to.focus({ preventScroll: true });
		} else if (at instanceof Range) {
			getSelection()?.setBaseAndExtent(
				at.startContainer,
				at.startOffset,
				at.startContainer,
				at.startOffset,
			);
		}
	}

	/**
	 * The one popover a note is written and edited in, under the text it is about with that text lit: the quote, the note, and
	 * Cancel and Save note for a new note or Delete and Done for a saved one, whose text changes as it is typed.
	 */
	function popover(
		note: ReplyNote,
		saved: boolean,
		live: () => NoteTarget | null,
		origin: Part | null,
	) {
		close();
		clearHint();
		editing = { note, saved, live, origin };
		const text = h("textarea", {
			rows: "1",
			"data-grow": "",
			"aria-label": kitText("note"),
			placeholder: kitText("notePlaceholder"),
		});
		text.value = note.text;
		text.addEventListener("input", () => {
			note.text = text.value;
			if (saved) {
				changed();
			}
		});
		const button = (name: string, onclick: () => void, kind = "btn") =>
			h("button", { type: "button", class: kind, onclick }, name);
		const finish = () => {
			const target = !saved && note.text.trim() ? live() : null;
			close({ back: saved || !target });
			if (target) {
				showSaved(note, target);
			}
		};
		const popup = h(
			"div",
			{
				class: "reply-ui reply-pop reply-note-pop",
				role: "dialog",
				"aria-label": saved ? label(note) : kitText("addNote"),
			},
			h(
				"p",
				{ class: "meta reply-quote" },
				note.quote ? `“${note.quote}”` : `${kitText("part")}: ${note.part}`,
			),
			text,
			h(
				"div",
				{ class: "reply-row" },
				saved
					? button(
							kitText("deleteNote"),
							() => close({ drop: true, back: true }),
							"btn reply-delete",
						)
					: button(kitText("cancel"), () => close({ drop: true, back: true })),
				button(kitText(saved ? "done" : "saveNote"), finish, "btn primary"),
			),
		);
		popup.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				close({ back: true });
			}
			if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
				finish();
			}
		});
		const target = live();
		marks.show(note, target ?? undefined, !saved);
		showPop(popup, live);
		text.focus({ preventScroll: true });
		text.setSelectionRange(text.value.length, text.value.length);
	}

	/** A new note's popover, on a copy of the selection's range (the selection itself moves to the note field) or on the part. */
	function create(target: Target, live: NoteTarget, origin: Part | null) {
		const on = live instanceof Range ? live.cloneRange() : live;
		popover({ ...target, text: "" }, false, () => on, origin);
	}

	/** A saved note's popover, from its margin button or a click on what it marks; a second press on the button closes it. */
	function edit(note: ReplyNote, origin: Part | null = null) {
		if (editing?.note === note) {
			close({ back: true });
			return;
		}
		popover(note, true, () => marks.target(note), origin);
	}

	/** A tree branch uses its summary's label cell, not its numbers or descendants; an explicit label always wins. */
	function partTarget(part: Part) {
		const row = part.matches(".tree details") ? part.querySelector(":scope > summary") : null;
		const label =
			part.getAttribute("aria-label") || (row?.firstElementChild ?? row ?? part).textContent;
		return {
			part: clean(label ?? "").slice(0, 60) || (part.dataset.ref?.split(" ")[0] ?? ""),
			...located(part),
			...anchorOf(part),
		};
	}

	/** Elements the browser already makes focusable. */
	const FOCUSABLE = "a[href], button, input, select, textarea, summary";

	/**
	 * Makes a part keyboard-reachable while it is a note target (is-annotatable) or kit:link.js linked it (is-linked), and undoes
	 * only what the kit set (data-kit-focusable, while the tabindex is still its 0), so a tabindex the author or a page script
	 * wrote stays. link.js keeps the same rule, which cannot be shared: each kit file is a script of its own. Reading both classes
	 * makes the result the same whichever script runs first. Diagram parts are not made reachable: a diagram has dozens.
	 */
	function syncFocus(el: Part) {
		const wanted =
			el.matches(".is-linked, .is-annotatable") && !el.matches(FOCUSABLE) && !el.closest("svg");
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

	/** Marks `el` as a note target (is-annotatable) when Enter on it can open a note: an HTML data-ref part of root outside a control. */
	function markTarget(el: Part) {
		const on =
			el.matches("[data-ref]") && root.contains(el) && !el.closest(NATIVE) && !el.closest("svg");
		el.classList.toggle("is-annotatable", on);
		syncFocus(el);
	}

	/** Marks the targets now on the page, and those a page script adds or retargets later, so they take notes by keyboard too. */
	function markTargets() {
		// An added or removed node and its descendants, or the element whose data-ref changed (now with it or without it). Each is
		// marked against where it ends up: a part moved within root stays a target, one moved out or removed stops being one.
		const partsIn = (n: Node): Part[] =>
			n instanceof HTMLElement || n instanceof SVGElement
				? [n, ...n.querySelectorAll<Part>("[data-ref]")]
				: [];
		for (const el of root.querySelectorAll<Part>("[data-ref]")) {
			markTarget(el);
		}
		new MutationObserver((records) => {
			const changed = records.flatMap((r) =>
				r.type === "attributes"
					? partsIn(r.target)
					: [...r.addedNodes, ...r.removedNodes].flatMap(partsIn),
			);
			for (const el of changed) {
				markTarget(el);
			}
		}).observe(root, { subtree: true, childList: true, attributeFilter: ["data-ref"] });
	}

	let timer: number | undefined;
	document.addEventListener("selectionchange", () => {
		clearTimeout(timer);
		timer = setTimeout(() => {
			const sel = getSelection();
			if (!sel || sel.isCollapsed) {
				if (hintFromSelection) {
					clearHint();
				}
				return;
			}
			const quote = quoted(sel.toString());
			const range = sel.getRangeAt(0);
			const node = range.commonAncestorContainer;
			const host = node instanceof Element ? node : node.parentElement;
			if (
				quote.length < 2 ||
				quote.length > 400 ||
				!host ||
				!root.contains(host) ||
				host.closest("textarea, input, select, .reply-ui") ||
				pop ||
				paused()
			) {
				return;
			}
			const rect = range.getBoundingClientRect();
			const target = { quote, ...located(host), ...anchorOf(range) };
			showHint(kitText("addNote"), rect, target, range.cloneRange(), null);
		}, 200);
	});

	/** Whether a press lands on the open note: its popover, its margin button, or what it marks. */
	function onOpen(e: PointerEvent) {
		const at = e.target instanceof Node ? e.target : null;
		const note = editing?.note;
		return Boolean(
			at &&
				(pop?.contains(at) ||
					(note &&
						(marks.button(note)?.contains(at) || marks.at(e.clientX, e.clientY, at) === note))),
		);
	}

	document.addEventListener(
		"pointerdown",
		(e) => {
			if (hint && e.target !== hint) {
				clearHint();
			}
			if (pop && !onOpen(e)) {
				// A press elsewhere puts the popover away where the reader pressed, keeping the note as written.
				if (editing) {
					close();
				} else {
					closePop();
				}
			}
		},
		true,
	);

	/**
	 * The note a click lands on: what a note marks, outside the page's controls, except a text note over a label's text (a
	 * Question's option), whose click is the note's rather than the option's.
	 */
	function notedAt(e: MouseEvent, el: Element) {
		const control = el.closest(NATIVE);
		const noted = control && !control.matches("label") ? null : marks.at(e.clientX, e.clientY, el);
		return noted && (!control || marks.target(noted) instanceof Range) ? noted : null;
	}

	document.addEventListener("click", (e) => {
		const el = e.target;
		if (!(el instanceof Element) || paused() || getSelection()?.isCollapsed === false) {
			return;
		}
		// A click on what a note marks opens that note, as a comment's highlight does in a document editor.
		const noted = notedAt(e, el);
		if (noted) {
			e.preventDefault(); // claims the click, so a Question row under the highlight keeps its answer
			if (editing?.note !== noted) {
				edit(noted);
			}
			return;
		}
		const part = el.closest<Part>("[data-ref]");
		if (!part || !root.contains(part) || el.closest(NATIVE)) {
			return;
		}
		const target = partTarget(part);
		const origin = part.tabIndex >= 0 ? part : null;
		showHint(
			`${kitText("noteOn")} “${target.part}”`,
			part.getBoundingClientRect(),
			target,
			part,
			origin,
		);
	});
	markTargets();
	document.addEventListener("keydown", (e) => {
		const part = e.target instanceof Element ? e.target.closest<Part>("[data-ref]") : null;
		if (
			e.key !== "Enter" ||
			!part ||
			e.target !== part ||
			part.matches(NATIVE) ||
			!root.contains(part)
		) {
			return;
		}
		const noted = marks.at(Number.NaN, Number.NaN, part);
		if (noted) {
			edit(noted, part);
		} else {
			create(partTarget(part), part, part);
		}
	});

	/**
	 * A note's row in the reply dialog, under its caption `head`: its text, edited where its mark is; a note with no mark on the
	 * page (an older note, a text since changed) keeps a field and Remove here. `then(removed)` follows an edit or a removal.
	 */
	function row(note: ReplyNote, head: string, then: (removed: boolean) => void) {
		const caption = h("p", { class: "meta" }, head);
		if (marks.target(note)) {
			return h(
				"div",
				{ class: "reply-note" },
				caption,
				h("p", { class: "reply-note-text" }, note.text),
			);
		}
		const text = h("textarea", { rows: "1", "data-grow": "", "aria-label": kitText("note") });
		text.value = note.text;
		text.addEventListener("input", () => {
			note.text = text.value;
			changed();
			then(false);
		});
		const remove = () => {
			removeNote(note);
			then(true);
		};
		const button = h(
			"button",
			{ type: "button", class: "btn", onclick: remove },
			kitText("remove"),
		);
		return h("div", { class: "reply-note" }, caption, text, button);
	}

	return {
		row,
		follow: () => follow?.(false),
		edit,
		close: () => {
			clearHint();
			if (editing) {
				close();
			} else {
				closePop();
			}
		},
	};
};
