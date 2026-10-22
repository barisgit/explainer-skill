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

test("check names a first screen that is a list of in-page links, and keeps the hint for plain prose", async () => {
	const questions = `<ol>${[1, 2, 3].map((n) => `<li><a href="#q${n}">Question ${n}?</a></li>`).join("")}</ol>`;
	const withMap = dir.write("map.html", page("").replace("</h1>", `</h1>${questions}`));
	const prose = dir.write("prose.html", page("").replace("</h1>", "</h1><p>Only words here.</p>"));

	const [map, plain] = await Promise.all(
		[withMap, prose].map((file) =>
			runCli(["check", file, "--view", "none", "--out", dir.path("first")]),
		),
	);

	expect(map?.stdout).toContain("text map: 3 in-page links");
	expect(map?.stdout).not.toContain("no figure in view");
	expect(plain?.stdout).toContain("no figure in view");
}, 60_000);

test("check on a page that still has kit: references says to run pack first (exit 2)", async () => {
	const file = dir.write(
		"unpacked.html",
		`<!doctype html><html><head><link rel="stylesheet" href="kit:theme.css"></head><body><h1>Unpacked</h1></body></html>`,
	);

	const result = await runCli(["check", file, "--quick", "--out", dir.path("unpacked")]);

	expect(result.code).toBe(2);
	expect(result.stderr).toContain("kit:theme.css");
	expect(result.stderr).toContain("pack");
}, 30_000);
