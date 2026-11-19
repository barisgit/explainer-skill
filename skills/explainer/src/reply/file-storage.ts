/**
 * The handler's storage as files, for `serve`: under the data directory, one folder per page id holding page.json (the current
 * version and its HTML) and each reply as <time>-<id>.md (its Markdown, what an agent reads) and <time>-<id>.json (the stored
 * reply). The calls are synchronous inside, so within the one process that serves, a reply id is checked and written at once.
 */
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { PublishedPage, ReplyStorage } from "./handler.ts";
import type { StoredReply } from "./protocol.ts";

/** The time part of a reply's file names: its ISO time with : and . written -, always 24 characters. */
const stamp = (time: string) => time.replace(/[:.]/g, "-");
const STAMP_LENGTH = 24;

/** The .md and .json files a reply is kept in. */
export function replyFiles(data: string, reply: StoredReply): { md: string; json: string } {
	const stem = join(data, reply.page, `${stamp(reply.time)}-${reply.id}`);
	return { md: `${stem}.md`, json: `${stem}.json` };
}

/** Writes `text` to `file` whole or not at all: a stopped write leaves a temporary file, never a half-written one. */
function writeWhole(file: string, text: string) {
	writeFileSync(`${file}.tmp`, text);
	renameSync(`${file}.tmp`, file);
}

/** File storage under `data`, created as it is first written. */
export function fileStorage(data: string): ReplyStorage {
	const folder = (id: string) => join(data, id);
	const pageFile = (id: string) => join(folder(id), "page.json");
	return {
		page: async (id) =>
			existsSync(pageFile(id))
				? (JSON.parse(readFileSync(pageFile(id), "utf8")) as PublishedPage)
				: undefined,
		savePage: async (id, page) => {
			mkdirSync(folder(id), { recursive: true });
			writeWhole(pageFile(id), JSON.stringify(page));
		},
		addReply: async (reply) => {
			mkdirSync(folder(reply.page), { recursive: true });
			const kept = readdirSync(folder(reply.page)).find(
				(f) => f.endsWith(".json") && f.slice(STAMP_LENGTH + 1, -".json".length) === reply.id,
			);
			if (kept) {
				const stored = JSON.parse(readFileSync(join(folder(reply.page), kept), "utf8"));
				return { reply: stored as StoredReply, created: false };
			}
			const { md, json } = replyFiles(data, reply);
			try {
				writeFileSync(md, reply.reply.markdown);
				// The .json last and whole: it is what marks the id as stored.
				writeWhole(json, `${JSON.stringify(reply, null, 2)}\n`);
			} catch (e) {
				// Nothing of a reply not stored stays behind, so a retry starts clean.
				for (const file of [md, `${json}.tmp`]) {
					try {
						rmSync(file, { force: true });
					} catch {
						// Removed already, or not removable: the retry writes over it or fails the same way.
					}
				}
				throw e;
			}
			return { reply, created: true };
		},
	};
}
