import { afterAll } from "bun:test";
import { closeTestBrowser } from "./browser.ts";

// A preload, so it runs once after all test files. Disposed isolated contexts can leave Chrome needing the fallback stop:
// 3 s for pipe closure, 5 s for SIGTERM, then up to two 1 s group graces. Allow those plus cleanup/scheduling, not an unbounded wait.
afterAll(closeTestBrowser, 15_000);
