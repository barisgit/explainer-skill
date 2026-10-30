import { afterAll } from "bun:test";
import { closeTestBrowser } from "./browser.ts";

// A preload, so it runs once after every test file: the shared Chrome then exits cleanly and its directory is deleted.
afterAll(closeTestBrowser);
