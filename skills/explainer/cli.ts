#!/usr/bin/env bun
/**
 * Entry point of the explainer CLI. The commands use Bun's built-in HTMLRewriter and `import.meta.dir`, so
 * they run under Bun only. This file is limited to syntax node can strip (see `erasableSyntaxOnly`) so that
 * a mistaken `node cli.ts` prints how to get Bun instead of a stack trace.
 */
if (!process.versions.bun) {
	const command = process.argv.slice(1).join(" ");
	console.error(
		`error: explainer needs Bun, and this is node. Install it with: curl -fsSL https://bun.sh/install | bash (see https://bun.sh), then run: bun ${command}`,
	);
	process.exit(2);
}

await import("./src/main.ts");

export {};
