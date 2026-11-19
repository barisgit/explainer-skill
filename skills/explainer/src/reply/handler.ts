/**
 * The reply server as one web-standard fetch handler over a storage interface: `serve` runs it with Bun.serve and file storage,
 * and a host can run the same handler on any runtime with Request and Response. Routes:
 *   GET     /pages/<id>              the page's current version, its endpoint meta naming its replies URL and that version
 *   POST    /api/pages/<id>/replies  a reply envelope (protocol.ts); `?version=N` is the version the page was served as
 *   OPTIONS /api/pages/<id>/replies  CORS preflight: any origin may post, a file:// page (Origin null) included
 * One URL per page id across versions keeps the page's origin and path, which kit keep's storage key is made of, so a reader's
 * unsent answers carry over when the page is republished.
 */
import {
	hasEndpointSlot,
	MAX_BODY,
	PAGE_ID,
	pagePath,
	parseEnvelope,
	repliesPath,
	type StoredReply,
	withEndpoint,
} from "./protocol.ts";

/** A page as published: its HTML, its version (from 1, one more per changed publish) and when that version was published. */
export interface PublishedPage {
	html: string;
	version: number;
	time: string;
}

/** Where the handler keeps pages and replies. */
export interface ReplyStorage {
	page(id: string): Promise<PublishedPage | undefined>;
	savePage(id: string, page: PublishedPage): Promise<void>;
	/**
	 * Keeps `reply` unless its page already has a reply with its id: then that one, with `created` false (first write wins). A
	 * reply it cannot keep (or will not take) throws; the handler answers 503 and the page says delivery could not be confirmed.
	 */
	addReply(reply: StoredReply): Promise<{ reply: StoredReply; created: boolean }>;
}

/**
 * Publishes `html` as page `id`: a new version only when it differs from the current one. Callers run one publish of an id at a
 * time. Throws, publishing nothing, for a page that cannot send (no endpoint slot: packed without reply.js or by an older kit).
 */
export async function publish(
	storage: ReplyStorage,
	id: string,
	html: string,
): Promise<{ version: number; changed: boolean }> {
	if (!hasEndpointSlot(html)) {
		throw new Error(UNSENDABLE);
	}
	const current = await storage.page(id);
	if (current?.html === html) {
		return { version: current.version, changed: false };
	}
	const version = (current?.version ?? 0) + 1;
	await storage.savePage(id, { html, version, time: new Date().toISOString() });
	return { version, changed: true };
}

const CORS = {
	"access-control-allow-origin": "*",
	"access-control-allow-methods": "POST, OPTIONS",
	"access-control-allow-headers": "content-type",
	"access-control-max-age": "600",
};

/** Why publish refuses a page. */
export const UNSENDABLE =
	"the page cannot send replies: pack it with the current kit from a page.mdx with a reply question (Question, data-reply) or reply: true in its frontmatter";

const json = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { ...CORS, "content-type": "application/json" },
	});
const refuse = (status: number, error: string) => json(status, { error });

/** The version a reply was posted with: none (null), or the positive whole number the endpoint carries, exactly. */
function versionOf(url: URL): number | null | undefined {
	const text = url.searchParams.get("version");
	if (text === null) {
		return null;
	}
	const version = Number(text);
	return /^[1-9]\d*$/.test(text) && Number.isSafeInteger(version) ? version : undefined;
}

/** The body as text, or undefined once it passes MAX_BODY: read in chunks, so a larger body is never held whole. */
async function bodyText(request: Request): Promise<string | undefined> {
	if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) {
		return undefined;
	}
	const chunks: Uint8Array[] = [];
	let size = 0;
	const reader = request.body?.getReader();
	for (let read = await reader?.read(); read && !read.done; read = await reader?.read()) {
		size += read.value.byteLength;
		if (size > MAX_BODY) {
			await reader?.cancel();
			return undefined;
		}
		chunks.push(read.value);
	}
	const body = new Uint8Array(size);
	let at = 0;
	for (const chunk of chunks) {
		body.set(chunk, at);
		at += chunk.byteLength;
	}
	return new TextDecoder().decode(body);
}

async function receive(
	storage: ReplyStorage,
	id: string,
	request: Request,
	onReply: (reply: StoredReply) => void,
): Promise<Response> {
	const version = versionOf(new URL(request.url));
	if (version === undefined) {
		return refuse(400, "version: expected a whole number from 1");
	}
	if (!(await storage.page(id))) {
		return refuse(404, `no page "${id}" is published here`);
	}
	const text = await bodyText(request);
	if (text === undefined) {
		return refuse(413, `body: expected at most ${MAX_BODY} bytes`);
	}
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		return refuse(400, "body: expected JSON");
	}
	const parsed = parseEnvelope(body);
	if (!parsed.ok) {
		return refuse(400, parsed.error);
	}
	const stamped = { ...parsed.envelope, page: id, version, time: new Date().toISOString() };
	let kept: Awaited<ReturnType<ReplyStorage["addReply"]>>;
	try {
		kept = await storage.addReply(stamped);
	} catch {
		return refuse(503, "the reply was not stored: send it again later");
	}
	const { reply, created } = kept;
	if (created) {
		onReply(reply);
	}
	return json(created ? 201 : 200, {
		id: reply.id,
		page: reply.page,
		version: reply.version,
		time: reply.time,
	});
}

async function servePage(storage: ReplyStorage, id: string): Promise<Response> {
	const page = await storage.page(id);
	if (!page) {
		return new Response(`No page "${id}" is published here.\n`, { status: 404 });
	}
	// publish takes only pages with the slot; a page a host saved itself without one is served as it is.
	const html = withEndpoint(page.html, `${repliesPath(id)}?version=${page.version}`) ?? page.html;
	return new Response(html, {
		headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
	});
}

const PAGE_ROUTE = new RegExp(`^${pagePath("([^/]+)")}$`);
const REPLIES_ROUTE = new RegExp(`^${repliesPath("([^/]+)")}$`);

/** The page id `route` reads from `pathname`, when it matches and the id is one. */
function routeId(route: RegExp, pathname: string): string | undefined {
	const id = route.exec(pathname)?.[1];
	return id !== undefined && PAGE_ID.test(id) ? id : undefined;
}

/** The fetch handler over `storage`; `onReply` hears each reply the first time it is stored. */
export function replyHandler(
	storage: ReplyStorage,
	{ onReply = () => {} }: { onReply?: (reply: StoredReply) => void } = {},
): (request: Request) => Promise<Response> {
	return async (request) => {
		const { pathname } = new URL(request.url);
		const page = routeId(PAGE_ROUTE, pathname);
		if (page) {
			return request.method === "GET" || request.method === "HEAD"
				? servePage(storage, page)
				: new Response("Method not allowed\n", { status: 405, headers: { allow: "GET" } });
		}
		const replies = routeId(REPLIES_ROUTE, pathname);
		if (!replies) {
			return new Response("Not found\n", { status: 404 });
		}
		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: CORS });
		}
		return request.method === "POST"
			? receive(storage, replies, request, onReply)
			: refuse(405, "replies are posted: POST a reply envelope");
	};
}
