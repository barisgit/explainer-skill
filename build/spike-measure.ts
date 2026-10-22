/**
 * Spike measurement: runs `pack` and a full `check` of each page with one checkout's CLI, several times, and records wall time,
 * peak resident memory of everything the run started, exit code and verdict line.
 *
 *   bun build/spike-measure.ts <label> <cli.ts> <runs> <outRoot> <page.html>...
 *
 * Memory is summed over the CLI's descendants (Chrome) plus every WebKit helper process that did not exist when the run began
 * (WKWebView's content processes are XPC services of launchd, not children). Output: one JSON line per run on stdout.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const POLL_MS = 100;

interface Proc {
	pid: number;
	ppid: number;
	rssKb: number;
	name: string;
}

async function processes(): Promise<Proc[]> {
	const out = await new Response(
		Bun.spawn(["ps", "-axo", "pid=,ppid=,rss=,comm="], { stdout: "pipe" }).stdout,
	).text();
	return out
		.split("\n")
		.map((line) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line))
		.filter((m): m is RegExpExecArray => m !== null)
		.map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), rssKb: Number(m[3]), name: m[4] ?? "" }));
}

/** Runs `argv`, sampling memory until it exits. */
async function timed(argv: string[]) {
	const before = new Set((await processes()).map((p) => p.pid));
	const started = performance.now();
	const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
	let peakKb = 0;
	let done = false;
	const sampler = (async () => {
		while (!done) {
			const all = await processes();
			const mine = new Set([proc.pid]);
			for (let grew = true; grew; ) {
				grew = false;
				for (const p of all) {
					if (mine.has(p.ppid) && !mine.has(p.pid)) {
						mine.add(p.pid);
						grew = true;
					}
				}
			}
			const total = all
				.filter(
					(p) => mine.has(p.pid) || (!before.has(p.pid) && p.name.includes("com.apple.WebKit.")),
				)
				.reduce((sum, p) => sum + p.rssKb, 0);
			peakKb = Math.max(peakKb, total);
			await Bun.sleep(POLL_MS);
		}
	})();
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	done = true;
	await sampler;
	return {
		seconds: (performance.now() - started) / 1000,
		peakMb: peakKb / 1024,
		code,
		stdout,
		stderr,
	};
}

const [label, cli, runsArg, outRoot, ...pages] = process.argv.slice(2);
if (!label || !cli || !runsArg || !outRoot || !pages.length) {
	console.error(
		"usage: bun build/spike-measure.ts <label> <cli.ts> <runs> <outRoot> <page.html>...",
	);
	process.exit(2);
}
for (const page of pages) {
	const name = basename(dirname(page)) === "explainer" ? "example" : basename(dirname(page));
	for (let run = 1; run <= Number(runsArg); run++) {
		const dir = join(outRoot, label, name, `run${run}`);
		mkdirSync(dir, { recursive: true });
		const packed = join(dir, "index.html");
		const pack = await timed([process.execPath, cli, "pack", page, "-o", packed]);
		const check = await timed([
			process.execPath,
			cli,
			"check",
			packed,
			"--out",
			join(dir, "shots"),
		]);
		writeFileSync(join(dir, "check.txt"), check.stdout + check.stderr);
		const verdict = check.stdout.trimEnd().split("\n").at(-1);
		console.log(
			JSON.stringify({
				label,
				page: name,
				run,
				packS: +pack.seconds.toFixed(2),
				packMb: Math.round(pack.peakMb),
				packCode: pack.code,
				checkS: +check.seconds.toFixed(2),
				checkMb: Math.round(check.peakMb),
				checkCode: check.code,
				verdict,
			}),
		);
	}
}
