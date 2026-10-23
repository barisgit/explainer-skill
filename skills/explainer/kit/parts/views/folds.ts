/* views folds: Expand all for kit:views.js, not referenced from pages: pack joins it in front of views.js, which calls it once with
   its kitText(key) for the button's texts (expandAll, collapseAll) and then the returned refresh() after every route change.
   A section (an overview section or a view) with two or more <details> of its own (at any depth, not inside a nested section)
   gets one button just above the block holding its first fold, or at the end of the section's .toolbar when one comes before that
   fold: Expand all, which opens every level of nested folds (a .tree),
   or Collapse all once every fold is open, which closes them all; it is kept in step when the reader opens folds one at a time.
   Folds a view handler draws count from its next refresh. */
window.ViewsFolds = (kitText) => {
	const buttons = new Map<HTMLElement, HTMLButtonElement>();

	/** The section's own folds, nested ones included. */
	function foldsOf(section: HTMLElement) {
		return [...section.querySelectorAll("details")].filter((d) => d.closest("section") === section);
	}

	/** Sets the section's button to what a click would do: Collapse all once every fold is open, else Expand all. */
	function sync(section: HTMLElement) {
		const button = buttons.get(section);
		if (!button) {
			return;
		}
		const all = foldsOf(section).every((d) => d.open);
		button.setAttribute("aria-expanded", String(all));
		button.textContent = kitText(all ? "collapseAll" : "expandAll");
	}

	function create(section: HTMLElement) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "expand fold-all";
		button.addEventListener("click", () => {
			const folds = foldsOf(section);
			const opening = !folds.every((d) => d.open);
			for (const d of folds) {
				d.open = opening;
			}
			sync(section);
		});
		// toggle does not bubble; capture sees every fold of the section.
		section.addEventListener("toggle", () => sync(section), true);
		buttons.set(section, button);
		return button;
	}

	/** The section's own .toolbar ahead of `fold`, if any: the records' controls, which Expand all joins. */
	function toolbarBefore(fold: HTMLElement, section: HTMLElement) {
		return [...section.querySelectorAll<HTMLElement>(".toolbar")].find(
			(bar) =>
				bar.closest("section") === section &&
				Boolean(bar.compareDocumentPosition(fold) & Node.DOCUMENT_POSITION_FOLLOWING),
		);
	}

	/** Puts the button at the end of the toolbar ahead of `fold`, else just above the block of `section` that holds `fold`. */
	function place(button: HTMLButtonElement, fold: HTMLElement, section: HTMLElement) {
		const toolbar = toolbarBefore(fold, section);
		if (toolbar) {
			if (toolbar.lastElementChild !== button) {
				toolbar.append(button);
			}
			return;
		}
		const block = blockOf(fold, section);
		if (button.nextElementSibling !== block) {
			block.before(button);
		}
	}

	/** The child of `section` that holds `el`. */
	function blockOf(el: Element, section: HTMLElement) {
		let block = el;
		while (block.parentElement && block.parentElement !== section) {
			block = block.parentElement;
		}
		return block;
	}

	return () => {
		for (const section of document.querySelectorAll<HTMLElement>("section")) {
			const [first, second] = foldsOf(section);
			if (!(first && second)) {
				buttons.get(section)?.remove();
				continue;
			}
			place(buttons.get(section) ?? create(section), first, section);
			sync(section);
		}
	};
};
