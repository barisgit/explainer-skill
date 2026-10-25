import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";
import { runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/** The acceptance page: every component and page convention, in English and, with every label translated, in Slovenian. */
const FIXTURE = join(import.meta.dir, "fixtures", "mdx-all");

test.each(["page", "sl"])(
	"the acceptance page %s.mdx packs without warnings and checks with 0 problems",
	async (name) => {
		const output = dir.path(`${name}.html`);

		const packed = await runCli(["pack", join(FIXTURE, `${name}.mdx`), "-o", output]);
		expect(packed.stderr).toBe("");
		expect(packed.stdout).not.toContain("warning:");
		expect(packed.code).toBe(0);

		const checked = await runCli(["check", output, "--out", dir.path(name)]);
		expect(checked.stdout).toContain("Verdict: ok, 0 problems");
		expect(checked.code).toBe(0);
	},
	120_000,
);
