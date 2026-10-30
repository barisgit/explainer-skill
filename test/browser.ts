import type { Cdp } from "../skills/explainer/src/cdp.ts";
import { type Browser, openBrowser } from "../skills/explainer/src/chrome.ts";

/** The test run's one Chrome, started by the first test that needs a page. */
let shared: Promise<Browser> | undefined;

/**
 * Runs `fn` against a new page of the test run's shared Chrome, in a browser context of its own: tests share no cookies, storage
 * or tabs, and a run starts Chrome once where a Chrome per page cost about 0.5 s each. Tests of Chrome's own start-up and
 * shutdown (chrome.test.ts) call withPage instead.
 */
export async function withTestPage<T>(fn: (cdp: Cdp) => Promise<T>): Promise<T> {
	shared ??= openBrowser();
	return (await shared).isolatedPage(fn);
}

/** Stops the shared Chrome, if a test started it; the preload (suite-hooks.ts) calls it after the last test. */
export async function closeTestBrowser(): Promise<void> {
	await (await shared)?.close();
	shared = undefined;
}
