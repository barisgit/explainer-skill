/**
 * Page-side functions, as source text for `Runtime.evaluate`, that both check's page analysis and its `--do` steps use, so a report
 * and a step agree on what an element is called and whether the reader can see it or something in it.
 */

/** Page-side function naming an element in reports: `div#panel.card` (tag, id, first class). */
export const ELEMENT_NAME_JS = `(el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : "")`;

/**
 * Page-side function: true for an element laid out for the reader. Chrome still returns layout boxes for the descendants of a closed
 * `<details>`, so a box alone does not mean visible; only the `<summary>` of a closed disclosure is.
 */
const LAID_OUT_JS = `(el) => {
	if (el.getClientRects().length === 0) return false;
	for (let child = el, p = el.parentElement; p; child = p, p = p.parentElement) {
		if (p.tagName === "DETAILS" && !p.open && child.tagName !== "SUMMARY") return false;
	}
	return true;
}`;

/**
 * Page-side function: true when the element itself paints: laid out and not `visibility: hidden`. Visibility inherits, so the
 * element's own computed value covers its ancestors'. For things that are their own picture: a figure, a link, a text run.
 */
export const PAINTS_JS = `(el) => getComputedStyle(el).visibility === "visible" && (${LAID_OUT_JS})(el)`;

/**
 * Page-side function: true when the element's region shows the reader something: it paints, or a laid-out descendant does, since a
 * child may set `visibility: visible` inside a hidden parent. For regions: a clipping or scrolling box, a shot: target.
 */
export const REGION_VISIBLE_JS = `(el) => {
	const paints = ${PAINTS_JS};
	if (!(${LAID_OUT_JS})(el)) return false;
	return paints(el) || [...el.querySelectorAll("*")].some(paints);
}`;
