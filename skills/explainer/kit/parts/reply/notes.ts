/* reply notes: the note-taking half of kit:reply.js (select text or click a [data-ref] part, write a note). Not referenced from pages: pack
   joins it in front of reply.js, which calls it once with
     h, clean, quoted   the element and text helpers of reply.js
     root               the element whose content takes notes
     addNote(note)      receives { quote | part, where, text } when the reader saves a note
     paused()           true while the reply dialog is open, when no hint or editor should appear */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the function only scopes the part's names away from the page; the code in it is split into small functions
window.ReplyNotes = ({ h, clean, quoted, root, addNote, paused }) => {
	const NATIVE = "a[href], button, input, select, textarea, summary, label, .reply-ui";

	/** Where a note sits: its figure's aria-label, else the section heading, else the figure caption. */
	const where = (el: Element) => {
		const figure = el.closest("figure");
		const label = figure?.getAttribute("aria-label");
		if (label) {
			return `figure "${quoted(label)}"`;
		}
		const heading = el.closest("[data-view], section")?.querySelector("h1, h2");
		if (heading) {
			return `§ ${quoted(heading.textContent ?? "")}`;
		}
		const caption = figure?.querySelector("figcaption");
		return caption ? `figure "${quoted(caption.textContent ?? "").slice(0, 60)}"` : "page";
	};

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
		const text = h("textarea", { "aria-label": "Note", placeholder: "Note for the agent" });
		const save = () => {
			const value = text.value.trim();
			closePop();
			if (value) {
				addNote({ ...target, text: value });
			}
		};
		const popup = h(
			"div",
			{ class: "reply-ui reply-pop", role: "dialog", "aria-label": "Add a note" },
			h("p", { class: "meta" }, target.quote ? `“${target.quote}”` : `Part: ${target.part}`),
			text,
			h(
				"div",
				{ class: "reply-row" },
				h("button", { type: "button", class: "btn", onclick: closePop }, "Cancel"),
				h("button", { type: "button", class: "btn primary", onclick: save }, "Save note"),
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
		where: where(part),
	});

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
				"Add note",
				rect.left + scrollX,
				rect.bottom + scrollY + 6,
				{ quote, where: where(host) },
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
		showHint(`Note on “${target.part}”`, e.pageX, e.pageY + 14, target, false);
	});
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
