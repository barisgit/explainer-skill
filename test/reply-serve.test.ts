import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, networkInterfaces } from "node:os";
import { basename, join } from "node:path";
import { fileStorage, replyFiles } from "../skills/explainer/src/reply/file-storage.ts";
import {
	type PublishedPage,
	publish,
	type ReplyStorage,
	replyHandler,
} from "../skills/explainer/src/reply/handler.ts";
import type { StoredReply } from "../skills/explainer/src/reply/protocol.ts";
import { oneReply, watchedChange } from "../skills/explainer/src/reply/serve.ts";
import { SKILL_DIR, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/** A page as pack writes one that can send: the endpoint slot among its head's leading meta elements. */
const PAGE = (text: string) =>
	`<!doctype html><html><head>\n<meta charset="utf-8">\n<meta name="explainer-reply-to" content="">\n<title>Report</title>\n</head><body><h1>${text}</h1></body></html>`;
/** A page that cannot send: packed without reply.js, or by a kit from before Send. */
const UNSENDABLE =
	'<!doctype html><html><head>\n<meta charset="utf-8">\n<title>Report</title>\n</head><body></body></html>';
const envelope = (id: string, markdown: string) => ({
	v: 1,
	id,
	reader: "Ana",
	reply: { markdown, notes: [], answers: [] },
});

/** Collects `stream` as text in the background: what came so far, and all of it once the stream ends. */
function collect(stream: ReadableStream<Uint8Array>) {
	let text = "";
	const done = (async () => {
		for await (const chunk of stream) {
			text += new TextDecoder().decode(chunk);
		}
	})();
	return {
		now: () => text,
		all: async () => {
			await done;
			return text;
		},
	};
}

/** A running `serve`: its URL once it says it serves, its stdout and stderr so far or once it exits. */
async function serve(args: string[]) {
	const proc = Bun.spawn([process.execPath, join(SKILL_DIR, "cli.ts"), "serve", ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const out = collect(proc.stdout);
	const err = collect(proc.stderr);
	await until(async () => /http:\/\/\S+\/pages\/\S+/.test(err.now()) || proc.exitCode !== null);
	const url = /(http:\/\/\S+)\/pages\/\S+/.exec(err.now())?.[1];
	if (!url) {
		throw new Error(`serve exited: ${await err.all()}`);
	}
	return {
		url,
		proc,
		stdout: out.now,
		/** All of stdout, once the process has closed it. */
		output: out.all,
		/** stderr: all of it once the process closed it, or with `whole` false what has come so far. */
		stderr: async (whole = true) => (whole ? err.all() : err.now()),
	};
}

const until = async (condition: () => boolean | Promise<boolean>) => {
	for (const end = Date.now() + 5000; Date.now() < end; await Bun.sleep(20)) {
		if (await condition()) {
			return;
		}
	}
	throw new Error("timed out");
};

test("a watch event without a file name may be the served file's change, so serve reads it again", () => {
	expect(watchedChange(null, "page.html")).toBe(true);
	expect(watchedChange("page.html", "page.html")).toBe(true);
	expect(watchedChange("other.html", "page.html")).toBe(false);
});

test("serve --wait prints the next reply, keeps it as .md and .json, and exits", async () => {
	const page = dir.write("wait/report.html", PAGE("one"));
	const data = dir.path("wait/data");
	const server = await serve([page, "--port", "0", "--data", data, "--wait"]);
	try {
		const html = await (await fetch(`${server.url}/pages/report`)).text();
		const endpoint = /name="explainer-reply-to" content="([^"]+)"/.exec(html)?.[1] ?? "";
		expect(endpoint).toBe("/api/pages/report/replies?version=1");
		const sent = await fetch(`${server.url}${endpoint}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(envelope("aaaaaaaaaaaaaaaa", "Reply on one\n")),
		});
		expect(sent.status).toBe(201);
		expect(await server.proc.exited).toBe(0);
	} finally {
		server.proc.kill();
		await server.proc.exited;
	}
	expect(await server.output()).toMatch(
		/^reply aaaaaaaaaaaaaaaa on report version 1 from Ana at \S+: .+\.md\n\n {2}Reply on one\n\n$/,
	);
	const files = readdirSync(join(data, "report")).sort();
	expect(files.filter((f) => f.includes("aaaaaaaaaaaaaaaa")).map((f) => f.slice(-5))).toEqual([
		".json",
		"aa.md",
	]);
	const md = files.find((f) => f.endsWith(".md")) ?? "";
	expect(readFileSync(join(data, "report", md), "utf8")).toBe("Reply on one\n");
	const json = JSON.parse(readFileSync(join(data, "report", md.replace(/\.md$/, ".json")), "utf8"));
	expect(json).toMatchObject({ page: "report", version: 1, reader: "Ana", id: "aaaaaaaaaaaaaaaa" });
});

test("serve follows: prints each reply as it arrives and republishes a changed file as the next version", async () => {
	const page = dir.write("follow/report.html", PAGE("one"));
	const data = dir.path("follow/data");
	const server = await serve([page, "--port", "0", "--data", data, "--id", "plan"]);
	try {
		const send = (id: string, version: number) =>
			fetch(`${server.url}/api/pages/plan/replies?version=${version}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(envelope(id, `Reply ${id}\n`)),
			});
		// An id that another one's ends with is its own reply.
		expect((await send("x-1111111111111111", 1)).status).toBe(201);
		expect((await send("1111111111111111", 1)).status).toBe(201);
		expect((await send("1111111111111111", 1)).status).toBe(200);
		// A file that cannot be published is reported and leaves the version served, and the next good one is published.
		writeFileSync(page, UNSENDABLE);
		await until(async () => (await server.stderr(false)).includes("not published"));
		expect(await (await fetch(`${server.url}/pages/plan`)).text()).toContain("version=1");
		writeFileSync(page, PAGE("two"));
		await until(async () =>
			(await (await fetch(`${server.url}/pages/plan`)).text()).includes("version=2"),
		);
		expect((await send("2222222222222222", 2)).status).toBe(201);
		await until(() => server.stdout().includes("Reply 2222"));
		const headers = server.stdout().match(/^reply .*/gm) ?? [];
		expect(headers.map((h) => h.split(" at ")[0])).toEqual([
			"reply x-1111111111111111 on plan version 1 from Ana",
			"reply 1111111111111111 on plan version 1 from Ana",
			"reply 2222222222222222 on plan version 2 from Ana",
		]);
		// What a reply says reaches the terminal without its control characters, so it cannot clear it or forge a header.
		await fetch(`${server.url}/api/pages/plan/replies`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				...envelope(
					"3333333333333333",
					"a\u001b[2Jb\nreply 4444444444444444 on plan version 9 at t: f.md\nc\u2028reply 5555555555555555 on plan\u2029d\n",
				),
				reader: "E\nreply forged\u2028x",
			}),
		});
		await until(() => server.stdout().includes("3333"));
		// The Unicode line and paragraph separators too, which some readers of the output break lines at.
		expect(server.stdout()).toContain("from E\\u000areply forged\\u2028x at");
		expect(server.stdout()).toContain("\n  c\\u2028reply 5555555555555555 on plan\\u2029d\n");
		// Every line of a reply is indented, so none reads as a header.
		expect(server.stdout()).toContain(
			"\n\n  a\\u001b[2Jb\n  reply 4444444444444444 on plan version 9 at t: f.md\n",
		);
		expect(server.stdout()).not.toMatch(/^reply 4444/m);
	} finally {
		server.proc.kill();
		await server.proc.exited;
	}
	expect(await server.stderr()).toContain("published plan version 2");
});

test("a restarted serve keeps the page's version unless the file changed", async () => {
	const page = dir.write("restart/report.html", PAGE("one"));
	const data = dir.path("restart/data");
	for (const expected of ["version 1", "version 1", "version 2"]) {
		if (expected === "version 2") {
			writeFileSync(page, PAGE("two"));
		}
		const server = await serve([page, "--port", "0", "--data", data]);
		server.proc.kill();
		await server.proc.exited;
		expect(await server.stderr()).toContain(`serving report ${expected} at`);
	}
});

test("serve listens on this machine only unless --host says otherwise, and then says it is open to the network", async () => {
	const page = dir.write("host/report.html", PAGE("one"));
	const data = dir.path("host/data");
	const local = await serve([page, "--port", "0", "--data", data]);
	local.proc.kill();
	await local.proc.exited;
	expect(local.url).toStartWith("http://127.0.0.1:");
	expect(await local.stderr()).not.toContain("trusted network");

	const open = await serve([page, "--port", "0", "--data", data, "--host", "0.0.0.0"]);
	try {
		// The printed URL is one a reader elsewhere can open: this machine's network address, never the any-address.
		const host = new URL(open.url).hostname;
		const lan = Object.values(networkInterfaces())
			.flat()
			.filter((a) => a && a.family === "IPv4" && !a.internal)
			.map((a) => a?.address);
		expect(lan.length ? lan : [hostname()]).toContain(host);
		const response = await fetch(`${open.url}/pages/report`);
		expect(response.status).toBe(200);
		expect(await response.text()).toContain("/api/pages/report/replies?version=1");
	} finally {
		open.proc.kill();
		await open.proc.exited;
	}
	expect(await open.stderr()).toContain(
		"anyone who reaches this address can read the page and post replies (no accounts), so keep it to a trusted network",
	);

	// An address this machine does not have cannot be listened on: exit 1, saying so.
	const proc = Bun.spawn(
		[
			process.execPath,
			join(SKILL_DIR, "cli.ts"),
			"serve",
			page,
			"--port",
			"0",
			"--data",
			data,
			"--host",
			"203.0.113.1",
		],
		{ stdout: "pipe", stderr: "pipe" },
	);
	expect(await proc.exited).toBe(1);
	expect(await new Response(proc.stderr).text()).toContain(
		"error: cannot listen on 203.0.113.1 port 0",
	);
});

test("serve serves its own page only: other pages kept in the data directory are not served and their replies not taken", async () => {
	const page = dir.write("own/report.html", PAGE("one"));
	const data = dir.path("own/data");
	const other = await serve([page, "--port", "0", "--data", data, "--id", "other"]);
	other.proc.kill();
	await other.proc.exited;
	const server = await serve([page, "--port", "0", "--data", data, "--id", "plan", "--wait"]);
	try {
		expect((await fetch(`${server.url}/pages/other`)).status).toBe(404);
		const elsewhere = await fetch(`${server.url}/api/pages/other/replies`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(envelope("5555555555555555", "To another page\n")),
		});
		expect(elsewhere.status).toBe(404);
		await Bun.sleep(100);
		expect(server.proc.exitCode).toBeNull();
		expect(readdirSync(join(data, "other"))).toEqual(["page.json"]);
		const own = await fetch(`${server.url}/api/pages/plan/replies`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(envelope("6666666666666666", "To this page\n")),
		});
		expect(own.status).toBe(201);
		expect(await server.proc.exited).toBe(0);
	} finally {
		server.proc.kill();
		await server.proc.exited;
	}
	expect(await server.output()).not.toContain("To another page");
});

test("serve --wait takes one reply: a second one in flight is refused, not stored unprinted", async () => {
	const page = dir.write("race/report.html", PAGE("one"));
	const data = dir.path("race/data");
	const server = await serve([page, "--port", "0", "--data", data, "--wait"]);
	let statuses: (number | string)[];
	try {
		const send = (id: string) =>
			fetch(`${server.url}/api/pages/report/replies`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(envelope(id, `Reply ${id}\n`)),
			}).then(
				(r) => r.status,
				() => "closed",
			);
		statuses = await Promise.all([send("7777777777777777"), send("8888888888888888")]);
		expect(await server.proc.exited).toBe(0);
	} finally {
		server.proc.kill();
		await server.proc.exited;
	}
	// One is stored and printed; the other is refused (503) or finds serve stopped, and stays with its reader to send again.
	expect(statuses.filter((s) => s === 201)).toHaveLength(1);
	expect(statuses.filter((s) => s !== 201).every((s) => s === 503 || s === "closed")).toBe(true);
	expect((await server.output()).match(/^reply /gm)).toHaveLength(1);
	expect(readdirSync(join(data, "report")).filter((f) => f.endsWith(".md"))).toHaveLength(1);
});

test("serve refuses a page that cannot send, saying how to pack one that can", async () => {
	const page = dir.write("unsendable/report.html", UNSENDABLE);
	const proc = Bun.spawn(
		[process.execPath, join(SKILL_DIR, "cli.ts"), "serve", page, "--port", "0"],
		{
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	expect(await proc.exited).toBe(2);
	expect(await new Response(proc.stderr).text()).toBe(
		`error: ${page}: the page cannot send replies: pack it with the current kit from a page.mdx with a reply question (Question, data-reply) or reply: true in its frontmatter. Then: pack page.mdx -o report.html\n`,
	);
});

test("a reply file storage could not keep leaves nothing behind, and a retry stores it", async () => {
	const data = dir.path("storage");
	const storage = fileStorage(data);
	const reply: StoredReply = {
		...envelope("9999999999999999", "Kept once\n"),
		v: 1,
		page: "plan",
		version: 1,
		time: "2026-11-20T10:00:00.000Z",
	};
	const { md, json } = replyFiles(data, reply);
	// A directory where the .json is written first makes the write fail.
	mkdirSync(`${json}.tmp`, { recursive: true });
	await expect(storage.addReply(reply)).rejects.toThrow();
	expect(existsSync(md)).toBe(false);
	expect(existsSync(json)).toBe(false);
	rmSync(`${json}.tmp`, { recursive: true });
	expect(await storage.addReply(reply)).toEqual({ reply, created: true });
	expect(readdirSync(join(data, "plan")).sort()).toEqual([basename(json), basename(md)].sort());
});

test("serve --wait admits one reply at a time: of two in flight only the first is stored; a repeat or a failed write leaves the place", async () => {
	// Storage whose writes wait until the test finishes them, or fails them.
	const pages = new Map<string, PublishedPage>();
	const kept = ["aaaaaaaaaaaaaaaa"];
	const writes: { id: string; finish: (fail?: boolean) => void }[] = [];
	const controlled: ReplyStorage = {
		page: async (id) => pages.get(id),
		savePage: async (id, page) => void pages.set(id, page),
		addReply: (reply) =>
			new Promise((resolve, reject) => {
				writes.push({
					id: reply.id,
					finish: (fail) => {
						if (fail) {
							reject(new Error("disk full"));
							return;
						}
						const created = !kept.includes(reply.id);
						if (created) {
							kept.push(reply.id);
						}
						resolve({ reply, created });
					},
				});
			}),
	};
	await publish(controlled, "plan", PAGE("one"));
	const handle = replyHandler(oneReply(controlled));
	const post = (id: string) =>
		handle(
			new Request("http://127.0.0.1/api/pages/plan/replies", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(envelope(id, `Reply ${id}\n`)),
			}),
		).then((r) => r.status);
	/** Lets every request that can go on reach its next wait. */
	const settled = () => Bun.sleep(20);
	// A write that fails leaves the place free; so does a repeated id.
	const failed = post("ffffffffffffffff");
	const repeated = post("aaaaaaaaaaaaaaaa");
	await settled();
	expect(writes.map((w) => w.id)).toEqual(["ffffffffffffffff"]);
	writes[0]?.finish(true);
	expect(await failed).toBe(503);
	await settled();
	writes[1]?.finish();
	expect(await repeated).toBe(200);
	// Two new replies in flight: the second is not written until the first is committed, and then it is refused.
	const first = post("1111111111111111");
	const second = post("2222222222222222");
	await settled();
	expect(writes.map((w) => w.id).slice(2)).toEqual(["1111111111111111"]);
	writes[2]?.finish();
	// A retry of the stored reply queued behind it gets its receipt; a new reply queued with it does not get in.
	const retry = post("1111111111111111");
	await settled();
	writes[2]?.finish();
	expect(await Promise.all([first, second])).toEqual([201, 503]);
	await settled();
	expect(writes.map((w) => w.id).slice(3)).toEqual(["1111111111111111"]);
	writes[3]?.finish();
	expect(await retry).toBe(200);
	expect(await post("3333333333333333")).toBe(503);
	expect(writes).toHaveLength(4);
	expect(kept).toEqual(["aaaaaaaaaaaaaaaa", "1111111111111111"]);
});

test("a serve that cannot listen leaves the page another serve publishes as it was", async () => {
	const page = dir.write("busy/report.html", PAGE("one"));
	const data = dir.path("busy/data");
	const server = await serve([page, "--port", "0", "--data", data]);
	try {
		const port = new URL(server.url).port;
		const changed = dir.write("busy/changed/report.html", PAGE("two"));
		const proc = Bun.spawn(
			[
				process.execPath,
				join(SKILL_DIR, "cli.ts"),
				"serve",
				changed,
				"--port",
				port,
				"--data",
				data,
			],
			{ stdout: "pipe", stderr: "pipe" },
		);
		expect(await proc.exited).toBe(1);
		const html = await (await fetch(`${server.url}/pages/report`)).text();
		expect(html).toContain("version=1");
		expect(html).toContain("<h1>one</h1>");
		expect(JSON.parse(readFileSync(join(data, "report", "page.json"), "utf8")).version).toBe(1);
	} finally {
		server.proc.kill();
		await server.proc.exited;
	}
});
