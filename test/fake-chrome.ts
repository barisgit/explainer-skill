/**
 * A stand-in for Chrome that the tests start through CHROME (see fakeChrome in chrome.test.ts), for the orderings a real Chrome
 * shows only by chance. It speaks just enough of the debugging pipe for withPage: it answers every call with an empty result
 * (`Target.createBrowserContext`, `Target.createTarget` and `Target.attachToTarget` with ids), or none at all when FAKE_CHROME is "silent", as a Chrome that hangs
 * while it starts. It writes `started` into its profile once running, and when told to stop (SIGTERM, or the pipe closing) it waits
 * EXIT_WRITE_MS and then writes `written-at-exit` into the profile, as a real Chrome flushes its profile while it shuts down. As
 * Chrome does, it leaves a directory behind in its temp directory (a singleton socket's, a URL fetcher's), which it takes from
 * TMPDIR on Linux and from MAC_CHROMIUM_TMPDIR on macOS, where Chrome otherwise ignores TMPDIR for the system's temp directory;
 * the stand-in refuses to start there without it, since the tests could not see what it left. As Chrome on Linux does, it aborts
 * when its singleton socket's path in that directory would pass the 107 characters a Unix socket may have. And as Chrome's helper processes
 * can, a helper it starts outlives it: it writes `written-by-helper` into the profile EXIT_WRITE_MS after the stand-in has exited.
 * When FAKE_CHROME_STOPS names a file, it appends what first told it to stop there (`pipe` or `SIGTERM`), which the profile's
 * deletion would otherwise take with it; and FAKE_CHROME "deaf" makes it ignore the pipe closing, as a Chrome that hangs.
 */
import { spawn } from "node:child_process";
import {
	appendFileSync,
	createReadStream,
	createWriteStream,
	mkdirSync,
	mkdtempSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

/** How long the stand-in takes to shut down: long enough that a profile deleted before it exits is written again. */
const EXIT_WRITE_MS = 300;

const profile = process.argv.find((arg) => arg.startsWith("--user-data-dir="))?.split("=")[1];
if (!profile) {
	throw new Error("fake Chrome needs --user-data-dir");
}
const { FAKE_CHROME, FAKE_CHROME_STOPS, TMPDIR, MAC_CHROMIUM_TMPDIR } = process.env;
const temp = process.platform === "darwin" ? MAC_CHROMIUM_TMPDIR : TMPDIR;
if (!temp) {
	throw new Error(
		"fake Chrome: no temp directory of its own, so Chrome would write into the system's",
	);
}
if (
	process.platform === "linux" &&
	join(temp, "org.chromium.Chromium.XXXXXX", "SingletonSocket").length > 107
) {
	process.stderr.write(`FATAL:process_singleton_posix.cc(313)] Socket path too long: ${temp}\n`);
	// Chrome aborts here; an exit does as well for check, which reads only the log (a SIGABRT to itself left Bun 1.4.3 hanging).
	process.exit(134);
}
writeFileSync(join(mkdtempSync(join(temp, "org.chromium.Chromium.")), "SingletonSocket"), "");
spawn(
	"sh",
	[
		"-c",
		'while kill -0 "$0" 2>/dev/null; do sleep 0.05; done; sleep "$2"; mkdir -p "$1" && : > "$1/written-by-helper"',
		String(process.pid),
		profile,
		String(EXIT_WRITE_MS / 1000),
	],
	{ stdio: "ignore" },
).unref();

const commands = createReadStream("", { fd: 3 });
const replies = createWriteStream("", { fd: 4 });

let stopping = false;
function stop(cause: string) {
	if (stopping) {
		return;
	}
	stopping = true;
	if (FAKE_CHROME_STOPS) {
		appendFileSync(FAKE_CHROME_STOPS, cause);
	}
	setTimeout(() => {
		// As Chrome does, it recreates the profile when it is gone.
		mkdirSync(profile as string, { recursive: true });
		writeFileSync(join(profile as string, "written-at-exit"), "");
		process.exit(0);
	}, EXIT_WRITE_MS);
}
process.on("SIGTERM", () => stop("SIGTERM"));
if (FAKE_CHROME !== "deaf") {
	commands.on("end", () => stop("pipe")).on("close", () => stop("pipe"));
} else {
	// Nothing else holds the process once the pipe is closed.
	setInterval(() => undefined, 60_000);
}
// Written only once SIGTERM is handled: a test that signals the stand-in as soon as it sees `started` must find it shutting down
// as Chrome does, not killed by the default action.
writeFileSync(join(profile, "started"), "");

const silent = FAKE_CHROME === "silent";
const RESULTS: Record<string, object> = {
	"Target.createBrowserContext": { browserContextId: "context" },
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
