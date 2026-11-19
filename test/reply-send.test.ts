import { afterAll, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Cdp } from "../skills/explainer/src/cdp.ts";
import {
	type PublishedPage,
	publish,
	type ReplyStorage,
	replyHandler,
} from "../skills/explainer/src/reply/handler.ts";
import type { StoredReply } from "../skills/explainer/src/reply/protocol.ts";
import { withTestPage } from "./browser.ts";
import { load, packedMdx, packMdx, scratch, until } from "./support.ts";

const dir = scratch();

const pages = new Map<string, PublishedPage>();
const stored: StoredReply[] = [];
const storage: ReplyStorage = {
	page: async (id) => pages.get(id),
	savePage: async (id, page) => void pages.set(id, page),
	addReply: async (reply) => {
		const kept = stored.find((r) => r.id === reply.id);
		if (kept) {
			return { reply: kept, created: false };
		}
		stored.push(reply);
		return { reply, created: true };
	},
};
const handle = replyHandler(storage);
/** While set, every post is refused as a server that is down behind a proxy would. */
let down = false;
/** While set, a post is stored but its response is lost, as on a connection that drops after the request. */
let lost = false;
/** While set, a post is answered with a page, as a proxy's login or error page would be: a 200 that is no receipt. */
let html = false;
/** While set, every post is refused as a bad request; `error` is the server's reason. */
let refused = false;
/** While set, a post is answered 200 with JSON whose body never finishes, as a stalled connection would. */
let stalled = false;
let error = "reply.markdown: expected a string";
/** The bodies posted, as sent. */
const bodies: string[] = [];
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	// No idle limit: a stalled response stays stalled, as one behind a slow proxy may, rather than Bun closing it at 10 s.
	idleTimeout: 0,
	fetch: async (request) => {
		if (request.method === "POST") {
			bodies.push(await request.clone().text());
		}
		if (down && request.method === "POST") {
			return new Response("down", { status: 503 });
		}
		if (html && request.method === "POST") {
			return new Response("<!doctype html><p>Sign in", {
				headers: { "content-type": "text/html", "access-control-allow-origin": "*" },
			});
		}
		if (stalled && request.method === "POST") {
			const stream = new ReadableStream({
				start: (c) => c.enqueue(new TextEncoder().encode('{"id":')),
			});
			return new Response(stream, {
				headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
			});
		}
		if (refused && request.method === "POST") {
			return new Response(JSON.stringify({ error }), {
				status: 400,
				headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
			});
		}
		const response = await handle(request);
		return lost && request.method === "POST" ? new Response("lost", { status: 502 }) : response;
	},
});
const origin = `http://127.0.0.1:${server.port}`;
afterAll(async () => {
	await server.stop(true);
	dir.cleanup();
});
beforeEach(() => {
	stored.length = 0;
	bodies.length = 0;
	down = false;
	lost = false;
	html = false;
	refused = false;
	stalled = false;
	error = "reply.markdown: expected a string";
});

const PAGE = (front: string) => `---
title: Plan${front}
---
import { Question } from "kit";

# Plan

<Question name="pick" legend="Which one?" options={{ a: "A", b: "B" }} />
`;

const plain = await packedMdx(dir, "plain", PAGE(""));
await publish(storage, "plan", readFileSync(plain, "utf8"));
/** The page with buttons labelled as long as a translation may make them. */
const long = await packedMdx(
	dir,
	"long",
	PAGE(
		'\nlang: de\nlabels:\n  copyReply: "Rückmeldung in die Zwischenablage kopieren"\n  sendReply: "Rückmeldung jetzt absenden"',
	),
);
await publish(storage, "long", readFileSync(long, "utf8"));

const $ = (cdp: Cdp, expression: string) => cdp.evaluate(expression, true);
/** A fresh page of the test Chrome, with the domains load waits on enabled. */
const withPage = (fn: (cdp: Cdp) => Promise<void>) =>
	withTestPage(async (cdp) => {
		await Promise.all(["Page", "Runtime"].map((domain) => cdp.send(`${domain}.enable`)));
		await fn(cdp);
	});
/** Opens the dialog: chooses B first when `answer`, then presses Reply. */
const openReply = (cdp: Cdp, answer = true) =>
	$(
		cdp,
		`(${answer} && document.getElementById("pick-b").click(), document.querySelector(".reply-bar .primary").click())`,
	);
const statusText = 'document.querySelector(".reply-dialog footer [role=status]").textContent';
const send = (cdp: Cdp) => $(cdp, `document.querySelector(".reply-dialog .reply-send").click()`);

test("a served page sends its reply to its endpoint, says so, and keeps the answers; the same reply again stores once", async () => {
	await withPage(async (cdp) => {
		await load(cdp, `${origin}/pages/plan`);
		await openReply(cdp);
		await $(
			cdp,
			`(() => { const name = document.querySelector(".reply-dialog .reply-reader input"); name.value = "Ana"; name.dispatchEvent(new Event("input", { bubbles: true })); })()`,
		);
		// What check --do reply validates is what Send posts, byte for byte.
		const body = String(await $(cdp, "ReplyNotes.body()"));
		await send(cdp);
		expect(await until(cdp, `${statusText} === "Sent."`)).toBe(true);
		expect(bodies).toEqual([body]);
		expect(stored).toHaveLength(1);
		expect(stored[0]).toMatchObject({
			v: 1,
			page: "plan",
			version: 1,
			reader: "Ana",
			reply: { answers: [{ label: "Which one?", value: "B", touched: true }] },
		});
		expect(stored[0]?.id).toMatch(/^[0-9a-f]{32}$/);
		expect(stored[0]?.reply.markdown).toContain("- Which one? B");
		// Send clears nothing, on the page or after a reload.
		expect(await $(cdp, `document.getElementById("pick-b").checked`)).toBe(true);
		await load(cdp);
		expect(await $(cdp, `document.getElementById("pick-b").checked`)).toBe(true);
		// The reader's name stays; the same reply sent again is stored once.
		await openReply(cdp, false);
		expect(await $(cdp, `document.querySelector(".reply-dialog .reply-reader input").value`)).toBe(
			"Ana",
		);
		await send(cdp);
		expect(await until(cdp, `${statusText} === "Sent."`)).toBe(true);
		expect(stored).toHaveLength(1);
		// A changed reply is a new one, with a new id.
		await $(
			cdp,
			`(document.getElementById("pick-a").click(), document.querySelector(".reply-dialog").close())`,
		);
		await openReply(cdp, false);
		await send(cdp);
		expect(await until(cdp, `${statusText} === "Sent."`)).toBe(true);
		expect(stored).toHaveLength(2);
		expect(stored[1]?.id).not.toBe(stored[0]?.id);
		expect(stored[1]?.reply.markdown).toContain("- Which one? A");
	});
}, 30_000);

test("a send without the server's receipt says delivery is unconfirmed; a refusal says it failed; sending again stores once", async () => {
	await withPage(async (cdp) => {
		await load(cdp, `${origin}/pages/plan`);
		await openReply(cdp);
		refused = true;
		await send(cdp);
		expect(await until(cdp, `${statusText}.startsWith("Send failed: ")`)).toBe(true);
		expect(await $(cdp, statusText)).toBe(
			"Send failed: 400 reply.markdown: expected a string. Your answers and notes are kept.",
		);
		refused = false;
		html = true;
		await send(cdp);
		expect(await until(cdp, `${statusText}.startsWith("Could not confirm")`)).toBe(true);
		expect(await $(cdp, statusText)).toBe(
			"Could not confirm delivery: no receipt from the server. Send again: it is stored once.",
		);
		html = false;
		down = true;
		await send(cdp);
		expect(await until(cdp, `${statusText}.includes("503")`)).toBe(true);
		expect(await $(cdp, statusText)).toBe(
			"Could not confirm delivery: 503 down. Send again: it is stored once.",
		);
		expect(new Set(bodies.map((b) => JSON.parse(b).id)).size).toBe(1);
		expect(await $(cdp, `document.getElementById("pick-b").checked`)).toBe(true);
		expect(stored).toEqual([]);
		down = false;
		await send(cdp);
		expect(await until(cdp, `${statusText}.startsWith("Sent.")`)).toBe(true);
		expect(stored).toHaveLength(1);
	});
}, 30_000);

test("a receipt whose body never finishes ends in unconfirmed within the send's deadline, and sending again stores once", async () => {
	await withPage(async (cdp) => {
		await load(cdp, `${origin}/pages/plan`);
		await openReply(cdp);
		stalled = true;
		await send(cdp);
		await Bun.sleep(15_000);
		expect(await until(cdp, `${statusText}.startsWith("Could not confirm")`)).toBe(true);
		expect(await $(cdp, `document.querySelector(".reply-dialog .reply-send").disabled`)).toBe(
			false,
		);
		stalled = false;
		await send(cdp);
		expect(await until(cdp, `${statusText}.startsWith("Sent.")`)).toBe(true);
		expect(new Set(bodies.map((b) => JSON.parse(b).id)).size).toBe(1);
		expect(stored).toHaveLength(1);
	});
}, 40_000);

test("a reply changed after a send that may have been stored is a new reply, not a retry", async () => {
	await withPage(async (cdp) => {
		await load(cdp, `${origin}/pages/plan`);
		lost = true;
		await openReply(cdp);
		await send(cdp);
		expect(await until(cdp, `${statusText}.startsWith("Could not confirm delivery: 502")`)).toBe(
			true,
		);
		lost = false;
		await $(cdp, `document.getElementById("pick-a").click()`);
		await send(cdp);
		expect(await until(cdp, `${statusText}.startsWith("Sent.")`)).toBe(true);
		expect(stored.map((r) => r.reply.answers[0]?.value)).toEqual(["B", "A"]);
	});
}, 30_000);

test("a page with no endpoint copies only", async () => {
	await withPage(async (cdp) => {
		await load(cdp, `file://${plain}`);
		await openReply(cdp);
		expect(
			await $(
				cdp,
				`[...document.querySelectorAll(".reply-dialog footer button")].map((b) => b.textContent)`,
			),
		).toEqual(["Copy reply"]);
		expect(await $(cdp, `document.querySelector(".reply-reader")`)).toBeNull();
	});
}, 30_000);

test("a file:// copy with replyTo sends to the server across origins", async () => {
	const copy = await packedMdx(dir, "copy", PAGE(`\nreplyTo: ${origin}/api/pages/plan/replies`));
	expect(readFileSync(copy, "utf8")).toContain(
		`<meta name="explainer-reply-to" content="${origin}/api/pages/plan/replies">`,
	);
	await withPage(async (cdp) => {
		await load(cdp, `file://${copy}`);
		await openReply(cdp);
		await send(cdp);
		expect(await until(cdp, `${statusText}.startsWith("Sent.")`)).toBe(true);
	});
	expect(stored).toHaveLength(1);
	expect(stored[0]?.version).toBeNull();
}, 30_000);

test("replyTo is written as the absolute http(s) URL it parses to, without credentials", async () => {
	const written = await packedMdx(
		dir,
		"canonical",
		PAGE("\nreplyTo: HTTP://Example.COM:80/api/x/../pages/plan/replies"),
	);
	expect(readFileSync(written, "utf8")).toContain(
		'<meta name="explainer-reply-to" content="http://example.com/api/pages/plan/replies">',
	);
	for (const [value, message] of [
		["mailto:me@example.com", "replyTo must be the absolute http(s) URL replies are sent to"],
		["/api/pages/plan/replies", "replyTo must be the absolute http(s) URL replies are sent to"],
		[
			"https://ana:secret@example.com/api/pages/plan/replies",
			"replyTo must not carry a user name or password",
		],
	]) {
		const { result } = await packMdx(dir, "bad", PAGE(`\nreplyTo: ${value}`));
		expect(result.code).toBe(1);
		expect(result.stderr).toContain(String(message));
	}
});

test("two tabs of one page sending the same reply store it once", async () => {
	await withPage(async (cdp) => {
		await load(cdp, `${origin}/pages/plan`);
		await $(cdp, `document.getElementById("pick-b").click()`);
		// A frame of the same page is another tab as far as storage goes: its own scripts, the same localStorage.
		await $(
			cdp,
			`new Promise((done) => { const f = document.body.appendChild(document.createElement("iframe")); f.id = "tab"; f.onload = () => setTimeout(done, 300); f.src = "/pages/plan"; })`,
		);
		const tab = `document.getElementById("tab").contentDocument`;
		expect(await $(cdp, `${tab}.getElementById("pick-b").checked`)).toBe(true);
		await $(cdp, `${tab}.querySelector(".reply-bar .primary").click()`);
		await $(cdp, `${tab}.querySelector(".reply-dialog .reply-send").click()`);
		expect(
			await until(
				cdp,
				`${tab}.querySelector(".reply-dialog footer [role=status]").textContent === "Sent."`,
			),
		).toBe(true);
		await openReply(cdp, false);
		await send(cdp);
		expect(await until(cdp, `${statusText} === "Sent."`)).toBe(true);
		expect(bodies).toHaveLength(2);
		expect(stored).toHaveLength(1);
	});
}, 30_000);

test("the browser keeps a salt, never the reply: after Clear none of it is left", async () => {
	await withPage(async (cdp) => {
		await load(cdp, `${origin}/pages/plan`);
		await openReply(cdp);
		await send(cdp);
		expect(await until(cdp, `${statusText} === "Sent."`)).toBe(true);
		await $(cdp, `document.querySelector(".reply-dialog").close()`);
		const clear = `document.querySelector(".reply-bar .btn:not(.primary)")`;
		await $(cdp, `(${clear}.click(), ${clear}.click())`);
		expect(await until(cdp, `!document.getElementById("pick-b").checked`)).toBe(true);
		const kept = String(await $(cdp, "JSON.stringify({ ...localStorage })"));
		expect(kept).not.toContain("Which one");
		expect(Object.keys(JSON.parse(kept))).toEqual(["explainer-reply-salt"]);
	});
}, 30_000);

test("a reply's id is the same reply's on every load, and stays fixed for the page's life when storage refuses to keep a salt", async () => {
	await withPage(async (cdp) => {
		await load(cdp, `${origin}/pages/plan`);
		await $(cdp, `document.getElementById("pick-b").click()`);
		const id = () => $(cdp, "JSON.parse(ReplyNotes.body()).id");
		const first = String(await id());
		expect(first).toMatch(/^[0-9a-f]{32}$/);
		// 128 bits: no one of the four words follows from the other three.
		const [w0, w1, w2, w3] = (first.match(/.{8}/g) ?? []).map((w) => Number.parseInt(w, 16));
		expect((w0 ?? 0) >>> 0).not.toBe(((w1 ?? 0) ^ (w2 ?? 0) ^ (w3 ?? 0)) >>> 0);
		expect((w1 ?? 0) >>> 0).not.toBe(((w0 ?? 0) ^ (w2 ?? 0) ^ (w3 ?? 0)) >>> 0);
		await load(cdp);
		expect(await id()).toBe(first);
		await $(cdp, `document.getElementById("pick-a").click()`);
		expect(await id()).not.toBe(first);
		// Without storage: a salt for this page's life.
		await $(
			cdp,
			`(localStorage.removeItem("explainer-reply-salt"), Storage.prototype.setItem = () => { throw new Error("full"); })`,
		);
		const unsaved = await id();
		expect(await id()).toBe(unsaved);
	});
}, 30_000);

test("a long reason and long button labels wrap in the dialog's footer and leave Copy and Send in view, on a phone and a desktop", async () => {
	await withPage(async (cdp) => {
		refused = true;
		error = "x".repeat(200);
		for (const [width, page] of [
			[390, "plan"],
			[1440, "plan"],
			[390, "long"],
			[1440, "long"],
		] as const) {
			await cdp.send("Emulation.setDeviceMetricsOverride", {
				width,
				height: 844,
				deviceScaleFactor: 1,
				mobile: width < 600,
			});
			await load(cdp, `${origin}/pages/${page}`);
			await openReply(cdp);
			await send(cdp);
			expect(await until(cdp, `${statusText}.includes(": 400 xxx")`)).toBe(true);
			const inside = await $(
				cdp,
				`(() => {
					const box = document.querySelector(".reply-dialog").getBoundingClientRect();
					return [".reply-copy", ".reply-send", "footer [role=status]"].map((s) => {
						const r = document.querySelector(".reply-dialog " + s).getBoundingClientRect();
						return s + ":" + (r.left >= box.left && r.right <= box.right && r.bottom <= box.bottom && r.width > 0);
					});
				})()`,
			);
			expect(inside).toEqual([".reply-copy:true", ".reply-send:true", "footer [role=status]:true"]);
		}
	});
}, 30_000);
