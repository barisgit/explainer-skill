import { afterAll, expect, test } from "bun:test";
import { packedMdx, runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const PAGE = `import "./colours.css";

# Probe

Some text.

<div class="mine">Scoped</div>
`;

/** The warning lines of a check report, each with the token it names. */
const tokenWarnings = (stdout: string) =>
	stdout.split("\n").filter((line) => /^\s+--(accent|accent-ink|c\d) in (light|dark)/.test(line));

test("check warns about an author's colour token too faint for its use, naming scheme, scope, ratio and what it was measured on", async () => {
	const bad = await packedMdx(dir, "bad", PAGE, {
		// A yellow accent on paper and a brown one on near-black; a series ink close to the paper, at the root and on body; a scoped accent too light.
		"colours.css": `:root { --accent: light-dark(#e0b000, #4a3000); --c2: light-dark(#e2dccf, #c9c0b2); }
.mine { --accent: light-dark(#f5d76e, #ffb15c); }
body { --c3: light-dark(#ece6dc, #c0b8aa); }
`,
	});
	const plain = await packedMdx(dir, "plain", PAGE, { "colours.css": ".mine { color: inherit; }" });

	const [checked, defaults] = await Promise.all([
		runCli(["check", bad, "--view", "none", "--out", dir.path("bad")]),
		runCli(["check", plain, "--view", "none", "--out", dir.path("plain")]),
	]);

	expect(checked.code).toBe(0);
	const lines = tokenWarnings(checked.stdout).map((line) => line.trim());
	expect(lines).toEqual([
		"--accent in light (:root) is 1.70:1 on --sunken #efebe3; text in it needs 4.5:1: darken it",
		"--accent-ink in light (:root) is 2.02:1 on --accent #e0b000; text on the accent needs 4.5:1: change --accent-ink or --accent",
		"--c2 in light (:root) is 1.24:1 on --bg #f7f4ee; a mark in it needs 3:1: darken it",
		"--c3 in light (body) is 1.13:1 on --bg #f7f4ee; a mark in it needs 3:1: darken it",
		"--accent in light (div.mine) is 1.19:1 on --sunken #efebe3; text in it needs 4.5:1: darken it",
		"--accent-ink in light (div.mine) is 1.41:1 on --accent #f5d76e; text on the accent needs 4.5:1: change --accent-ink or --accent",
		"--accent in dark (:root) is 1.42:1 on --sunken #1c1916; text in it needs 4.5:1: lighten it",
		"--accent-ink in dark (:root) is 1.50:1 on --accent #4a3000; text on the accent needs 4.5:1: change --accent-ink or --accent",
	]);
	expect(defaults.code).toBe(0);
	expect(tokenWarnings(defaults.stdout)).toEqual([]);
}, 90_000);
