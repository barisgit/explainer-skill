/**
 * Page-side functions, as source text for `Runtime.evaluate`, that both check's page analysis and its `--do` steps use, so a report
 * and a step agree on what an element is called and whether the reader can see it.
 */

/** Page-side function naming an element in reports: `div#panel.card` (tag, id, first class). */
export const ELEMENT_NAME_JS = `(el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : "")`;

/**
 * Page-side function: true for an element laid out for the reader and not made invisible. Chrome still returns layout boxes for the
 * descendants of a closed `<details>`, so a box alone does not mean visible; only the `<summary>` of a closed disclosure is. A
 * `visibility: hidden` element keeps its box too; visibility inherits, so the element's own computed value covers its ancestors'.
 */
export const SHOWN_JS = `(el) => {
	if (el.getClientRects().length === 0 || getComputedStyle(el).visibility !== "visible") return false;
	for (let child = el, p = el.parentElement; p; child = p, p = p.parentElement) {
		if (p.tagName === "DETAILS" && !p.open && child.tagName !== "SUMMARY") return false;
	}
	return true;
}`;
