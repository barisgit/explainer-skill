import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { withPage } from "../skills/explainer/src/chrome.ts";
import { runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/**
 * A client component that places its children from the page between parts of its own that change: a paragraph that appears
 * in front of them, and a count and a paragraph after them.
 */
const PANEL = `"use client";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";

export function Panel({ children }: { children?: ComponentChildren }) {
	const [n, setN] = useState(1);
	return (
		<>
			{n > 2 && <p id="early">Clicked twice</p>}
			{children}
			<figure class="fig" id="panel">
				<button type="button" class="btn" id="more" onClick={() => setN(n + 1)}>More</button>
				<output id="count">{n}</output>
				{n > 1 && <p id="late">Clicked {n - 1}</p>}
			</figure>
		</>
	);
}
`;

/** The slot: a ## heading, prose with a data-ref term, a static Stepper whose part shares the ref, and a kit Plot. */
const PAGE = `import { Plot, Stepper } from "kit";
import { Panel } from "./panel.tsx";

# Slots

The lede.

<Panel>
## Why the bump stays

Prose with **bold** and the <span data-ref="peak">peak</span>.

<Stepper id="s" start={1} captions={["one", "two"]}>
  <svg viewBox="0 0 40 20" width="120"><rect data-ref="peak" data-step="1" width="20" height="20" /><rect data-step="2" x="20" width="20" height="20" /></svg>
</Stepper>

<Plot id="calls" label="Calls" option={{ categories: ["Mon", "Tue"], series: [{ type: "bar", data: [3, 5] }] }} />
</Panel>

Text after the panel, in its section.

## Next

More.
`;

/** The section the slot opens and what steps.js, link.js and plot.js did in it, as the reader sees it. */
const STATE = `(() => {
	const section = document.querySelector("[data-overview] > section");
	return {
		children: [...section.children].map((el) => el.id || el.localName),
		heading: section.querySelector(":scope > h2")?.textContent,
		step: document.querySelector("#s .player output")?.textContent,
		players: document.querySelectorAll("#s .player").length,
		term: document.querySelector("span[data-ref]").tabIndex,
		bars: document.querySelectorAll("#calls svg rect").length > 0,
		count: document.getElementById("count").textContent,
		kept: window.kept?.every((node) => node.isConnected && section.contains(node)),
	};
})()`;

/** Waits a frame, a task and a frame, so effects and the redraws they start have run. */
const SETTLE = `new Promise(requestAnimationFrame).then(() => new Promise((done) => setTimeout(done, 50))).then(() => new Promise(requestAnimationFrame))`;

/**
 * Opens the packed slots page, reads STATE, then steps the Stepper in the slot and clicks the Panel twice, and reads it again;
 * keeps the slot's heading, term and step controls in `window.kept` to see that they are the same nodes afterwards.
 */
function stepAndClick(output: string) {
	return withPage(async (cdp) => {
		const errors: string[] = [];
		cdp.on("Runtime.exceptionThrown", ({ exceptionDetails: d }) =>
			errors.push(d.exception?.description ?? d.text),
		);
		await Promise.all(["Page", "Runtime"].map((domain) => cdp.send(`${domain}.enable`)));
		const loaded = cdp.once("Page.loadEventFired");
		await cdp.send("Page.navigate", { url: `file://${output}` });
		await loaded;
		await cdp.evaluate(`document.fonts.ready.then(() => ${SETTLE})`, true);
		const opened = await cdp.evaluate(STATE);
		const clicked = await cdp.evaluate(
			`window.kept = [document.querySelector("h2"), document.querySelector("span[data-ref]"), document.querySelector("#s .player")];
			document.querySelector('#s [data-go="1"]').click();
			document.getElementById("more").click();
			${SETTLE}.then(() => { document.getElementById("more").click(); return ${SETTLE}; }).then(() => ${STATE})`,
			true,
		);
		return { opened, clicked, errors };
	});
}

describe("a client component's children from the page (its slot)", () => {
	const page = () => {
		dir.write("panel.tsx", PANEL);
		return dir.write("slots.mdx", PAGE);
	};

	test("are static HTML it places, in the section their ## opens, and its state changes leave them and the kit's work in them", async () => {
		const output = dir.path("slots.html");
		const packed = await runCli(["pack", page(), "-o", output]);
		expect(packed.stderr).toBe("");
		const html = readFileSync(output, "utf8");
		expect(html).toContain("<section><!--island:0--><!--slot:0--><h2>Why the bump stays</h2>");
		// The Plot in the slot is an island of its own; its option is in the islands' JSON, the slot's prose is not.
		expect(html).toMatch(/<!--island:1--><div class="chart plot"[^>]*id="calls"/);
		expect(html).not.toMatch(/explainer-islands">[^<]*bump stays/);

		const state = await stepAndClick(output);
		expect(state.errors).toEqual([]);
		const slot = ["h2", "p", "s", "calls"];
		expect(state.opened).toEqual({
			children: [...slot, "panel", "p"],
			heading: "Why the bump stays",
			step: "1 / 2",
			players: 1,
			term: 0,
			bars: true,
			count: "1",
		});
		expect(state.clicked).toEqual({
			children: ["early", ...slot, "panel", "p"],
			heading: "Why the bump stays",
			step: "2 / 2",
			players: 1,
			term: 0,
			bars: true,
			count: "3",
			kept: true,
		});
	}, 60_000);

	test("check finds no problems", async () => {
		const output = dir.path("slots-checked.html");
		expect((await runCli(["pack", page(), "-o", output])).code).toBe(0);
		const checked = await runCli([
			"check",
			output,
			"--out",
			dir.path("slots-shots"),
			"--do",
			"click:#more",
		]);
		expect(checked.stdout).toContain("0 problems");
		expect(checked.code).toBe(0);
	}, 90_000);

	test("fail the pack when the component does not place them, or they hold a function, a handler or the author's client component", async () => {
		dir.write("panel.tsx", PANEL);
		dir.write(
			"bare.tsx",
			'"use client";\n\nexport function Bare({ n }: { n: number }) {\n\treturn <b>{n}</b>;\n}\n',
		);
		const imports = 'import { Bare } from "./bare.tsx";\nimport { Panel } from "./panel.tsx";\n\n';
		const failure = async (name: string, body: string) => {
			const result = await runCli([
				"pack",
				dir.write(`${name}.mdx`, imports + body),
				"-o",
				dir.path(`${name}.html`),
			]);
			expect(result.code).toBe(1);
			return result.stderr;
		};
		expect(await failure("unplaced", "<Bare n={1}>Text</Bare>\n")).toContain(
			"<Bare> has children in the page, but Bare does not render them: write {children} in Bare where they go, or leave them out",
		);
		expect(await failure("island", "<Panel>\nText\n\n<Bare n={1} />\n</Panel>\n")).toContain(
			"<Bare> is in the children of <Panel>, which pack renders once as static HTML, so Bare would not share Panel's state: render <Bare> inside Panel, or beside it in the page",
		);
		expect(await failure("function", "<Panel>{(n) => n}</Panel>\n")).toContain(
			"<Panel> has a function among its children in the page, but they are rendered once in pack as static HTML, so it would never run: compute that part inside Panel",
		);
		expect(
			await failure("handler", "<Panel><button onClick={() => 1}>Go</button></Panel>\n"),
		).toContain(
			'<button onClick> in the page is static HTML, so the handler would never run: move it into a component of your own in a .tsx module whose first line is "use client"',
		);
	});
});
