import { afterAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { scratch } from "./support.ts";

const dir = scratch();
afterAll(() => dir.cleanup());

const fakeChrome = dir.write(
	"fake-chrome",
	`#!/bin/sh\nexec "${process.execPath}" "${join(import.meta.dir, "fake-chrome.ts")}" "$@"\n`,
);
chmodSync(fakeChrome, 0o755);
const pageTest = dir.write(
	"page.test.ts",
	`import { expect, test } from "bun:test";
import { withTestPage } from ${JSON.stringify(join(import.meta.dir, "browser.ts"))};
test("page assertion", async () => {
  await withTestPage(async () => {});
  expect(process.env.PAGE_FAILS).toBe("no");
});`,
);

/** Waits for the stand-in and its late-writing helper even when the nested hook failed before close() finished. */
async function finishChrome(tmp: string): Promise<void> {
	for (const name of readdirSync(tmp)) {
		const started = join(tmp, name, "profile", "started");
		if (!existsSync(started)) {
			continue;
		}
		const pid = Number(readFileSync(started, "utf8"));
		const alive = () => {
			try {
				return process.kill(-pid, 0);
			} catch {
				return false;
			}
		};
		// Normally it finishes naturally just after the old hook's 5 s timeout. Bound even a broken stand-in.
		const deadline = performance.now() + 3_000;
		while (alive() && performance.now() < deadline) {
			await Bun.sleep(20);
		}
		if (alive()) {
			process.kill(-pid, "SIGKILL");
		}
		const killedDeadline = performance.now() + 1_000;
		while (alive() && performance.now() < killedDeadline) {
			await Bun.sleep(20);
		}
		expect(alive()).toBe(false);
	}
}

for (const fails of [false, true]) {
	test(`shared teardown past 5 s cleans up without hiding a ${fails ? "failing" : "passing"} page`, async () => {
		const tmp = dir.path(`tmp-${fails}`);
		mkdirSync(tmp);
		const stops = dir.path(`stops-${fails}`);
		const started = performance.now();
		const proc = Bun.spawn(
			[process.execPath, "test", "--preload", join(import.meta.dir, "suite-hooks.ts"), pageTest],
			{
				cwd: dir.path(""),
				timeout: 18_000,
				stdout: "pipe",
				stderr: "pipe",
				env: {
					...process.env,
					CHROME: fakeChrome,
					TMPDIR: tmp,
					FAKE_CHROME: "slow-deaf",
					FAKE_CHROME_STOPS: stops,
					PAGE_FAILS: fails ? "yes" : "no",
				},
			},
		);
		try {
			const [code, stderr] = await Promise.all([
				proc.exited,
				new Response(proc.stderr).text(),
				new Response(proc.stdout).text(),
			]);
			expect(code).toBe(fails ? 1 : 0);
			expect(stderr).toContain(fails ? "1 fail" : "0 fail");
			expect(stderr).not.toContain("timed out");
			expect(readFileSync(stops, "utf8")).toBe("SIGTERM");
			expect(performance.now() - started).toBeGreaterThan(5_000);
			expect(performance.now() - started).toBeLessThan(15_000);
			// close() deletes the profile only once the entire Chrome group has exited.
			expect(readdirSync(tmp)).toEqual([]);
		} finally {
			proc.kill();
			await proc.exited;
			await finishChrome(tmp);
		}
	}, 25_000);
}
