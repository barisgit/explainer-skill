/* recall: a Term opens and closes its reminder (kit Recall). pack includes it for a Term.
   The state is the Term's aria-expanded, which the theme shows the box after it by; nothing else is kept. */
document.addEventListener("click", (event) => {
	const term = event.target instanceof Element ? event.target.closest("button[data-recall]") : null;
	term?.setAttribute(
		"aria-expanded",
		term.getAttribute("aria-expanded") === "true" ? "false" : "true",
	);
});
