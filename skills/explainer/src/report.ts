import type { Shot, ViewReport } from "./check.ts";
import { SWEEP_WARNING } from "./page-probes.ts";

/** A list of this many in-page links in the first viewport counts as a deliberate text map. */
const TEXT_MAP_LINKS = 3;

/** Shot location for the warnings list: "dark narrow #repo/mobile". */
const where = (s: Shot) => `${s.theme} ${s.viewport.split(" ")[0]}${s.view ? ` ${s.view}` : ""}`;

/** What the first viewport holds: figures, else a text map (a list of in-page links) reported as such, else the plain "no figure" hint. */
function firstContent(figures: string[], links: number): string {
	if (figures.length) {
		return `${figures.length} figure(s): ${figures.join(", ")}`;
	}
	return links >= TEXT_MAP_LINKS ? `text map: ${links} in-page links in view` : "no figure in view";
}

function firstScreens(shots: Shot[]): string[] {
	const out: string[] = [];
	for (const s of shots) {
		if (!s.first) {
			continue;
		}
		const { png, headline, figures, links } = s.first;
		const seen = firstContent(figures, links);
		out.push(
			`  ${s.theme.padEnd(5)} ${s.viewport.padEnd(17)} ${png}\n${" ".repeat(8)}${headline ? `"${headline}"` : "no h1"} | ${seen}`,
		);
	}
	return out.length
		? ["First screens (taken before any --do step; open these first):", ...out, ""]
		: [];
}

function pages(shots: Shot[], stepNotes: string[]): string[] {
	const out = ["Pages:"];
	for (const s of shots) {
		out.push(
			`  ${s.problems.length ? "FAIL" : "ok  "} ${s.theme.padEnd(5)} ${s.viewport.padEnd(17)} ${(s.view || "overview").padEnd(14)} ${s.png}${s.problems.map((p) => `\n         ${p}`).join("")}`,
			...s.elements.map((e) => `         ${e.step}  ${e.png}`),
		);
	}
	return [...out, ...stepNotes.map((n) => `  --do ${n}`)];
}

/** A sweep is one warning per load kind, not a new warning for each screen's coverage details. */
const warningKey = (s: Shot, w: string) =>
	w.startsWith(`${SWEEP_WARNING}:`) ? `${SWEEP_WARNING} (${s.view || "overview"})` : w;

/** Warnings grouped by identity, retaining each distinct coverage detail and the places it occurred. */
function warnings(shots: Shot[]): string[] {
	const warned = new Map<string, Map<string, string[]>>();
	for (const s of shots) {
		for (const w of s.warnings) {
			const key = warningKey(s, w);
			const details = warned.get(key) ?? new Map<string, string[]>();
			details.set(w, [...(details.get(w) ?? []), where(s)]);
			warned.set(key, details);
		}
	}
	if (!warned.size) {
		return [];
	}
	const out = ["", "Warnings (do not fail the check):"];
	for (const [key, details] of warned) {
		out.push(`  ${key}`);
		for (const [w, at] of details) {
			if (w !== key) {
				out.push(`         ${w.slice(SWEEP_WARNING.length + 2)}`);
			}
			out.push(`         at: ${[...new Set(at)].join(", ")}`);
		}
	}
	return out;
}

function viewsSection(views: ViewReport): string[] {
	const out = [
		"",
		`Views found (${views.found.length}): ${views.found.join(", ") || "none"}`,
		`Views captured (${views.captured.length}): ${views.captured.join(", ") || "none"}`,
	];
	if (views.uncaptured.length) {
		out.push(
			`Views not captured: ${views.uncaptured.length} of those (--view all captures every hash found; --view <hash> one)`,
		);
	}
	for (const t of views.templates) {
		out.push(`View "${t}" has no link to follow: pass --view ${t}/<param>`);
	}
	return out;
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** The last line: whether the check passed, with the number of distinct problems and warnings (the same grouping as above). */
function verdict(shots: Shot[]): string {
	const problems = new Set(shots.flatMap((s) => s.problems)).size;
	const warned = new Set(shots.flatMap((s) => s.warnings.map((w) => warningKey(s, w)))).size;
	return `Verdict: ${problems ? "FAIL" : "ok"}, ${count(problems, "problem")}, ${count(warned, "warning")}.`;
}

/** The check result as text: first screens, then pass/fail per shot with problems, then warnings grouped by message, then a one-line verdict. */
export function report(
	outDir: string,
	shots: Shot[],
	views: ViewReport,
	stepNotes: string[],
): string {
	return [
		`Screenshots: ${outDir}`,
		"",
		...firstScreens(shots),
		...pages(shots, stepNotes),
		...warnings(shots),
		...viewsSection(views),
		"Open the PNGs (first-screen ones first) and look for clipped text, empty regions, weak contrast, broken layout.",
		verdict(shots),
	].join("\n");
}
