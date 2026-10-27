import { constants } from "node:os";

/**
 * The cleanups to run when a signal ends the process: Chromes to stop and the files only a finished run may leave. A cleanup stays
 * registered until its owner releases it, so a signal during the owner's own cleanup still waits for it.
 */
const pending = new Set<() => Promise<void>>();

/** The exit the first signal started: every pending cleanup, then the exit code the signal would have given. */
let exiting: Promise<never> | undefined;

/**
 * Runs every pending cleanup, then exits as the signal would have. A later signal changes nothing: GNU timeout signals its child and
 * then the child's process group, and a terminal's Ctrl-C can come twice, so the handler stays installed for the whole cleanup,
 * where a signal with no listener would kill the process with its cleanup half done.
 */
function exitOnSignal(signal: NodeJS.Signals) {
	exiting ??= Promise.allSettled([...pending].map((cleanup) => cleanup())).then(() =>
		process.exit(128 + (constants.signals[signal] ?? 0)),
	);
}

/**
 * The exit a signal has started, or undefined. A caller whose work failed because of the signal (Chrome got it too and closed the
 * connection) awaits it instead of reporting the failure, so the process ends as the signal says once the cleanups are done.
 */
export const signalExit = (): Promise<never> | undefined => exiting;

let hooked = false;

/**
 * Registers `cleanup` to run, and be awaited, before the process exits on SIGINT, SIGTERM or SIGHUP; returns the release that
 * unregisters it. The signal handlers are installed on first use. A cleanup may run twice (by its owner and by a signal), so the
 * owner makes it idempotent, for example by sharing one promise.
 */
export function cleanUpOnSignal(cleanup: () => Promise<void>): () => void {
	if (!hooked) {
		hooked = true;
		for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
			process.on(signal, exitOnSignal);
		}
	}
	pending.add(cleanup);
	return () => {
		pending.delete(cleanup);
	};
}
