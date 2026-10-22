import { afterAll, expect, test } from "bun:test";
import { runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1">';
const page = (script: string) =>
	`<!doctype html><html><head>${VIEWPORT}</head><body><h1>Probe</h1><script>${script}</script></body></html>`;
const checkQuick = (file: string) =>
	runCli(["check", file, "--quick", "--view", "none", "--out", dir.path("shots")]);

test("check reports a page error as a problem and exits 1", async () => {
	const file = dir.write("throws.html", page('throw new Error("boom from the page");'));

	const result = await checkQuick(file);

	expect(result.code).toBe(1);
	expect(result.stdout).toContain("FAIL");
	expect(result.stdout).toContain("page error: Error: boom from the page");
}, 30_000);

test("check exits 0 for a page without problems", async () => {
	const file = dir.write("clean.html", page("document.title = 'ok';"));

	const result = await checkQuick(file);

	expect(result.code).toBe(0);
	expect(result.stdout).not.toContain("FAIL");
}, 30_000);
