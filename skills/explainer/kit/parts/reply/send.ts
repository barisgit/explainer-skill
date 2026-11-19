/* reply send: the request body and the dialog's Send, the half of kit:reply.js that posts to a reply server. Not referenced from
   pages: pack joins it in front of reply.js, which calls it once with
     kitText(key)       reply.js's text for a key
     h                  reply.js's element helper
     reply()            the reply as the envelope carries it: { markdown, notes, answers }
   It returns body(), the JSON text Send would post now, made by the one builder Send posts with (check --do reply validates it),
   and controls(status), the dialog's name field and Send button, null when the page has no endpoint. The endpoint is the
   content of <meta name="explainer-reply-to">, which pack writes (the frontmatter replyTo, or empty) and serve fills when it
   serves the page; the page itself never knows its id or version.
   Send clears nothing: the answers and notes stay on the page. It says "Sent." only for the server's receipt, a 200 or 201 JSON
   answer naming the id posted; a refusal (4xx) is "Send failed", anything else (no answer, a 5xx, a redirect, a page) "Could
   not confirm delivery", since the reply may have been stored. The envelope id is a hash of this browser's salt and the reply:
   the same reply, sent again after a failure, after it was stored, after a reload or from another tab, has the same id, which
   the server stores once, and a changed reply has another, with nothing to remember but the salt (localStorage
   explainer-reply-salt, random, made once; never the reply). Two readers' equal replies differ by their salts. The reader's
   name is remembered too (localStorage explainer-reader). */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the function only scopes the part's names away from the page; the code in it is split into small functions
window.ReplySend = ({ kitText, h, reply }) => {
	const meta = document.querySelector<HTMLMetaElement>('meta[name="explainer-reply-to"]');
	const endpoint = meta?.content ? new URL(meta.content, location.href).href : null;
	const READER_KEY = "explainer-reader";
	/** The protocol's longest reader name. */
	const READER_MAX = 200;

	/** 32 random hex digits; crypto.getRandomValues, unlike randomUUID, works on a page served over plain http. */
	const newId = () =>
		[...crypto.getRandomValues(new Uint8Array(16))]
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");

	/**
	 * A 128-bit hash of `text` as 32 hex digits (cyrb128: four 32-bit lanes, mixed so no one word follows from the others), the
	 * shape of an id. Not a cryptographic hash, and not crypto.subtle, which a page served over plain http to another machine
	 * does not have; it only has to tell replies apart.
	 */
	function hash(text: string): string {
		let [a, b, c, d] = [1779033703, 3144134277, 1013904242, 2773480762];
		for (let i = 0; i < text.length; i++) {
			const k = text.charCodeAt(i);
			a = b ^ Math.imul(a ^ k, 597399067);
			b = c ^ Math.imul(b ^ k, 2869860233);
			c = d ^ Math.imul(c ^ k, 951274213);
			d = a ^ Math.imul(d ^ k, 2716044179);
		}
		a = Math.imul(c ^ (a >>> 18), 597399067);
		b = Math.imul(d ^ (b >>> 22), 2869860233);
		c = Math.imul(a ^ (c >>> 17), 951274213);
		d = Math.imul(b ^ (d >>> 19), 2716044179);
		a ^= b ^ c ^ d;
		b ^= a;
		c ^= a;
		d ^= a;
		return [a, b, c, d].map((n) => (n >>> 0).toString(16).padStart(8, "0")).join("");
	}

	const SALT_KEY = "explainer-reply-salt";
	/** This browser's salt when storage cannot keep one: the ids then last until the page closes. */
	let unsaved = "";
	/**
	 * This browser's salt, made once and kept in localStorage, read each time so every tab of every page uses the one there.
	 * Known limit, accepted: two tabs that both send at the very first instant, before either has kept a salt, each make one;
	 * the last kept wins, so the other tab's first reply has another id and a re-send of it can be stored twice. That is at most
	 * one duplicate per browser, once; making the first salt atomic on plain http would need a coordination layer not worth it.
	 */
	function salt(): string {
		try {
			const kept = localStorage.getItem(SALT_KEY);
			if (kept && /^[0-9a-f]{32}$/.test(kept)) {
				return kept;
			}
			localStorage.setItem(SALT_KEY, unsaved || newId());
			return localStorage.getItem(SALT_KEY) ?? "";
		} catch {
			unsaved ||= newId();
			return unsaved;
		}
	}

	function storedReader() {
		try {
			return (localStorage.getItem(READER_KEY) ?? "").slice(0, READER_MAX);
		} catch {
			return "";
		}
	}
	let reader = storedReader();
	function remember(name: string) {
		reader = name;
		try {
			localStorage.setItem(READER_KEY, name);
		} catch {
			// Without storage the name lasts until the page closes.
		}
	}

	/**
	 * What Send posts for the reply as it is now: the request body and its id, a hash of this browser's salt and the reply, so
	 * the same reply always has the same id and nothing needs remembering. The one builder of the body, so check --do reply
	 * validates what Send posts.
	 */
	function wire(): { body: string; id: string; content: string } {
		const name = reader.trim();
		const content = JSON.stringify({ ...(name ? { reader: name } : {}), reply: reply() });
		const id = hash(`${salt()}\n${content}`);
		const envelope: ReplyEnvelope = { v: 1, id, ...JSON.parse(content) };
		return { body: JSON.stringify(envelope), id, content };
	}

	/** The status and the server's error (or text), short. */
	async function reason(response: Response) {
		const text = (await response.text().catch(() => "")).trim();
		let error = text;
		try {
			error = String(JSON.parse(text).error ?? text);
		} catch {
			// Not JSON: the text as it is.
		}
		return `${response.status} ${error.slice(0, 200)}`.trim();
	}

	/** Whether `response` is the server's receipt for `id`: 200 (kept before) or 201, JSON naming that id. */
	async function receipt(response: Response, id: string) {
		if (response.status !== 200 && response.status !== 201) {
			return false;
		}
		if (!response.headers.get("content-type")?.includes("application/json")) {
			return false;
		}
		try {
			return (await response.clone().json())?.id === id;
		} catch {
			return false;
		}
	}

	/** How long one Send waits for the server's whole response, body included, before saying delivery is unconfirmed. */
	const SEND_DEADLINE = 15_000;

	/** Posts the reply as it is now, within the send's deadline; the message saying whether it was stored. */
	async function post(url: string): Promise<string> {
		const deadline = new AbortController();
		const timer = setTimeout(() => deadline.abort(), SEND_DEADLINE);
		try {
			return await answer(url, deadline.signal);
		} finally {
			clearTimeout(timer);
		}
	}

	/** The message for one post of the reply; an abort of `signal` ends a read in progress as a lost answer. */
	async function answer(url: string, signal: AbortSignal): Promise<string> {
		const { body, id, content } = wire();
		let response: Response;
		try {
			// A redirect is no receipt: not followed, so its target never gets the reply.
			response = await fetch(url, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body,
				redirect: "manual",
				signal,
			});
		} catch {
			return kitText("unconfirmed").replace("{reason}", kitText("unreachable"));
		}
		if (await receipt(response, id)) {
			return kitText(wire().content === content ? "sent" : "sentChanged");
		}
		if (response.status >= 400 && response.status < 500) {
			return kitText("sendFailed").replace("{reason}", await reason(response));
		}
		const why = response.status >= 500 ? await reason(response) : kitText("noReceipt");
		return kitText("unconfirmed").replace("{reason}", why);
	}

	/** One send at a time, whichever dialog drawing started it; its outcome goes to the status line drawn last. */
	let busy = false;
	let shown: { status: HTMLElement; button: HTMLButtonElement } | null = null;
	async function send(url: string) {
		busy = true;
		const message = await post(url);
		busy = false;
		if (shown) {
			shown.button.disabled = false;
			shown.status.textContent = message;
		}
	}

	function controls(status: HTMLElement) {
		if (!endpoint) {
			return null;
		}
		const url = endpoint;
		const name = h("input", { type: "text", autocomplete: "name", maxlength: String(READER_MAX) });
		name.value = reader;
		name.addEventListener("input", () => remember(name.value));
		const button = h("button", { type: "button", class: "btn primary reply-send" });
		button.textContent = kitText("sendReply");
		button.disabled = busy;
		shown = { status, button };
		button.addEventListener("click", () => {
			if (busy) {
				return;
			}
			button.disabled = true;
			status.textContent = kitText("sending");
			void send(url);
		});
		return {
			reader: h(
				"label",
				{ class: "field reply-reader" },
				h("span", {}, kitText("readerName")),
				name,
			),
			button,
		};
	}

	return { body: () => wire().body, controls };
};
