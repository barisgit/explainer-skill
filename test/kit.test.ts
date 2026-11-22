import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runCli, SKILL_DIR } from "./support.ts";

/** The components a page can import from "kit". */
const exported = new Bun.Transpiler({ loader: "ts" }).scan(
	readFileSync(join(SKILL_DIR, "kit", "components", "index.ts"), "utf8"),
).exports;

test("kit is an index within v0.8.2's size (17 lines, 347 words) whose every entry kit <name> documents", async () => {
	const { code, stdout } = await runCli(["kit"]);
	const lines = stdout.trimEnd().split("\n");

	expect(code).toBe(0);
	expect(lines.length).toBeLessThanOrEqual(17);
	expect(stdout.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(347);
	const names = lines.slice(1, -1).map((line) => line.split(" ")[0] ?? "");
	// Controls is documented with Explore and Term with Recall, whose lines name them: the listing has no room for lines of their own.
	const documentedWith = ["Controls", "Term"];
	expect(names).toEqual(
		expect.arrayContaining(exported.filter((name) => !documentedWith.includes(name))),
	);
	for (const name of [...names, ...documentedWith]) {
		const doc = await runCli(["kit", name]);
		expect(doc.code).toBe(0);
		expect(doc.stdout.trim()).not.toBe("");
	}
}, 60_000);
