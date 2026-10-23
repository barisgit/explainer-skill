import { afterAll, expect, test } from "bun:test";
import { packAndRun, pageContract, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const KIT = '<link rel="stylesheet" href="kit:theme.css">';

test("a plain page rule overrides the kit, whatever its specificity or place, and the kit's fonts and media rules still apply", async () => {
	// The page's style comes before the kit's: an element selector against the kit's .page, and an equal selector earlier in order.
	const page = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>main { padding-block: 7px; } h1 em { color: rgb(1, 2, 3); }</style>${KIT}</head>
<body><main class="page"><h1>Plain <em id="em">rule</em></h1></main><script>${pageContract({
		"an element rule beats the kit's class rule": `getComputedStyle(document.querySelector("main")).paddingTop === "7px"`,
		"an earlier rule of equal specificity beats the kit's": `getComputedStyle(document.getElementById("em")).color === "rgb(1, 2, 3)"`,
		"the kit's @font-face loads": `[...document.fonts].some((f) => f.family.includes("Geist") && f.status === "loaded")`,
		"the kit's @media rules apply": `getComputedStyle(document.getElementById("em")).whiteSpace === (innerWidth >= 640 ? "nowrap" : "normal")`,
	})}</script></body></html>`;

	expect(await packAndRun(dir, "layer", page)).toEqual([]);
});
