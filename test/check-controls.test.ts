import { afterAll, beforeAll, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { ChromeError } from "../skills/explainer/src/cdp.ts";
import type { CheckResult } from "../skills/explainer/src/check.ts";
import { CheckedPage } from "../skills/explainer/src/checked-page.ts";
import { openBrowser, withPage } from "../skills/explainer/src/chrome.ts";
import { CONTROL_LIMIT, CONTROLS_JS } from "../skills/explainer/src/control-sweep.ts";
import { DISCOVER_JS } from "../skills/explainer/src/page-probes.ts";
import { runStep } from "../skills/explainer/src/steps.ts";
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
const session = typeof sessionStorage === "undefined" ? "server" : sessionStorage.getItem("probe-state") ?? "empty";
export function FreshChoices({prefix}) {
	const probe = event => {
		if (!(event.target instanceof HTMLInputElement)) return;
		const others = [...document.querySelectorAll('fieldset input:checked')].filter(el => el !== event.target).length;
		console.warn("fresh " + prefix + " memory=" + (++clicks) + " storage=" + (localStorage.getItem("probe-state") ?? "empty") + " session=" + session + " other=" + others + " inner=" + innerScrolls);
		localStorage.setItem("probe-state", "dirty");
		sessionStorage.setItem("probe-state", "dirty");
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
		"control #overview-first-One: console.warning: fresh overview memory=1 storage=empty session=empty other=0 inner=0",
		"control #overview-second-One: console.warning: fresh overview memory=1 storage=empty session=empty other=0 inner=0",
	]);
	const failed = shots.filter((s) => s.problems.length);
	expect(failed.map((s) => [s.theme, s.viewport, s.view])).toEqual([
		["light", "desktop 1440x900", ""],
	]);
	expect(failed[0]?.problems.join("\n")).toContain(
		"control #overview-second-One: horizontal page overflow at 1440px",
	);
}, 30_000);

test("fresh file loads clear both stores before author scripts, while explicit reload preserves them", async () => {
	const file = dir.write(
		"fresh-storage.html",
		`<!doctype html><body><script>
		const keys = ['sample', 'length'];
		document.body.dataset.initial = [localStorage, sessionStorage].flatMap(store => keys.map(key => store.getItem(key) ?? 'empty')).join('|');
		const save = () => { for (const store of [localStorage, sessionStorage]) for (const key of keys) store.setItem(key, 'dirty'); };
		addEventListener('pagehide', save);
		</script><button id="sample" onclick="save()">Sample</button>`,
	);
	await withPage(async (cdp) => {
		const page = new CheckedPage(cdp, `file://${file}`);
		await page.start();
		await page.open();
		const initial = () => cdp.evaluate("document.body.dataset.initial");
		expect(await initial()).toBe("empty|empty|empty|empty");
		await runStep(cdp, "click:#sample", () => "unused");
		await runStep(cdp, "reload", () => "unused");
		expect(await initial()).toBe("dirty|dirty|dirty|dirty");
		await page.open();
		expect(await initial()).toBe("empty|empty|empty|empty");
	});
}, 30_000);

test("fresh file loads leave another tab's session state intact", async () => {
	const file = dir.write("tab-session.html", "<!doctype html><h1>Session</h1>");
	const url = `file://${file}`;
	const browser = await openBrowser();
	try {
		await browser.page(async (primary) => {
			await primary.send("Page.enable");
			await primary.load(url);
			await primary.evaluate("sessionStorage.setItem('reader', 'kept')");
			await browser.page(async (probe) => {
				const page = new CheckedPage(probe, url);
				await page.start();
				await page.open();
			});
			expect(await primary.evaluate("sessionStorage.getItem('reader')")).toBe("kept");
			await primary.load();
			expect(await primary.evaluate("sessionStorage.getItem('reader')")).toBe("kept");
		});
	} finally {
		await browser.close();
	}
}, 30_000);

test("control selection claims stateful and escaped view routes like discovery", async () => {
	const file = dir.write(
		"routes.html",
		`<!doctype html>
		<a id="unclaimed" href="#static/missing">Not a view</a>
		<a id="team" href="#team?crew?view=table">Team table</a>
		<a id="duplicate" href="#team?crew?view=tree">Same view</a>
		<a id="escaped" href="#static/a%3Fb?panel?open=1">Escaped param</a>
		<a id="malformed" href="#percent/100%?panel">Literal percent</a>
		<section data-view="team" hidden></section>
		<section data-view="static/a%3Fb" hidden></section>
		<section data-view="percent/100%" hidden></section>`,
	);
	await withPage(async (cdp) => {
		const page = new CheckedPage(cdp, `file://${file}`);
		await page.start();
		await page.open();
		const selected = await cdp.evaluate<{ name: string }[]>(CONTROLS_JS);
		expect(selected.map((c) => c.name)).toEqual(["#team", "#escaped", "#malformed"]);
		const discovered = await cdp.evaluate<{ hashes: string[] }>(DISCOVER_JS);
		expect(discovered.hashes).toContain("#team?crew?view=table");
		expect(discovered.hashes).not.toContain("#static/missing");
	});
}, 30_000);

test("the cap spreads samples across control kinds before filling in document order", async () => {
	const questions = Array.from(
		{ length: 13 },
		(_, i) =>
			`<fieldset class="self-check"><div class="seg"><input id="q${i}" type="radio"></div></fieldset>`,
	).join("");
	const file = dir.write(
		"spread.html",
		`<!doctype html>${questions}<div data-stepper><button id="next" data-go="1">Next</button></div>`,
	);
	await withPage(async (cdp) => {
		const page = new CheckedPage(cdp, `file://${file}`);
		await page.start();
		await page.open();
		const selected = await cdp.evaluate<{ name: string }[]>(CONTROLS_JS);
		expect(selected).toHaveLength(14);
		expect(selected.slice(0, CONTROL_LIMIT).map((c) => c.name)).toEqual([
			"#q0",
			"#next",
			...Array.from({ length: 10 }, (_, i) => `#q${i + 1}`),
		]);
	});
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
