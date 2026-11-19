import { expect, test } from "bun:test";
import {
	hasEndpointSlot,
	parseEnvelope,
	withEndpoint,
} from "../skills/explainer/src/reply/protocol.ts";

const VALID = {
	v: 1 as const,
	id: "0123456789abcdef",
	reader: "Ana",
	reply: {
		markdown: "Reply on ...",
		notes: [{ where: "page", part: "Evidence", text: "check this" }],
		answers: [{ label: "Pick", value: "B", note: "", touched: true, recommended: false }],
	},
};

/** VALID with `path` (a.b.0.c) set to `value`; undefined deletes it. */
function changed(path: string, value: unknown): unknown {
	const copy = structuredClone(VALID) as Record<string, unknown>;
	const keys = path.split(".");
	const last = keys.pop() ?? "";
	const parent = keys.reduce<Record<string, unknown>>(
		(at, key) => at[key] as Record<string, unknown>,
		copy,
	);
	if (value === undefined) {
		delete parent[last];
	} else {
		parent[last] = value;
	}
	return copy;
}

test("the guard keeps a valid envelope's known fields and drops the rest", () => {
	expect(parseEnvelope({ ...VALID, extra: 1 })).toEqual({ ok: true, envelope: VALID });
	const { reader: _, ...anonymous } = VALID;
	expect(parseEnvelope(anonymous)).toEqual({ ok: true, envelope: anonymous });
});

test("the guard names the first bad field and what it expects", () => {
	const cases: [unknown, string][] = [
		[null, "envelope: expected an object"],
		[changed("v", 2), "v: expected 1"],
		[changed("id", "short"), "id: expected 8 to 64 lowercase letters, digits, - or _"],
		[changed("id", "../../etc/passwd"), "id: expected 8 to 64 lowercase letters, digits, - or _"],
		[changed("reader", 3), "reader: expected a string"],
		[changed("reply", undefined), "reply: expected an object"],
		[changed("reply.markdown", undefined), "reply.markdown: expected a string"],
		[changed("reply.notes", {}), "reply.notes: expected an array"],
		[
			changed("reply.notes.0.quote", "both"),
			"reply.notes[0]: expected exactly one of quote and part",
		],
		[changed("reply.notes.0.text", 1), "reply.notes[0].text: expected a string"],
		[changed("reply.answers.0.value", 1), "reply.answers[0].value: expected a string or null"],
		[changed("reply.answers.0.touched", "yes"), "reply.answers[0].touched: expected true or false"],
		[
			changed("reply.answers.0.recommended", 1),
			"reply.answers[0].recommended: expected true or false",
		],
	];
	for (const [value, error] of cases) {
		expect(parseEnvelope(value)).toEqual({ ok: false, error });
	}
});

test("a served page's endpoint fills the slot pack wrote in its head, and nothing else", () => {
	const meta = (url: string) => `<meta name="explainer-reply-to" content="${url}">`;
	const head = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width">\n`;
	const page = `${head}${meta("")}\n<title>t</title>\n</head><body><script>const s = '${meta("x")}';</script></body></html>`;
	expect(hasEndpointSlot(page)).toBe(true);
	expect(withEndpoint(page, '/api/pages/p/replies?version=2&x="')).toBe(
		page.replace(meta(""), meta("/api/pages/p/replies?version=2&amp;x=&quot;")),
	);
	// A page with no slot (packed without reply.js, or by an older kit) has none to fill: text that looks like one in a
	// script, a style or the body is never taken for it.
	const unslotted = `${head}<title>t</title>\n<script>const s = '${meta("x")}';</script>\n</head><body>${meta("y")}</body></html>`;
	expect(hasEndpointSlot(unslotted)).toBe(false);
	expect(withEndpoint(unslotted, "/e")).toBeUndefined();
});
