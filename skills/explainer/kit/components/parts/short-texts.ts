/* The short forms an axis choice's strip shows when its texts are wider than their columns (see pick-strip.tsx). */

/**
 * Each text as a narrow strip shows it: a name of letters by its shortest start no other text shares, up to three letters; any
 * text with a digit whole, since a start of a value or code (4k7, 2024) would read as another one.
 */
export function shortTexts(texts: readonly string[]): string[] {
	const start = (text: string, n: number) => [...text].slice(0, n).join("").toLowerCase();
	return texts.map((text) => {
		if (/\d/.test(text)) {
			return text;
		}
		const n =
			[1, 2].find((n) => texts.filter((t) => start(t, n) === start(text, n)).length === 1) ?? 3;
		return [...text].slice(0, n).join("");
	});
}
