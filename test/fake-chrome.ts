/**
 * A stand-in for Chrome that the tests start through CHROME (see fakeChrome in chrome.test.ts), for the orderings a real Chrome
 * shows only by chance. It speaks just enough of the debugging pipe for withPage: it answers every call with an empty result
 * (`Target.createTarget` and `Target.attachToTarget` with ids), or none at all when FAKE_CHROME is "silent", as a Chrome that hangs
 * while it starts. It writes `started` into its profile once running, and when told to stop (SIGTERM, or the pipe closing) it waits
 * EXIT_WRITE_MS and then writes `written-at-exit` into the profile, as a real Chrome flushes its profile while it shuts down.
 */
import { createReadStream, createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** How long the stand-in takes to shut down: long enough that a profile deleted before it exits is written again. */
const EXIT_WRITE_MS = 300;

const profile = process.argv.find((arg) => arg.startsWith("--user-data-dir="))?.split("=")[1];
if (!profile) {
	throw new Error("fake Chrome needs --user-data-dir");
}
writeFileSync(join(profile, "started"), "");

const commands = createReadStream("", { fd: 3 });
const replies = createWriteStream("", { fd: 4 });

let stopping = false;
function stop() {
	if (stopping) {
		return;
	}
	stopping = true;
	setTimeout(() => {
		// As Chrome does, it recreates the profile when it is gone.
		mkdirSync(profile as string, { recursive: true });
		writeFileSync(join(profile as string, "written-at-exit"), "");
		process.exit(0);
	}, EXIT_WRITE_MS);
}
process.on("SIGTERM", stop);
commands.on("end", stop).on("close", stop);

const { FAKE_CHROME } = process.env;
const silent = FAKE_CHROME === "silent";
const RESULTS: Record<string, object> = {
	"Target.createTarget": { targetId: "page" },
	"Target.attachToTarget": { sessionId: "session" },
};
commands.setEncoding("utf8");
commands.on("data", (chunk: string) => {
	if (silent) {
		return;
	}
	for (const text of chunk.split("\0").filter(Boolean)) {
		const { id, method, sessionId } = JSON.parse(text) as {
			id: number;
			method: string;
			sessionId?: string;
		};
		replies.write(`${JSON.stringify({ id, sessionId, result: RESULTS[method] ?? {} })}\0`);
	}
});
