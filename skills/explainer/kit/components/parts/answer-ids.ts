/* The ids of the controls that answer in a reply (a Question's options, a Records row's choices), in one place so both write them one way. */

/**
 * Text as part of an id, case kept: letters, digits and `-` stay, every other character (`_` included) becomes `_<hex code
 * point>_`, so distinct texts give distinct parts and the id holds no space or punctuation ("Ship now" is "Ship_20_now").
 */
export const idPart = (text: string) =>
	text.replace(/[^\p{L}\p{N}-]/gu, (c) => `_${(c.codePointAt(0) ?? 0).toString(16)}_`);

/**
 * An option's id, `name-value`: the same on every pack and distinct for distinct values of one Question, so keep.js keeps the
 * answer by it. Two Questions can still meet ("a-b" with "c", "a" with "b-c"); pack fails on a page where they do.
 */
export const idOf = (name: string, value: string) => `${idPart(name)}-${idPart(value)}`;
