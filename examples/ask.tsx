/* The gallery's line over an example: the question it answers, as its prompt.md has it. Rendered once when the page packs. */

/** `prompt` in quotation marks, its `backticked` words as code. */
export function Ask({ prompt }: { prompt: string }) {
	const parts = prompt.trim().split("`");
	return <p class="ask">“{parts.map((part, i) => (i % 2 ? <code>{part}</code> : part))}”</p>;
}
