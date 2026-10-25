#!/usr/bin/env bun
/**
 * Release check for the install paths: clones the committed repo, installs the skill with `npx skills`
 * (global copy, and project scope with a symlink) and with Caplet (user and project scope) into a
 * disposable HOME, then runs `kit`, `pack` and `check` from each installed copy in an unrelated
 * directory, and typechecks a copy of the example page with `kit types` and `bun check`. It needs network (npx fetches the skills CLI) and Chrome, so it is not part of `bun run ci`.
 *
 * Usage: bun build/verify-install.ts [sandbox-dir]   (the directory must not exist yet; it is kept)
 * Requires `caplet` on PATH or CAPLET=/path/to/caplet.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "..");
const sandbox = resolve(process.argv[2] ?? join(tmpdir(), `explainer-install-${Date.now()}`));
const { CAPLET: caplet = "caplet" } = process.env;
const source = join(sandbox, "source");
const elsewhere = join(sandbox, "elsewhere");
const problems: string[] = [];

type Run = { code: number; out: string; stdout: string };

/** Runs a command with a HOME inside the sandbox so no installer can touch the real one. */
function run(command: string[], cwd: string, home: string): Run {
	const env: Record<string, string | undefined> = {
		...process.env,
		HOME: home,
		DISABLE_TELEMETRY: "1",
		npm_config_cache: join(sandbox, "npm-cache"),
	};
	for (const name of ["CLAUDE_CONFIG_DIR", "XDG_STATE_HOME", "XDG_CONFIG_HOME"]) {
		delete env[name];
	}
	const [file = "", ...args] = command;
	const result = spawnSync(file, args, { cwd, env, encoding: "utf8" });
	return {
		code: result.status ?? 1,
		out: `${result.stdout}${result.stderr}`,
		stdout: result.stdout,
	};
}

/** Prints one line per check; a failure is kept with its detail for the summary. */
function record(ok: boolean, label: string, detail = ""): void {
	console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
	if (!ok) {
		problems.push(`${label}\n${detail}`);
	}
}

function listFiles(dir: string): string[] {
	return readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
		.sort();
}

/** Every committed skill file arrived byte for byte; installers may add only their own ACF-MANAGED.md. */
function verifyFiles(installed: string, expected: string[]): void {
	const got = listFiles(installed).filter((file) => file !== "ACF-MANAGED.md");
	const missing = expected.filter((file) => !got.includes(file));
	const extra = got.filter((file) => !expected.includes(file));
	record(
		missing.length === 0 && extra.length === 0,
		`${expected.length} files arrived`,
		`missing: ${missing}\nextra: ${extra}`,
	);
	const differing = expected.filter(
		(file) =>
			!existsSync(join(installed, file)) ||
			Buffer.compare(
				readFileSync(join(installed, file)),
				readFileSync(join(source, "skills/explainer", file)),
			) !== 0,
	);
	record(differing.length === 0, "contents identical", differing.join("\n"));
}

/** A copy of the installed example page typechecks with `kit types > tsconfig.json` then `bun check`, with nothing installed. */
function verifyTypes(cli: string, installed: string, home: string, outDir: string): void {
	const page = join(outDir, "page");
	cpSync(join(installed, "example"), page, { recursive: true });
	const types = run(["bun", cli, "kit", "types"], page, home);
	record(types.code === 0, "bun cli.ts kit types", types.out);
	writeFileSync(join(page, "tsconfig.json"), types.code === 0 ? types.stdout : "");
	const check = run(["bun", "check"], page, home);
	record(check.code === 0, "bun check on the example page", check.out);
}

/** The CLI runs from the installed location with no npm install, and node explains what is missing. */
function verifyCli(installed: string, home: string, outDir: string): void {
	const cli = join(installed, "cli.ts");
	const packed = join(outDir, "artifact.html");
	const kit = run(["bun", cli, "kit"], elsewhere, home);
	record(kit.code === 0 && kit.out.includes("theme.css"), "bun cli.ts kit", kit.out);
	const pack = run(
		["bun", cli, "pack", join(installed, "example", "page.mdx"), "-o", packed],
		elsewhere,
		home,
	);
	record(pack.code === 0 && existsSync(packed), "bun cli.ts pack example/page.mdx", pack.out);
	const check = run(["bun", cli, "check", packed, "--out", join(outDir, "shots")], elsewhere, home);
	record(check.code === 0, "bun cli.ts check", check.out);
	verifyTypes(cli, installed, home, outDir);
	const node = run(["node", cli, "kit"], elsewhere, home);
	record(node.code === 2 && node.out.includes("needs Bun"), "node cli.ts explains Bun", node.out);
}

type Scenario = {
	name: string;
	/** Installed directories to verify, relative to the scenario folder: under `home/` (the sandbox HOME) or `proj/` (the project). */
	installed: string[];
	steps: string[][];
};

const scenarios: Scenario[] = [
	{
		name: "skills-global-copy",
		installed: ["home/.claude/skills/explainer"],
		steps: [
			["npx", "-y", "skills", "add", source, "--global", "--agent", "claude-code", "--copy", "-y"],
		],
	},
	{
		name: "skills-project-symlink",
		installed: ["proj/.agents/skills/explainer", "proj/.claude/skills/explainer"],
		steps: [
			["npx", "-y", "skills", "add", source, "--agent", "claude-code", "--agent", "codex", "-y"],
		],
	},
	{
		name: "caplet-user",
		installed: ["home/.agents/skills/explainer", "home/.claude/skills/explainer"],
		steps: [[caplet, "add", source, "--scope", "user", "-y"]],
	},
	{
		// `init` first: without a project .agents directory caplet walks up from the project and can
		// pick up the real ~/.agents when the sandbox lies below the real home.
		name: "caplet-project",
		installed: ["proj/.agents/skills/explainer", "proj/.claude/skills/explainer"],
		steps: [
			[caplet, "init"],
			[caplet, "add", source, "--scope", "project", "-y"],
		],
	},
];

function runScenario(scenario: Scenario, expected: string[]): void {
	console.log(scenario.name);
	const root = join(sandbox, scenario.name);
	const home = join(root, "home");
	const proj = join(root, "proj");
	mkdirSync(home, { recursive: true });
	mkdirSync(proj, { recursive: true });
	for (const step of scenario.steps) {
		const result = run(step, proj, home);
		record(result.code === 0, step.slice(0, 3).join(" "), result.out);
	}
	for (const dir of scenario.installed) {
		console.log(` ${dir}`);
		const installed = join(root, dir);
		if (!existsSync(installed)) {
			record(false, "installed", `${installed} does not exist`);
			continue;
		}
		verifyFiles(installed, expected);
		verifyCli(installed, home, join(root, "out", dir.replaceAll("/", "_")));
	}
}

if (existsSync(sandbox)) {
	console.error(`error: ${sandbox} exists; pass a directory that does not exist yet`);
	process.exit(2);
}
mkdirSync(elsewhere, { recursive: true });
const clone = spawnSync("git", ["clone", "-q", repo, source], { encoding: "utf8" });
if (clone.status !== 0) {
	console.error(clone.stderr);
	process.exit(2);
}
const tracked = spawnSync("git", ["ls-files", "skills/explainer"], {
	cwd: source,
	encoding: "utf8",
});
const files = tracked.stdout
	.split("\n")
	.filter(Boolean)
	.map((file) => file.replace("skills/explainer/", ""))
	.sort();
for (const scenario of scenarios) {
	runScenario(scenario, files);
}
console.log(`\nsandbox kept at ${sandbox}`);
if (problems.length > 0) {
	console.error(`\n${problems.length} failed:\n${problems.join("\n---\n")}`);
	process.exit(1);
}
