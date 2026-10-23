import { afterAll, expect, test } from "bun:test";
import { packAndRun, pageContract, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const HEAD = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><main class="page">`;

test("closed folds print open", async () => {
	const page = `${HEAD}<h1>Print</h1>
<details><summary>Plain</summary><p id="plain">Plain fold</p></details>
<details><summary>Outer</summary><details><summary>Inner</summary><p id="deep">Deep fold</p></details></details></main>
<script>${pageContract({
		"a closed fold's text prints": `document.getElementById("plain").checkVisibility()`,
		"a fold inside a closed fold prints": `document.getElementById("deep").checkVisibility()`,
	})}</script></body></html>`;
	expect(await packAndRun(dir, "print", page, 1, "print")).toEqual([]);
}, 30_000);
