/* reply notes: the note-taking half of kit:reply.js (select text or click a [data-ref] part, write a note). Not referenced from pages: pack
   joins it in front of reply.js, which calls it once with
     kitText(key)       reply.js's text for a key: the hint's and the editor's texts
     h, clean, quoted   the element and text helpers of reply.js
     root               the element whose content takes notes
     addNote(note)      receives { quote | part, place, where, text } when the reader saves a note
     paused()           true while the reply dialog is open, when no hint or editor should appear */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the function only scopes the part's names away from the page; the code in it is split into small functions
window.ReplyNotes = ({ kitText, h, clean, quoted, root, addNote, paused }) => {
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
	let hint: HTMLButtonElement | null = null;
	let hintFromSelection = false;
	let pop: HTMLElement | null = null;
	const clearHint = () => {
		hint?.remove();
		hint = null;
	};
	const closePop = () => {
		pop?.remove();
		pop = null;
	};

	/** A small button at a document position; clicking it opens the note editor for `target`, anchored under `at`. */
	function showHint(label: string, x: number, y: number, target: Target, fromSelection: boolean) {
		clearHint();
		hintFromSelection = fromSelection;
		const button = h("button", { type: "button", class: "btn reply-ui reply-hint" }, label);
		button.style.left = `${Math.max(8, Math.min(x, scrollX + innerWidth - 220))}px`;
		button.style.top = `${y}px`;
		button.addEventListener("pointerdown", (e) => e.preventDefault()); // keeps the text selection alive until the click
		button.addEventListener("click", () => {
			const at = button.getBoundingClientRect();
			clearHint();
			openNote(target, at);
		});
		document.body.append(button);
		hint = button;
	}

	function openNote(target: Target, at: DOMRect) {
		closePop();
		const text = h("textarea", {
			"aria-label": kitText("note"),
			placeholder: kitText("notePlaceholder"),
		});
		const save = () => {
			const value = text.value.trim();
			closePop();
			if (value) {
				addNote({ ...target, text: value });
			}
		};
		const popup = h(
			"div",
			{ class: "reply-ui reply-pop", role: "dialog", "aria-label": kitText("addNote") },
			h(
				"p",
				{ class: "meta" },
				target.quote ? `“${target.quote}”` : `${kitText("part")}: ${target.part}`,
			),
			text,
			h(
				"div",
				{ class: "reply-row" },
				h("button", { type: "button", class: "btn", onclick: closePop }, kitText("cancel")),
				h("button", { type: "button", class: "btn primary", onclick: save }, kitText("saveNote")),
			),
		);
		text.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				closePop();
			}
			if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
				save();
			}
		});
		document.body.append(popup);
		popup.style.left = `${Math.max(8, Math.min(at.left + scrollX, scrollX + innerWidth - popup.offsetWidth - 8))}px`;
		popup.style.top = `${at.bottom + scrollY + 6}px`;
		pop = popup;
		text.focus({ preventScroll: true });
	}

	const partTarget = (part: Part) => ({
		part:
			clean(part.getAttribute("aria-label") || part.textContent || "").slice(0, 60) ||
			(part.dataset.ref?.split(" ")[0] ?? ""),
		...located(part),
	});

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
			showHint(
				kitText("addNote"),
				rect.left + scrollX,
				rect.bottom + scrollY + 6,
				{ quote, ...located(host) },
				true,
			);
		}, 200);
	});

	document.addEventListener(
		"pointerdown",
		(e) => {
			if (hint && e.target !== hint) {
				clearHint();
			}
			if (pop && !(e.target instanceof Node && pop.contains(e.target))) {
				closePop();
			}
		},
		true,
	);

	document.addEventListener("click", (e) => {
		const el = e.target;
		if (!(el instanceof Element)) {
			return;
		}
		const part = el.closest<Part>("[data-ref]");
		if (
			!part ||
			!root.contains(part) ||
			el.closest(NATIVE) ||
			getSelection()?.isCollapsed === false ||
			paused()
		) {
			return;
		}
		const target = partTarget(part);
		showHint(`${kitText("noteOn")} “${target.part}”`, e.pageX, e.pageY + 14, target, false);
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
		openNote(partTarget(part), part.getBoundingClientRect());
	});
};
