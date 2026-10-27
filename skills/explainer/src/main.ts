import { ChromeError } from "./cdp.ts";
import { CLI, COMMANDS, type Command, usage } from "./commands.ts";
import { signalExit } from "./on-signal.ts";

function help(name?: string): string {
	const c = name ? COMMANDS[name] : undefined;
	if (c) {
		return `${c.summary}\n\nUsage: ${CLI} ${c.usage}\n${c.flags.length ? `\nFlags:\n${c.flags.map((f) => `  ${f}`).join("\n")}\n` : ""}\nExamples:\n${c.examples.map((e) => `  ${CLI} ${e}`).join("\n")}\n`;
	}
	return `Build one self-contained, interactive, visual HTML file from an .mdx page; it works offline from file://.

Usage: ${CLI} <command> [args]

Commands:
${Object.entries(COMMANDS)
	.map(([n, c]) => `  ${n.padEnd(7)} ${c.summary}`)
	.join("\n")}

Start: ${CLI} kit
Exit codes: 0 ok, 1 problems found (pack/check), 2 usage error. Run ${CLI} <command> --help for flags and examples.
`;
}

/** Splits the arguments after the command name into positionals and flags; a flag whose spec shows `<value>` consumes the next argument. */
function parseArgs(
	name: string,
	command: Command,
	rest: string[],
): { args: string[]; flags: Map<string, string[]> } | { error: string } {
	const specs = new Map(command.flags.map((f) => [f.split(/\s/)[0] ?? f, f]));
	const args: string[] = [];
	const flags = new Map<string, string[]>();
	for (let i = 0; i < rest.length; i++) {
		const a = rest[i] ?? "";
		if (!a.startsWith("-")) {
			args.push(a);
			continue;
		}
		const spec = specs.get(a);
		if (spec === undefined) {
			return { error: `unknown flag ${a} for ${name}. Run: ${CLI} ${name} --help` };
		}
		const takesValue = /^\S+\s+</.test(spec);
		const value = takesValue ? rest[++i] : undefined;
		if (takesValue && value === undefined) {
			return { error: `${a} needs a value. Run: ${CLI} ${name} --help` };
		}
		flags.set(a, [...(flags.get(a) ?? []), ...(value === undefined ? [] : [value])]);
	}
	return { args, flags };
}

const [name, ...rest] = process.argv.slice(2);
if (!name || name === "--help" || name === "-h" || name === "help") {
	console.log(help());
	process.exit(0);
}
const command = COMMANDS[name];
if (!command) {
	process.exit(usage(`unknown command "${name}". Run: ${CLI} --help`));
}
if (rest.includes("--help") || rest.includes("-h")) {
	console.log(help(name));
	process.exit(0);
}
const parsed = parseArgs(name, command, rest);
if ("error" in parsed) {
	process.exit(usage(parsed.error));
}
try {
	process.exit(await command.run(parsed.args, parsed.flags));
} catch (e) {
	await signalExit();
	if (!(e instanceof ChromeError)) {
		throw e;
	}
	console.error(`error: ${e.message}`);
	process.exit(1);
}
