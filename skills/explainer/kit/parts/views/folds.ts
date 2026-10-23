/* views folds: Expand all for kit:views.js, not referenced from pages: pack joins it in front of views.js, which calls it once with
   the button's two texts ({ expandAll, collapseAll }) and then the returned refresh() after every route change. A section (an overview section or a view) with two or more <details>
   of its own (not inside a nested section or another fold) gets one button just above the block holding its first fold:
   Expand all, or Collapse all once every fold is open, kept in step when the reader opens folds one at a time. Folds a view
   handler draws count from its next refresh. */
window.ViewsFolds = (labels) => {
	const buttons = new Map<HTMLElement, HTMLButtonElement>();

	/** The section's own top-level folds. */
	function foldsOf(section: HTMLElement) {
		return [...section.querySelectorAll("details")].filter(
			(d) => d.closest("section") === section && !d.parentElement?.closest("details"),
		);
	}

	/** Sets the section's button to what a click would do: Collapse all once every fold is open, else Expand all. */
	function sync(section: HTMLElement) {
		const button = buttons.get(section);
		if (!button) {
			return;
		}
		const all = foldsOf(section).every((d) => d.open);
		button.setAttribute("aria-expanded", String(all));
		button.textContent = all ? labels.collapseAll : labels.expandAll;
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
			const button = buttons.get(section) ?? create(section);
			const block = blockOf(first, section);
			if (button.nextElementSibling !== block) {
				block.before(button);
			}
			sync(section);
		}
	};
};
