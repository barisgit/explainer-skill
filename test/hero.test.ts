import { afterAll, expect, test } from "bun:test";
import { inPage, packedMdx, runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const HERO = `import { Plot, Stepper } from "kit";

# Hero

The answer first.

<figure class="fig hero">

\`\`\`mermaid
flowchart LR
  a["Input"]:::info --> b["Check"]:::ok --> c["Hold"]:::warn --> d["Drop"]:::bad
  b -->|"retry"| e["Plain"]
\`\`\`

<Plot label="Shares" option={{ categories: ["Winter", "Spring"], series: [{ name: "Share", type: "bar", data: [0.6, 10.6], color: "var(--accent)", label: { digits: 1, unit: "%" } }, { name: "Base", type: "bar", data: [2, 3] }] }} />

<figcaption>Bars show each season's share.</figcaption>
</figure>

## Steps

A paragraph at the text's measure, long enough to fill the column on a desktop screen so the stepper below can be compared with it.

<Stepper captions={["One", "Two"]}>

\`\`\`mermaid
flowchart LR
  a[Commit] --> b[Capture] --> c[Upload] --> d[Restore]
\`\`\`

</Stepper>

\`\`\`mermaid
flowchart LR
  a[Commit] --> b[Capture] --> c[Upload] --> d[Restore]
\`\`\`
`;

/** Every text the hero draws, with its contrast on the panel, in both schemes; worst first. */
const HERO_TEXT = `(() => {
	const ctx = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true });
	const rgb = (colour) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = colour; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
	const lum = (c) => c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
	const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
	const out = {};
	for (const scheme of ["light", "dark"]) {
		document.documentElement.dataset.scheme = scheme;
		const hero = document.querySelector(".hero");
		const ground = rgb(getComputedStyle(hero).backgroundColor);
		const texts = [...hero.querySelectorAll("svg text, figcaption")].filter((el) => el.getBoundingClientRect().width > 0 && el.textContent.trim());
		const worst = texts.map((el) => {
			const style = getComputedStyle(el);
			const paint = el.matches("svg *") ? style.fill : style.color;
			return { text: el.textContent.trim(), r: Math.floor(ratio(rgb(paint), ground) * 100) / 100 };
		}).sort((a, b) => a.r - b.r)[0];
		out[scheme] = { ground, count: texts.length, worst };
	}
	return out;
})()`;

test("a .hero figure is a dark panel in both schemes whose drawn charts and Mermaid roles keep their contrast", async () => {
	const output = await packedMdx(dir, "hero", HERO);
	const seen = await inPage<
		Record<string, { ground: number[]; count: number; worst: { text: string; r: number } }>
	>(output, (cdp) => cdp.evaluate(HERO_TEXT));
	for (const scheme of ["light", "dark"]) {
		const { ground, count, worst } = seen[scheme] ?? {
			ground: [],
			count: 0,
			worst: { text: "", r: 0 },
		};
		expect(ground, scheme).toEqual([0x13, 0x29, 0x4a]);
		expect(count, scheme).toBeGreaterThan(8);
		expect(worst.r, `${scheme}: ${worst.text}`).toBeGreaterThanOrEqual(4.5);
	}

	const checked = await runCli(["check", output, "--view", "none", "--out", dir.path("hero")]);
	expect(checked.code).toBe(0);
	expect(checked.stdout).not.toMatch(/--(accent|accent-ink|c\d) in/);
}, 90_000);

test("check measures every colour token inside a .hero, so a fixed light-mode accent fails there", async () => {
	const output = await packedMdx(
		dir,
		"fixed",
		HERO.replace("# Hero", 'import "./fixed.css";\n\n# Hero'),
		{
			"fixed.css": ":root { --accent: #1f5fbf; }",
		},
	);
	const checked = await runCli(["check", output, "--view", "none", "--out", dir.path("fixed")]);
	expect(checked.code).toBe(0);
	expect(checked.stdout).toMatch(
		/--accent in dark \(figure\.fig\) is \d\.\d\d:1 on --\w+ #13294a; text in it needs 4\.5:1: lighten it/,
	);
}, 90_000);

test("a Stepper's diagram is at least as wide as the text column on a desktop, where the same diagram elsewhere is narrower", async () => {
	const output = await packedMdx(dir, "stage", HERO);
	const seen = await inPage<{ text: number; staged: number; plain: number }>(output, (cdp) =>
		cdp.evaluate(`(() => {
			const width = (el) => el.getBoundingClientRect().width;
			const [staged, plain] = [...document.querySelectorAll("section .mermaid > svg:not([data-phone])")];
			return { text: width(document.querySelector("section > p")), staged: width(staged), plain: width(plain) };
		})()`),
	);
	expect(seen.staged).toBeGreaterThanOrEqual(seen.text - 1);
	expect(seen.plain).toBeLessThan(seen.text);
}, 60_000);
