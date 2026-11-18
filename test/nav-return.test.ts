import { afterAll, expect, test } from "bun:test";
import { act, inPage, packHtml, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/** Shared navigation with a reused view whose handler can author its own Back destination. */
async function page() {
	const output = dir.path("nav-return.html");
	const input = dir.write(
		"nav-source.html",
		`<!doctype html><html><head><link rel="stylesheet" href="kit:theme.css"></head><body><main class="page" data-contents><div data-overview><h1>Plan</h1><section id="cost"><h2>Cost</h2><a href="#item/a">A</a><a href="#item/b">B</a></section></div><section class="view" data-view="item"><a class="back" href="#">Plan</a><h1>Item</h1></section></main><script src="kit:views.js"></script><script>Views.on("item", (el, param) => { if (param === "b") el.querySelector(".back").setAttribute("href", "#authored-section"); });</script></body></html>`,
	);
	expect((await packHtml(input, output)).error).toBe("");
	return output;
}

test("a handler's new explicit Back destination wins over the kit's previous return URL", async () => {
	await inPage(`${await page()}#cost`, async (cdp) => {
		await act(cdp, `location.hash = "item/a"`, "location.hash");
		expect(
			await cdp.evaluate(`document.querySelector(".view.active .back").getAttribute("href")`),
		).toBe("#cost");
		await act(cdp, `location.hash = "item/b"`, "location.hash");
		expect(
			await cdp.evaluate(`document.querySelector(".view.active .back").getAttribute("href")`),
		).toBe("#authored-section");
	});
});

test("the contents Overview link still leads to the top after following a section", async () => {
	await inPage(await page(), async (cdp) => {
		await act(cdp, `location.hash = "cost"`, "location.hash");
		expect(
			await cdp.evaluate(
				`document.querySelector(".toc > ol > li:first-child a").getAttribute("href")`,
			),
		).toBe("#");
	});
});
