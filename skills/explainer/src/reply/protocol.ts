/**
 * The reply channel's contract: what a page sends (`ReplyEnvelope`), what a server keeps (`StoredReply`), the guard that reads an
 * envelope from untrusted JSON and names the first bad field, the routes, and the meta element a page reads its endpoint from.
 * Web standards only (no Bun or node API), so the handler built on it runs on any runtime with fetch's Request and Response.
 * kit/reply.ts builds the envelope; it is a classic script and cannot import this, so kit-types/globals.d.ts declares the same
 * type and kit-types/reply-protocol.ts fails the typecheck when the two differ.
 */

/** The envelope version this module reads and the kit sends. */
export const REPLY_VERSION = 1;

/** A reader's note: on selected text (`quote`) or a data-ref part (`part`), exactly one of them; `where` names its place. */
export interface ReplyEnvelopeNote {
	where: string;
	quote?: string;
	part?: string;
	text: string;
}

/** One answer as the reply lists it; `value` is null when nothing is chosen, `recommended` absent where the page marks none. */
export interface ReplyEnvelopeAnswer {
	label: string;
	value: string | null;
	note: string;
	touched: boolean;
	recommended?: boolean;
}

/** What a page posts. `id` is the page's, one per reply, so a retried send stores once; `reader` the name the reader gave. */
export interface ReplyEnvelope {
	v: typeof REPLY_VERSION;
	id: string;
	reader?: string;
	reply: { markdown: string; notes: ReplyEnvelopeNote[]; answers: ReplyEnvelopeAnswer[] };
}

/** A reply as a server keeps it: the envelope with what the server knows and the page does not. */
export interface StoredReply extends ReplyEnvelope {
	/** The page id, from the endpoint the reply was posted to. */
	page: string;
	/** The page version served, from the endpoint's `?version=`; null for a copy that posts through its `replyTo`. */
	version: number | null;
	/** When the server received it, ISO 8601. */
	time: string;
}

/** A page id: lowercase, so ids that differ only in case never share a file on a case-insensitive disk. */
export const PAGE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** A reply id: random from the page (the kit sends 32 hex digits); also part of file names, so only these characters. */
const REPLY_ID = /^[a-z0-9_-]{8,64}$/;
const READER_MAX = 200;

/** Where a page is served, so its URL (and so its saved answers) stays the same across versions. */
export const pagePath = (id: string) => `/pages/${id}`;
/** Where a page's replies are posted. */
export const repliesPath = (id: string) => `/api/pages/${id}/replies`;

/**
 * The meta element a page reads its endpoint from. pack writes it on every page that can send (one carrying reply.js), with
 * the frontmatter `replyTo` or empty, among the leading meta elements of its head: the slot a server fills when it serves the page.
 */
export const ENDPOINT_META = "explainer-reply-to";

/** The largest reply body a server takes, in UTF-8 bytes; `check --do reply` holds what Send would post to it too. */
export const MAX_BODY = 1_000_000;

/**
 * The endpoint slot: the meta element among the head's leading meta elements. Matched from the document's start through meta
 * elements only, so text in a script, a style or the body can never be taken for it.
 */
const SLOT = new RegExp(
	`^(\\s*<!doctype html>\\s*<html[^>]*>\\s*<head>\\s*(?:<meta(?: [a-z-]+="[^"]*")*>\\s*)*?)<meta name="${ENDPOINT_META}" content="[^"]*">`,
	"i",
);
const attribute = (text: string) =>
	text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

/** The meta element naming `endpoint` ("" for none). */
export const endpointMeta = (endpoint: string) =>
	`<meta name="${ENDPOINT_META}" content="${attribute(endpoint)}">`;

/** Whether `html` has the endpoint slot, which a page packed with reply.js by the current kit has: only such a page can Send. */
export const hasEndpointSlot = (html: string) => SLOT.test(html);

/** `html` posting to `endpoint`: its slot filled; undefined for a page without one (hasEndpointSlot). */
export function withEndpoint(html: string, endpoint: string): string | undefined {
	const match = SLOT.exec(html);
	return match ? `${match[1]}${endpointMeta(endpoint)}${html.slice(match[0].length)}` : undefined;
}

/** The guard's result: the envelope with only its known fields, or the first bad field and what it should be. */
export type Parsed = { ok: true; envelope: ReplyEnvelope } | { ok: false; error: string };

/** Thrown inside the guard only, carrying "field: expected ..."; parseEnvelope turns it into its result. */
class Bad extends Error {}

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

function object(value: unknown, at: string): Record<string, unknown> {
	if (!isObject(value)) {
		throw new Bad(`${at}: expected an object`);
	}
	return value;
}

function string(value: unknown, at: string): string {
	if (typeof value !== "string") {
		throw new Bad(`${at}: expected a string`);
	}
	return value;
}

function array(value: unknown, at: string): unknown[] {
	if (!Array.isArray(value)) {
		throw new Bad(`${at}: expected an array`);
	}
	return value;
}

function note(value: unknown, at: string): ReplyEnvelopeNote {
	const { where, quote, part, text } = object(value, at);
	if ((quote === undefined) === (part === undefined)) {
		throw new Bad(`${at}: expected exactly one of quote and part`);
	}
	return {
		where: string(where, `${at}.where`),
		...(quote === undefined ? {} : { quote: string(quote, `${at}.quote`) }),
		...(part === undefined ? {} : { part: string(part, `${at}.part`) }),
		text: string(text, `${at}.text`),
	};
}

function answer(value: unknown, at: string): ReplyEnvelopeAnswer {
	const { label, value: given, note, touched, recommended } = object(value, at);
	if (given !== null && typeof given !== "string") {
		throw new Bad(`${at}.value: expected a string or null`);
	}
	if (typeof touched !== "boolean") {
		throw new Bad(`${at}.touched: expected true or false`);
	}
	if (recommended !== undefined && typeof recommended !== "boolean") {
		throw new Bad(`${at}.recommended: expected true or false`);
	}
	return {
		label: string(label, `${at}.label`),
		value: given,
		note: string(note, `${at}.note`),
		touched,
		...(recommended === undefined ? {} : { recommended }),
	};
}

function envelope(value: unknown): ReplyEnvelope {
	const { v, id: given, reader: name, reply: content } = object(value, "envelope");
	if (v !== REPLY_VERSION) {
		throw new Bad(`v: expected ${REPLY_VERSION}`);
	}
	const id = string(given, "id");
	if (!REPLY_ID.test(id)) {
		throw new Bad("id: expected 8 to 64 lowercase letters, digits, - or _");
	}
	const reader = name === undefined ? undefined : string(name, "reader");
	if (reader !== undefined && reader.length > READER_MAX) {
		throw new Bad(`reader: expected at most ${READER_MAX} characters`);
	}
	const { markdown, notes, answers } = object(content, "reply");
	return {
		v: REPLY_VERSION,
		id,
		...(reader === undefined ? {} : { reader }),
		reply: {
			markdown: string(markdown, "reply.markdown"),
			notes: array(notes, "reply.notes").map((n, i) => note(n, `reply.notes[${i}]`)),
			answers: array(answers, "reply.answers").map((a, i) => answer(a, `reply.answers[${i}]`)),
		},
	};
}

/**
 * Reads an envelope from parsed JSON. A field this version does not know is dropped, so a stored reply holds the contract only;
 * a missing or mistyped one fails, naming it: `reply.answers[0].value: expected a string or null`.
 */
export function parseEnvelope(value: unknown): Parsed {
	try {
		return { ok: true, envelope: envelope(value) };
	} catch (e) {
		if (e instanceof Bad) {
			return { ok: false, error: e.message };
		}
		throw e;
	}
}
