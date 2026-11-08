import { afterAll, beforeAll, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { ChromeError } from "../skills/explainer/src/cdp.ts";
import type { CheckResult } from "../skills/explainer/src/check.ts";
import { withPage } from "../skills/explainer/src/chrome.ts";
import { CONTROL_LIMIT } from "../skills/explainer/src/control-sweep.ts";
import { packedMdx, runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);
let broken: string;
beforeAll(async () => {
	broken = await packedMdx(
		dir,
		"broken-choice",
		`import { BrokenChoice } from "./choice.tsx";

# A kit control

<BrokenChoice />`,
		{
			"choice.tsx": `"use client";
		import { Question } from "kit";
		export function BrokenChoice() {
			return <div onChange={() => { throw new Error("kit choice exploded"); }}>
				<Question name="probe" legend="Choose" options={["One", "Two"]} answer="Two">Two is right.</Question>
			</div>;
		}`,
		},
	);
});

test("default check catches a kit choice error once, attributed, without extra screenshots", async () => {
	const result = await runCli([
		"check",
		broken,
		"--view",
		"none",
		"--json",
		"--out",
		dir.path("broken-shots"),
	]);
	expect(result.code).toBe(1);
	expect(result.stderr).toBe("");
	const { shots } = JSON.parse(result.stdout) as CheckResult;
	const failed = shots.filter((s) => s.problems.some((p) => p.includes("kit choice exploded")));
	expect(failed.map((s) => [s.theme, s.viewport, s.view])).toEqual([
		["light", "desktop 1440x900", ""],
	]);
	expect(failed[0]?.problems.join("\n")).toContain(
		"control #probe-One: page error: Error: kit choice exploded",
	);
	expect(readdirSync(dir.path("broken-shots")).filter((p) => p.endsWith(".png"))).toHaveLength(8);
}, 30_000);

test.each([
	{ name: "quick", flags: ["--quick"] },
	{ name: "steps", flags: ["--do", "focus:body"] },
])(
	"$name skips automatic control clicks",
	async ({ name, flags }) => {
		const result = await runCli([
			"check",
			broken,
			"--view",
			"none",
			"--out",
			dir.path(name),
			...flags,
		]);
		expect(result.code).toBe(0);
		expect(result.stdout).not.toContain("kit choice exploded");
	},
	30_000,
);

const FRESH_CHOICES = `"use client";
import { Question } from "kit";
let clicks = 0;
let innerScrolls = 0;
export function FreshChoices({prefix}) {
	const probe = event => {
		if (!(event.target instanceof HTMLInputElement)) return;
		const others = [...document.querySelectorAll('fieldset input:checked')].filter(el => el !== event.target).length;
		console.warn("fresh " + prefix + " memory=" + (++clicks) + " storage=" + (localStorage.getItem("probe-state") ?? "empty") + " other=" + others + " inner=" + innerScrolls);
		localStorage.setItem("probe-state", "dirty");
		if (event.target.id === prefix + "-second-One") document.getElementById(prefix + "-leak").style.width = "3000px";
	};
	return <div onClickCapture={probe}>
		{prefix === "overview" && <a href="#detail" onClick={() => console.warn("view link clicked")}>Open detail</a>}
		<Question name={prefix + "-first"} legend="First" options={["One", "Two"]} answer="Two">Two.</Question>
		<Question name={prefix + "-second"} legend="Second" options={["One", "Two"]} answer="Two">Two.</Question>
		<div id={prefix + "-leak"}>State only</div>
		<div style={{height: "80px", overflow: "auto"}} onScroll={() => innerScrolls++}>
			<div style={{height: "500px"}}>Nested scrolling</div>
		</div>
	</div>;
}`;

test("control states start independently with Keep cleared, without scroll sweeps or view/screen multiplication", async () => {
	const file = await packedMdx(
		dir,
		"fresh",
		`import { View } from "kit";
import { FreshChoices } from "./fresh.tsx";

# Independent controls

<FreshChoices prefix="overview" />

<View name="detail">

# Detail

<FreshChoices prefix="hidden" />

</View>`,
		{ "fresh.tsx": FRESH_CHOICES },
	);
	const result = await runCli(["check", file, "--json", "--out", dir.path("fresh-shots")]);
	expect(result.code).toBe(1);
	expect(result.stderr).toBe("");
	const { shots } = JSON.parse(result.stdout) as CheckResult;
	expect(shots).toHaveLength(8);
	const warnings = shots.flatMap((s) => s.warnings).filter((w) => w.startsWith("control "));
	expect(warnings.filter((w) => w.includes("view link clicked"))).toHaveLength(1);
	expect(warnings.filter((w) => w.includes("fresh "))).toEqual([
		"control #overview-first-One: console.warning: fresh overview memory=1 storage=empty other=0 inner=0",
		"control #overview-second-One: console.warning: fresh overview memory=1 storage=empty other=0 inner=0",
	]);
	const failed = shots.filter((s) => s.problems.length);
	expect(failed.map((s) => [s.theme, s.viewport, s.view])).toEqual([
		["light", "desktop 1440x900", ""],
	]);
	expect(failed[0]?.problems.join("\n")).toContain(
		"control #overview-second-One: horizontal page overflow at 1440px",
	);
}, 30_000);

const MANY_CHOICES = `"use client";
import { Question } from "kit";
export function ManyChoices({count, hang}) {
	return <div onChange={event => {
		if (hang) { while (true) {} }
		console.warn("choice clicked " + event.target.id);
	}}>
		{Array.from({length: count}, (_, i) => <Question name={"sample-" + i} legend={"Choice " + i} options={["One", "Two"]} answer="Two">Two.</Question>)}
	</div>;
}`;

test.each([
	{
		name: "cap",
		count: 20,
		hang: false,
		completed: CONTROL_LIMIT,
		why: `${CONTROL_LIMIT}-control cap`,
	},
	{
		name: "budget",
		count: 2,
		hang: true,
		completed: 0,
		why: "8s total budget; stopped at #sample-0-One",
	},
])(
	"$name stops coverage once and lets every normal screenshot finish",
	async ({ name, count, hang, completed, why }) => {
		const file = await packedMdx(
			dir,
			name,
			`import { ManyChoices } from "./many.tsx";

# Bounded controls

<ManyChoices count={${count}} hang={${hang}} />`,
			{ "many.tsx": MANY_CHOICES },
		);
		const result = await runCli([
			"check",
			file,
			"--view",
			"none",
			"--json",
			"--out",
			dir.path(name),
		]);
		expect(result.code).toBe(0);
		expect(result.stderr).toBe("");
		const { shots } = JSON.parse(result.stdout) as CheckResult;
		expect(shots).toHaveLength(4);
		const warnings = shots.flatMap((s) => s.warnings);
		expect(warnings.filter((w) => w.startsWith("control sweep incomplete"))).toEqual([
			`control sweep incomplete: completed ${completed} of ${count} sampled control clicks (${why})`,
		]);
		const clicked = warnings
			.filter((w) => w.includes("choice clicked"))
			.map((w) => w.split("choice clicked ")[1]);
		expect(clicked).toEqual(Array.from({ length: completed }, (_, i) => `sample-${i}-One`));
	},
	30_000,
);

test("a timed-out disposable control page closes without poisoning the screenshot page", async () => {
	await withPage(async (cdp) => {
		await cdp.send("Page.enable");
		const url = `file://${dir.write("hung.html", '<!doctype html><input id="state" value="original">')}`;
		await cdp.load(url);
		const targets = async () =>
			(
				await cdp.send<{ targetInfos: { targetId: string; type: string }[] }>("Target.getTargets")
			).targetInfos
				.filter((t) => t.type === "page")
				.map((t) => t.targetId)
				.sort();
		const before = await targets();
		const limit = new AbortController();
		const reason = new ChromeError("control budget ended");
		let timer: ReturnType<typeof setTimeout> | undefined;
		const started = performance.now();
		try {
			await expect(
				cdp.temporaryPage(async (child) => {
					await child.send("Page.enable");
					await child.load(url);
					timer = setTimeout(() => limit.abort(reason), 50);
					await child.evaluate("while (true) {}");
				}, limit.signal),
			).rejects.toBe(reason);
		} finally {
			clearTimeout(timer);
		}
		expect(performance.now() - started).toBeLessThan(1000);
		expect(await cdp.evaluate("document.getElementById('state').value")).toBe("original");
		expect(await targets()).toEqual(before);
	});
}, 30_000);
