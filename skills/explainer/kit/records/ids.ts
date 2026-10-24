/** Ids the records core derives from authored values, in one place, so the validator and the model agree on them. */

/** A group value as an id part: lower case letters and digits, runs of anything else as one `-`; `_` for none left. */
export function slug(value: string): string {
	const text = value
		.normalize("NFKC")
		.toLocaleLowerCase("en")
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "");
	return text || "_";
}
