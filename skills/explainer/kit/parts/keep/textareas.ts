/* Keep's writing fields: print plain text so long answers can break across sheets; older browsers without field-sizing:
   content get growth after typing, restoring, mounting or changing width. The theme owns the minimum, cap and wrapping. */
(() => {
	const selector = "textarea[data-grow]";
	const native = CSS.supports("field-sizing", "content");
	const widths = new WeakMap<HTMLTextAreaElement, number>();
	let printing = false;
	function size(field: HTMLTextAreaElement) {
		if (!field.getClientRects().length) {
			return;
		}
		field.style.height = "auto";
		const style = getComputedStyle(field);
		const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
		field.style.height = `${field.scrollHeight + border}px`;
	}
	const resize = native
		? null
		: new ResizeObserver((entries) => {
				for (const { target, contentRect } of entries) {
					if (target instanceof HTMLTextAreaElement && widths.get(target) !== contentRect.width) {
						widths.set(target, contentRect.width);
						size(target);
					}
				}
			});
	/** A plain-text sibling also survives pagination when a client component remounts its controls for print. */
	function mirror(field: HTMLTextAreaElement) {
		if (!field.nextElementSibling?.matches("[data-grow-print]")) {
			const copy = document.createElement("div");
			copy.dataset.growPrint = "";
			copy.textContent = field.value;
			field.after(copy);
		}
	}
	function track(field: HTMLTextAreaElement) {
		if (!field.isConnected) {
			resize?.unobserve(field);
			widths.delete(field);
			return;
		}
		if (printing) {
			mirror(field);
		}
		if (resize) {
			resize.observe(field);
			size(field);
		}
	}
	/** Only changed subtrees need work; removed hidden controls must be released even if their size stayed zero. */
	function fieldsIn(node: Node): HTMLTextAreaElement[] {
		if (!(node instanceof Element)) {
			return [];
		}
		return [
			...(node instanceof HTMLTextAreaElement && node.matches(selector) ? [node] : []),
			...node.querySelectorAll<HTMLTextAreaElement>(selector),
		];
	}
	const mounts = new MutationObserver((records) => {
		for (const record of records) {
			for (const node of [...record.removedNodes, ...record.addedNodes]) {
				for (const field of fieldsIn(node)) {
					track(field);
				}
			}
		}
	});
	const observe = () => mounts.observe(document.body, { childList: true, subtree: true });
	const refresh = () => document.querySelectorAll<HTMLTextAreaElement>(selector).forEach(track);
	addEventListener("beforeprint", () => {
		printing = true;
		observe();
		refresh();
	});
	addEventListener("afterprint", () => {
		printing = false;
		if (native) {
			mounts.disconnect();
		}
		for (const copy of document.querySelectorAll("[data-grow-print]")) {
			copy.remove();
		}
		refresh();
	});
	if (!native) {
		document.addEventListener("input", (event) => {
			if (event.target instanceof HTMLTextAreaElement && event.target.matches(selector)) {
				size(event.target);
			}
		});
		observe();
		void document.fonts.ready.then(refresh);
		refresh();
	}
})();
