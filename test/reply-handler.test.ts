import { expect, test } from "bun:test";
import {
	type PublishedPage,
	publish,
	type ReplyStorage,
	replyHandler,
} from "../skills/explainer/src/reply/handler.ts";
import type { StoredReply } from "../skills/explainer/src/reply/protocol.ts";

/** Storage in memory: the contract a host's storage meets, with nothing on disk. */
function memory(): ReplyStorage & { replies: StoredReply[] } {
	const pages = new Map<string, PublishedPage>();
	const replies: StoredReply[] = [];
	return {
		replies,
		page: async (id) => pages.get(id),
		savePage: async (id, page) => void pages.set(id, page),
		addReply: async (reply) => {
			const kept = replies.find((r) => r.page === reply.page && r.id === reply.id);
			if (kept) {
				return { reply: kept, created: false };
			}
			replies.push(reply);
			return { reply, created: true };
		},
	};
}

const HTML = (text: string) =>
	`<!doctype html><html><head>\n<meta charset="utf-8">\n<meta name="explainer-reply-to" content="">\n</head><body>${text}</body></html>`;
const ENVELOPE = {
	v: 1 as const,
	id: "0123456789abcdef",
	reply: { markdown: "Reply", notes: [], answers: [] },
};
const BASE = "http://127.0.0.1:4747";
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
	new Request(`${BASE}${path}`, {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});

test("a page keeps one URL across versions and posts to its endpoint with the version served", async () => {
	const storage = memory();
	const handle = replyHandler(storage);
	expect(await publish(storage, "report", HTML("one"))).toEqual({ version: 1, changed: true });
	expect(await publish(storage, "report", HTML("one"))).toEqual({ version: 1, changed: false });
	const first = await handle(new Request(`${BASE}/pages/report`));
	expect(first.status).toBe(200);
	expect(first.headers.get("content-type")).toBe("text/html; charset=utf-8");
	expect(await first.text()).toContain(
		'<meta name="explainer-reply-to" content="/api/pages/report/replies?version=1">',
	);
	expect(await publish(storage, "report", HTML("two"))).toEqual({ version: 2, changed: true });
	const second = await (await handle(new Request(`${BASE}/pages/report`))).text();
	expect(second).toContain("/api/pages/report/replies?version=2");
	expect(second).toContain("two");
	expect((await handle(new Request(`${BASE}/pages/other`))).status).toBe(404);
});

test("the server stamps page, version and time, and a retried id stores once", async () => {
	const storage = memory();
	const handle = replyHandler(storage);
	await publish(storage, "report", HTML("one"));
	const sent = await handle(post("/api/pages/report/replies?version=1", ENVELOPE));
	expect(sent.status).toBe(201);
	const body = await sent.json();
	expect(body).toMatchObject({ id: ENVELOPE.id, page: "report", version: 1 });
	expect(Date.parse(body.time)).toBeGreaterThan(0);
	const retried = await handle(post("/api/pages/report/replies?version=1", ENVELOPE));
	expect(retried.status).toBe(200);
	expect(await retried.json()).toEqual(body);
	expect(storage.replies).toEqual([{ ...ENVELOPE, page: "report", version: 1, time: body.time }]);
	// A copy posting through its replyTo knows no version.
	await handle(post("/api/pages/report/replies", { ...ENVELOPE, id: "fedcba9876543210" }));
	expect(storage.replies[1]?.version).toBeNull();
});

test("a file:// page (Origin null) may post across origins", async () => {
	const storage = memory();
	const handle = replyHandler(storage);
	await publish(storage, "report", HTML("one"));
	const preflight = await handle(
		new Request(`${BASE}/api/pages/report/replies`, {
			method: "OPTIONS",
			headers: {
				origin: "null",
				"access-control-request-method": "POST",
				"access-control-request-headers": "content-type",
			},
		}),
	);
	expect(preflight.status).toBe(204);
	expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
	expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");
	expect(preflight.headers.get("access-control-allow-headers")).toContain("content-type");
	const sent = await handle(post("/api/pages/report/replies", ENVELOPE, { origin: "null" }));
	expect(sent.status).toBe(201);
	expect(sent.headers.get("access-control-allow-origin")).toBe("*");
});

test("a bad request is refused with what to fix", async () => {
	const storage = memory();
	const handle = replyHandler(storage);
	await publish(storage, "report", HTML("one"));
	const refused = async (request: Request) => {
		const response = await handle(request);
		return [response.status, (await response.json()).error];
	};
	expect(await refused(post("/api/pages/report/replies", "{"))).toEqual([
		400,
		"body: expected JSON",
	]);
	expect(
		await refused(
			post("/api/pages/report/replies", {
				...ENVELOPE,
				reply: { ...ENVELOPE.reply, answers: [{ label: "a", value: 1, note: "", touched: true }] },
			}),
		),
	).toEqual([400, "reply.answers[0].value: expected a string or null"]);
	for (const version of ["x", "0", "1.5", "9007199254740993"]) {
		expect(await refused(post(`/api/pages/report/replies?version=${version}`, ENVELOPE))).toEqual([
			400,
			"version: expected a whole number from 1",
		]);
	}
	expect(await refused(post("/api/pages/missing/replies", ENVELOPE))).toEqual([
		404,
		'no page "missing" is published here',
	]);
	expect(
		await refused(
			post("/api/pages/report/replies", {
				...ENVELOPE,
				reply: { ...ENVELOPE.reply, markdown: "x".repeat(1_000_001) },
			}),
		),
	).toEqual([413, "body: expected at most 1000000 bytes"]);
	expect(storage.replies).toEqual([]);
	expect((await handle(new Request(`${BASE}/api/pages/report/replies`))).status).toBe(405);
	expect((await handle(new Request(`${BASE}/nothing`))).status).toBe(404);
});

test("publish refuses a page that cannot send, and a reply storage cannot keep is refused with 503", async () => {
	const storage = memory();
	await expect(
		publish(storage, "report", "<!doctype html><html><head></head><body></body></html>"),
	).rejects.toThrow("the page cannot send replies");
	expect(await storage.page("report")).toBeUndefined();
	await publish(storage, "report", HTML("one"));
	const handle = replyHandler({
		...storage,
		addReply: async () => {
			throw new Error("disk full");
		},
	});
	const response = await handle(post("/api/pages/report/replies", ENVELOPE));
	expect(response.status).toBe(503);
	expect(response.headers.get("access-control-allow-origin")).toBe("*");
	expect((await response.json()).error).toBe("the reply was not stored: send it again later");
});
