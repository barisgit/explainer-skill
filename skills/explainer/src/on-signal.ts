import { constants } from "node:os";

/**
 * The cleanups to run when a signal ends the process: Chromes to stop and the files only a finished run may leave. A cleanup stays
 * registered until its owner releases it, so a signal during the owner's own cleanup still waits for it.
 */
const pending = new Set<() => Promise<void>>();

/** Runs every pending cleanup, then exits as the signal would have. */
function exitOnSignal(signal: NodeJS.Signals) {
	void Promise.allSettled([...pending].map((cleanup) => cleanup())).finally(() =>
		process.exit(128 + (constants.signals[signal] ?? 0)),
	);
}

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
			process.once(signal, exitOnSignal);
		}
	}
	pending.add(cleanup);
	return () => {
		pending.delete(cleanup);
	};
}
