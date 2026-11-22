import { afterAll, expect, test } from "bun:test";
import { act, inPage, kitScriptsIn, load, packedMdx, packMdx, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const PAGE = `---
lang: sl
labels:
  checkAnswer: Preveri
  enterNumber: Vpiši število.
  right: Pravilno
  wrong: Napačno
---
import { Question } from "kit";

# Vaja

<Question name="voltage" legend="Kolikšna je napetost?" answer={7.83} tolerance={0.01} unit="V">

Na dve decimalni mesti je to **7,83 V**.

</Question>
`;

test("checks a comma decimal in the shown unit, then keeps the solution and verdict silently across reload", async () => {
	const output = await packedMdx(dir, "numeric", PAGE);
	expect(kitScriptsIn(output)).toEqual(["keep"]);
	await inPage(output, async (cdp) => {
		const seen = `(() => {
			const field = document.querySelector("fieldset");
			const input = field.querySelector("input");
			return [
				input.value,
				[...field.querySelectorAll("[data-verdict]")].find((word) => word.checkVisibility())?.textContent ?? "",
				field.querySelector(".explain").checkVisibility(),
				field.querySelector("[role=status]").textContent,
				document.getElementById(input.getAttribute("aria-describedby")).textContent,
				Boolean(document.querySelector(".reply-bar")),
			];
		})()`;
		const type = (value: string) =>
			`const input = document.getElementById("voltage"); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event("input", { bubbles: true }));`;
		const click = `document.querySelector("fieldset button").click()`;
		expect(await cdp.evaluate(seen)).toEqual(["", "", false, "", "V", false]);
		expect(await cdp.evaluate(`document.querySelector("fieldset > p").checkVisibility()`)).toBe(
			false,
		);
		expect(await act(cdp, type("7,80"), seen)).toEqual(["7,80", "", false, "", "V", false]);
		expect(await act(cdp, click, seen)).toEqual(["7,80", "Napačno", true, "Napačno", "V", false]);
		expect(await act(cdp, `${type("7,83 V")} ${click}`, seen)).toEqual([
			"7,83 V",
			"Vpiši število.",
			false,
			"Vpiši število.",
			"V",
			false,
		]);
		expect(await act(cdp, `${type("7,84")} ${click}`, seen)).toEqual([
			"7,84",
			"Pravilno",
			true,
			"Pravilno",
			"V",
			false,
		]);
		await load(cdp);
		expect(await cdp.evaluate(seen)).toEqual(["7,84", "Pravilno", true, "", "V", false]);
		const clear = `document.querySelector(".keep-clear .btn").click()`;
		await act(cdp, clear, "0");
		expect(await act(cdp, clear, seen)).toEqual(["", "", false, "", "V", false]);
	});
}, 30_000);

test("rejects numeric props that do not describe a numeric self-check", async () => {
	for (const [props, problem] of [
		['answer={7.83} options={["7.83"]}', "numeric answer has no options"],
		["answer={Infinity}", "answer must be finite"],
		["answer={7.83} tolerance={-0.01}", "tolerance must be finite and nonnegative"],
		["tolerance={0.01}", "tolerance and unit need a numeric answer"],
	]) {
		const { result } = await packMdx(
			dir,
			"invalid",
			`import { Question } from "kit";\n\n# Practice\n\n<Question name="q" legend="How much?" ${props} />\n`,
		);
		expect(result.code).toBe(1);
		expect(result.stderr).toContain(`<Question name="q">`);
		expect(result.stderr).toContain(problem ?? "");
	}
});

test("Enter checks signed dot decimals in English and includes the decimal tolerance endpoints", async () => {
	const output = await packedMdx(
		dir,
		"endpoints",
		`import { Question } from "kit";

# Thresholds

<Question name="q" legend="What is the threshold?" answer={0.3} tolerance={0.6} />`,
	);
	await inPage(output, async (cdp) => {
		const seen = `document.querySelector("fieldset [role=status]").textContent`;
		for (const [value, verdict] of [
			["0.9", "Right"],
			["-0.3", "Right"],
			["0.900001", "Wrong"],
		]) {
			await cdp.evaluate(`(() => {
				const input = document.getElementById("q");
				input.value = ${JSON.stringify(value)};
				input.focus();
			})()`);
			await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter" });
			await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter" });
			expect(await act(cdp, "", seen)).toBe(verdict);
		}
	});
}, 30_000);
