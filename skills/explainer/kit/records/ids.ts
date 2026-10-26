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

/** The problem of two group values whose slugs are one id: the validator finds it among a category's values, the model in data. */
export const groupIdClash = (a: string, b: string, id: string) =>
	`${JSON.stringify(a)} and ${JSON.stringify(b)} make the same group id "${id}"; make them differ in more than case and punctuation`;
