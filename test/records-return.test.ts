import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";
import { act, inPage, load, runCli, scratch, until } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

test("the list breadcrumb keeps Records state through siblings, reload and browser history", async () => {
	const output = dir.path("records.html");
	expect(
		(await runCli(["pack", join(import.meta.dir, "fixtures/records/page.mdx"), "-o", output])).code,
	).toBe(0);
	for (const query of [
		"view=table&sort=-labour&f.owner=JV",
		"view=table&sort=-labour&q=board&f.owner=JV",
	]) {
		const hash = `#plan?${query}`;
		await inPage(`${output}${hash}`, async (cdp) => {
			const state = `({ hash: location.hash, rows: [...document.querySelectorAll("#plan tbody tr a")].map(a => a.hash), search: document.querySelector("#plan input[type=search]").value, sort: document.querySelector("#plan th:last-child")?.getAttribute("aria-sort"), facet: [...document.querySelectorAll("#plan .facets button[aria-pressed=true]")].map(b => b.textContent) })`;
			const before = await cdp.evaluate(state);
			await act(cdp, `document.querySelector("#plan tbody a").click()`, "location.hash");
			expect(
				await until(cdp, `Boolean(document.querySelector(".view.active .sibs [rel=next]"))`),
			).toBe(true);
			await act(
				cdp,
				`document.querySelector(".view.active .sibs [rel=next]").click()`,
				"location.hash",
			);
			await act(
				cdp,
				`document.querySelector(".view.active .sibs [rel=prev]").click()`,
				"location.hash",
			);
			await load(cdp);
			await act(cdp, `document.querySelector(".view.active .back").click()`, "location.hash");
			expect(await cdp.evaluate(state)).toEqual(before);
			await act(cdp, `history.back()`, "location.hash");
			expect(await until(cdp, `Boolean(document.querySelector(".view.active"))`)).toBe(true);
			await act(cdp, `history.forward()`, "location.hash");
			expect(await cdp.evaluate(state)).toEqual(before);
			const scroll = await cdp.evaluate<number>("scrollTo(0, 180), scrollY");
			await act(cdp, `document.querySelector("#plan tbody a").click()`, "location.hash");
			await act(cdp, `document.querySelector(".view.active .back").click()`, "location.hash");
			expect(await cdp.evaluate(state)).toEqual(before);
			expect(await cdp.evaluate<number>("scrollY")).toBe(scroll);
			await act(cdp, `document.querySelector("#plan tbody a").click()`, "location.hash");
			await act(cdp, `history.back()`, "location.hash");
			expect(await cdp.evaluate(state)).toEqual(before);
		});
	}
	await inPage(`${output}#plan?f.owner=JV`, async (cdp) => {
		await act(cdp, `document.querySelector("#plan .tree a:not(.miss)").click()`, "location.hash");
		await act(cdp, `location.hash = "owners"`, "location.hash");
		await act(cdp, `document.querySelector("a[href='#plan?f.owner=JV']").click()`, "location.hash");
		expect(
			await cdp.evaluate<number>(`document.querySelector("#plan").getBoundingClientRect().top`),
		).toBeCloseTo(0, 0);
	});
}, 30_000);
