import type { Cdp } from "./cdp.ts";

const RESTORE_KEY = `Symbol.for("explainer.check.fullPage")`;

/**
 * A full-page image is a document overview, not a tall viewport: viewport-sticky boxes belong at their flow positions and
 * viewport-fixed overlays belong in first-screen/element shots instead. Do not scroll or resize: that can run page handlers,
 * reflow viewport-height panels, clamp inner scroll offsets and change the state the steps set. Inner-scroller sticky boxes
 * and fixed boxes with their own containing block stay as they are. Save declarations, not a copy of the DOM or its state.
 */
const PREPARE_JS = `(() => {
	const saved = [];
	window[${RESTORE_KEY}] = () => {
		for (const [el, style] of saved) {
			if (style === null) el.removeAttribute("style"); else el.setAttribute("style", style);
		}
		delete window[${RESTORE_KEY}];
	};
	const htmlStyle = getComputedStyle(document.documentElement);
	const bodyStyle = getComputedStyle(document.body);
	// CSS Overflow's body-to-viewport propagation changes used overflow, not getComputedStyle's values.
	const bodyPropagates = htmlStyle.overflowX === "visible" && htmlStyle.overflowY === "visible"
		&& htmlStyle.contain === "none" && bodyStyle.contain === "none" && bodyStyle.display !== "none";
	const innerSticky = (el) => {
		for (let p = el.parentElement; p && p !== document.scrollingElement; p = p.parentElement) {
			if (p === document.body && bodyPropagates) continue;
			const s = getComputedStyle(p);
			if (/auto|scroll|hidden|overlay/.test(s.overflowX + " " + s.overflowY)) return true;
		}
		return false;
	};
	// Decide before editing any element: an ancestor's temporary style must not change a descendant's classification.
	const targets = [...document.querySelectorAll("*")].map((el) => ({ el, position: getComputedStyle(el).position }))
		.filter(({ el, position }) => (position === "sticky" && !innerSticky(el))
			|| (position === "fixed" && (!(el instanceof HTMLElement) || el.offsetParent === null)));
	const insets = ["top", "right", "bottom", "left", "inset-block-start", "inset-block-end", "inset-inline-start", "inset-inline-end"]
		.map((inset) => inset + ":auto!important").join(";");
	for (const { el, position } of targets) {
		const style = el.getAttribute("style");
		saved.push([el, style]);
		const rules = position === "fixed" ? "opacity:0!important" : "position:relative!important;" + insets;
		// Attribute writes avoid Chrome lazily recreating an empty style attribute after CSSOM edits and removal.
		el.setAttribute("style", (style ?? "") + ";transition:none!important;" + rules);
	}
})()`;

/**
 * Returns a base64 PNG of the document at its current width/state, with viewport overlays normalized only for this capture.
 * Chrome's beyond-viewport capture can deliver resize events even when innerHeight ends unchanged. Suspend page callbacks
 * during the capture, then restore declarations and script execution even on failure. First-screen and element shots stay live.
 */
export async function fullPageScreenshot(cdp: Cdp, width: number): Promise<string> {
	try {
		await cdp.send("Emulation.setScriptExecutionDisabled", { value: true });
		await cdp.evaluate(PREPARE_JS);
		const { contentSize } = await cdp.send<{ contentSize: { height: number } }>(
			"Page.getLayoutMetrics",
		);
		const { data } = await cdp.send<{ data: string }>("Page.captureScreenshot", {
			format: "png",
			captureBeyondViewport: true,
			clip: { x: 0, y: 0, width, height: Math.ceil(contentSize.height), scale: 1 },
		});
		return data;
	} finally {
		try {
			await cdp.evaluate(`window[${RESTORE_KEY}]?.()`);
		} finally {
			await cdp.send("Emulation.setScriptExecutionDisabled", { value: false });
		}
	}
}
