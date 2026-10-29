/* What the reader entered in a Records block's answers, kept by the island across the redraws of its views (see records-answer.tsx). */

/** What the reader entered in the block's answers, by control id: a radio's checked state, a note's text. */
export type AnswerMemory = Map<string, string | boolean>;

/**
 * Remembers every answer entered in `block`, including what keep restores or clears (it announces both as input and change), so a
 * view that draws a record's answer anew (another view, a filter that hides its row and returns it) starts from it. keep alone
 * cannot: it does not restore a control the page replaced when one with its id is already there, and the new one is blank.
 * Returns what stops the listening.
 */
export function rememberAnswers(block: HTMLElement, memory: AnswerMemory): () => void {
	const remember = (event: Event) => {
		const answer = event.target instanceof Element ? event.target.closest("fieldset.answer") : null;
		for (const input of answer?.querySelectorAll("input") ?? []) {
			memory.set(input.id, input.type === "radio" ? input.checked : input.value);
		}
	};
	block.addEventListener("input", remember);
	block.addEventListener("change", remember);
	return () => {
		block.removeEventListener("input", remember);
		block.removeEventListener("change", remember);
	};
}
