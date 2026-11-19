/**
 * `serve`: the reply handler on Bun.serve with file storage, for one packed page. It publishes the file (a new version only when
 * it changed), serves it at one URL across versions, republishes it whenever the file changes, and prints each reply on stdout as
 * it arrives; with `wait`, only the next one, then it stops. It serves its own page only, though the data directory may keep
 * others. What it says about itself goes to stderr.
 */
import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { hostname, networkInterfaces } from "node:os";
import { basename, dirname } from "node:path";
import { fileStorage, replyFiles } from "./file-storage.ts";
import { publish, type ReplyStorage, replyHandler } from "./handler.ts";
import { pagePath, repliesPath, type StoredReply } from "./protocol.ts";

export interface ServeOptions {
	id: string;
	/** The address to listen on; 127.0.0.1 keeps it to this machine. */
	host: string;
	port: number;
	data: string;
	wait: boolean;
}

/**
 * `text` safe for a terminal: control characters (escape sequences that could clear the screen or forge a reply's header) and
 * the Unicode line and paragraph separators (which some readers of the output break lines at) are written as \u codes, and so
 * are line breaks where `lines` is false. The kept .md and .json files stay as sent.
 */
function printable(text: string, lines: boolean): string {
	const control = (code: number) =>
		(code < 0x20 && !(lines && (code === 0x09 || code === 0x0a))) ||
		(code >= 0x7f && code <= 0x9f) ||
		code === 0x2028 ||
		code === 0x2029;
	return [...text]
		.map((c) => {
			const code = c.charCodeAt(0);
			return control(code) ? `\\u${code.toString(16).padStart(4, "0")}` : c;
		})
		.join("");
}

/**
 * The lines stdout gets for a reply: a header at the line start (who sent it on what, where its Markdown is kept), then the
 * Markdown with every line indented two spaces, so no line a reader writes can read as a header.
 */
function replyText(data: string, reply: StoredReply): string {
	const version = reply.version === null ? " (a copy: no version)" : ` version ${reply.version}`;
	const reader = reply.reader ? ` from ${printable(reply.reader, false)}` : "";
	const head = `reply ${reply.id} on ${reply.page}${version}${reader} at ${reply.time}: ${replyFiles(data, reply).md}`;
	const body = printable(reply.reply.markdown, true)
		.replace(/\n$/, "")
		.split("\n")
		.map((line) => (line ? `  ${line}` : ""))
		.join("\n");
	return `${head}\n\n${body}\n`;
}

/**
 * Publishes `file` as page `id`, one publication at a time, so a slow read never publishes over a newer one and two publishes
 * never take one version. Each call reads the file when its turn comes; a failed one is reported on stderr and leaves the
 * version served and the calls after it as they were.
 */
function publisher(file: string, storage: ReplyStorage, id: string) {
	let queue: Promise<unknown> = Promise.resolve();
	return (): Promise<{ version: number; changed: boolean }> => {
		const run = queue.then(async () => publish(storage, id, await readFile(file, "utf8")));
		queue = run.catch(() => {});
		return run;
	};
}

/**
 * Whether a watch event naming `changed` may be a change to the file named `name`: a platform may give no name (null), and then
 * any file may have changed; reading it again costs little, since publish skips unchanged HTML.
 */
export const watchedChange = (changed: string | null, name: string) =>
	changed === null || changed === name;

/** Calls `onChange` shortly after each change to `file` (an editor or pack may write it in several steps). */
function watchFile(file: string, onChange: () => void) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const name = basename(file);
	// The directory, not the file: an editor that saves by replacing the file would end a watch on the file itself.
	return watch(dirname(file), (_event, changed) => {
		if (watchedChange(changed, name)) {
			clearTimeout(timer);
			timer = setTimeout(onChange, 150);
		}
	});
}

/**
 * `storage` taking one new reply, for `serve --wait`: replies are admitted one at a time, each checked and committed before
 * the next is looked at. Once one is stored, a retry of it still gets its receipt (200), and any other reply is refused (the
 * handler answers 503), so it stays with its reader, who can send it again, rather than being stored and never printed. A
 * repeated id or a write that fails leaves the place free.
 */
export function oneReply(storage: ReplyStorage): ReplyStorage {
	let taken: string | undefined;
	let queue: Promise<unknown> = Promise.resolve();
	return {
		...storage,
		addReply: (reply) => {
			const admitted = queue.then(async () => {
				if (taken !== undefined && reply.id !== taken) {
					throw new Error("serve --wait has its reply");
				}
				const kept = await storage.addReply(reply);
				if (kept.created) {
					taken = reply.id;
				}
				return kept;
			});
			queue = admitted.catch(() => {});
			return admitted;
		},
	};
}

/** Whether `host` is an address for every interface (0.0.0.0, ::), which no reader can open. */
const anyAddress = (host: string) => host === "0.0.0.0" || host === "::" || host === "[::]";

/**
 * The origin a reader opens for a server listening on `host`: the host itself, or for an any-address this machine's first
 * network IPv4 address (the hostname when it has none).
 */
function readerOrigin(host: string, port: number): string {
	let name = host;
	if (anyAddress(host)) {
		const lan = Object.values(networkInterfaces())
			.flat()
			.find((a) => a && a.family === "IPv4" && !a.internal);
		name = lan?.address ?? hostname();
	}
	return `http://${name.includes(":") && !name.startsWith("[") ? `[${name}]` : name}:${port}`;
}

/** Serves `file` as page `id` until stopped (or, with `wait`, until the next reply); returns the exit code. */
export async function serve(
	file: string,
	{ id, host, port, data, wait }: ServeOptions,
): Promise<number> {
	const files = fileStorage(data);
	let next: (() => void) | undefined;
	const replied = new Promise<void>((resolve) => {
		next = resolve;
	});
	const handle = replyHandler(wait ? oneReply(files) : files, {
		onReply: (reply) => {
			console.log(replyText(data, reply));
			next?.();
		},
	});
	// This page's routes only, and only once it is published: other pages kept in the data directory stay unserved, and their
	// replies are not taken.
	const routes = new Set([pagePath(id), repliesPath(id)]);
	let ready = false;
	const fetch = (request: Request) =>
		ready && routes.has(new URL(request.url).pathname)
			? handle(request)
			: new Response("Not found\n", { status: 404 });
	// Listening before publishing: a serve that cannot listen (another serves this port) changes nothing that one serves.
	let server: ReturnType<typeof Bun.serve>;
	try {
		server = Bun.serve({ hostname: host, port, fetch });
	} catch (e) {
		console.error(
			`error: cannot listen on ${host} port ${port} (${e instanceof Error ? e.message : String(e)}); is another serve running? Pass --port, or a --host this machine has`,
		);
		return 1;
	}
	const republish = publisher(file, files, id);
	// Watching before the first read: a change between the two is published after it.
	const watcher = watchFile(file, () => {
		republish().then(
			({ version, changed }) => changed && console.error(`published ${id} version ${version}`),
			(e) =>
				console.error(
					`error: ${file} not published (${e instanceof Error ? e.message : String(e)}); still serving the last version`,
				),
		);
	});
	let version: number;
	try {
		({ version } = await republish());
	} catch (e) {
		watcher.close();
		await server.stop(true);
		console.error(`error: ${file}: ${e instanceof Error ? e.message : String(e)}`);
		return 2;
	}
	ready = true;
	const origin = readerOrigin(host, server.port ?? port);
	const local = host === "127.0.0.1" || host === "localhost" || host === "::1";
	console.error(
		[
			`serving ${id} version ${version} at ${origin}${pagePath(id)}`,
			...(local
				? []
				: [
						`listening on ${host}: anyone who reaches this address can read the page and post replies (no accounts), so keep it to a trusted network`,
					]),
			`replies are kept in ${data}/${id}; a copy opened elsewhere posts with replyTo: ${origin}${repliesPath(id)}`,
			wait
				? "waiting for the next reply"
				: "printing each reply as it arrives; the page republishes when the file changes; Ctrl-C stops",
		].join("\n"),
	);
	if (!wait) {
		await new Promise(() => {});
	}
	await replied;
	watcher.close();
	// Graceful: the request that delivered the reply still gets its response.
	await server.stop();
	return 0;
}
