import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** The skill directory as an installer would copy it. */
export const SKILL_DIR = join(import.meta.dir, "..", "skills", "explainer");

export interface CliResult {
	code: number;
	stdout: string;
	stderr: string;
}

/** Runs `bun skills/explainer/cli.ts <args>` the way an agent would and captures its streams. */
export async function runCli(args: string[]): Promise<CliResult> {
	const proc = Bun.spawn([process.execPath, join(SKILL_DIR, "cli.ts"), ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { code, stdout, stderr };
}

/** A temporary directory that is removed by `cleanup()`, with a helper to write files into it. */
export function scratch() {
	const root = mkdtempSync(join(tmpdir(), "explainer-test-"));
	return {
		path: (name: string) => join(root, name),
		write(name: string, content: string): string {
			const file = join(root, name);
			mkdirSync(dirname(file), { recursive: true });
			writeFileSync(file, content);
			return file;
		},
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}
