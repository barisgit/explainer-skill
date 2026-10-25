"use client";
/* The first screen's figure: the reader's deployment, the OWASP setting that fits the memory one login may use, and every
   Argon2id and scrypt setting against that budget. */
import { Chart } from "kit";
import { useMemo, useState } from "preact/hooks";
import { ARGON, argonLabel, SCRYPT, scryptLabel } from "./owasp.ts";

interface Deployment {
	/** Spare memory for hashing, MiB. */
	ram: number;
	/** Simultaneous logins. */
	conc: number;
	fips: boolean;
	/** Whether the stack has an Argon2id library. */
	argon: boolean;
}

const PRESETS: [id: string, name: string, Deployment][] = [
	["small", "Small VM", { ram: 128, conc: 16, fips: false, argon: true }],
	["tiny", "Tiny container", { ram: 64, conc: 16, fips: false, argon: true }],
	["roomy", "Roomy server", { ram: 2048, conc: 8, fips: false, argon: true }],
	["fips", "FIPS customer", { ram: 256, conc: 8, fips: true, argon: true }],
	["noargon", "No Argon2id library", { ram: 1024, conc: 4, fips: false, argon: false }],
];

const fmtMiB = (n: number) => `${Math.round(n * 10) / 10} MiB`;
/** Budgets round down, so a budget just under a threshold never reads as meeting it. */
const fmtBudget = (n: number) => `${Math.floor(n * 10) / 10} MiB`;

/** The OWASP line to use: the summary line if it fits the budget, else the most memory that fits; undefined if none. */
function pick<T extends { mib: number; lead: boolean }>(list: T[], budget: number) {
	const fit = list.filter((s) => s.mib <= budget);
	return fit.find((s) => s.lead) ?? fit.sort((a, b) => b.mib - a.mib)[0];
}

interface Plan {
	algo: string;
	setting: string;
	mem: string;
	/** The chart row of the chosen setting. */
	pick?: string;
	why: string;
}

const FIPS_PLAN: Plan = {
	algo: "PBKDF2-HMAC-SHA256",
	setting: "600,000 iterations",
	mem: "no memory-cost parameter",
	why: "FIPS-140 is required, and PBKDF2 is the algorithm the cheat sheet names for it. PBKDF2 has no memory-cost parameter and is not memory-hard, so the budget does not choose its setting, though it still needs some working memory. FIPS 140 validates modules in an approved configuration: confirm your module covers PBKDF2 with HMAC-SHA-256. If FIPS applies only to some deployments, the others can still use Argon2id.",
};

function plan(d: Deployment, budget: number): Plan {
	if (d.fips) {
		return FIPS_PLAN;
	}
	const a = d.argon ? pick(ARGON, budget) : undefined;
	if (a) {
		const more = a.lead
			? "With more memory to spare, 46 MiB with t=1 is equally strong per OWASP and needs fewer passes."
			: "This is the largest Argon2id line that fits; the 19 MiB, t=2 line in OWASP's summary does not.";
		return {
			algo: "Argon2id",
			setting: argonLabel(a),
			mem: fmtMiB(a.mib),
			pick: `argon-${a.mib}`,
			why: `${more} Benchmark it: a login should generally take under a second.`,
		};
	}
	const s = d.argon ? undefined : pick(SCRYPT, budget);
	if (s) {
		return {
			algo: "scrypt",
			setting: scryptLabel(s),
			mem: fmtMiB(s.mib),
			pick: `scrypt-${s.mib}`,
			why: "Argon2id is not available, so OWASP's next choice is scrypt. This is the largest scrypt line that fits.",
		};
	}
	const [name, list] = d.argon ? ["Argon2id", ARGON] : ["scrypt", SCRYPT];
	const need = Math.min(...list.map((s) => s.mib));
	return {
		algo: "Nothing fits",
		setting: `needs at least ${need} MiB`,
		mem: `${fmtBudget(budget)} available`,
		why: `The smallest OWASP ${name} line needs ${need} MiB per login. Raise the budget or queue logins so fewer hash at once. PBKDF2 has no memory-cost parameter, but OWASP names it only for FIPS-140 cases, so using it here is a judgement call (inferred), not an OWASP recommendation.`,
	};
}

/** The chart's bars: every Argon2id line, then every scrypt line; a click opens the algorithm's view. */
const ROWS = [
	...ARGON.map((s) => ({
		id: `argon-${s.mib}`,
		name: `Argon2id t=${s.t}`,
		mib: s.mib,
		tip: argonLabel(s),
		view: "argon2id",
	})),
	...SCRYPT.map((s) => ({
		id: `scrypt-${s.mib}`,
		name: `scrypt N=2^${s.logN}`,
		mib: s.mib,
		tip: scryptLabel(s),
		view: "scrypt",
	})),
];
const FIT = "color-mix(in srgb, var(--accent) 38%, transparent)";
/** The x axis ends here; a budget above it draws no line. */
const AXIS_MAX = 150;

function budgetOption(d: Deployment, budget: number, chosen: string | undefined): ChartOption {
	const usable = (r: (typeof ROWS)[number]) =>
		!d.fips && r.mib <= budget && (d.argon || r.view !== "argon2id");
	const colour = (r: (typeof ROWS)[number]) => {
		if (!usable(r)) {
			return "var(--rule-strong)";
		}
		return r.id === chosen ? "var(--accent)" : FIT;
	};
	return {
		grid: { top: 16, left: 8, right: 64, bottom: 8 },
		tooltip: { trigger: "item" },
		xAxis: {
			type: "value",
			min: 0,
			max: AXIS_MAX,
			axisLabel: { formatter: "{value} MiB", hideOverlap: true },
		},
		yAxis: { type: "category", inverse: true, data: ROWS.map((r) => r.name) },
		series: [
			{
				id: "presets",
				type: "bar",
				barWidth: "58%",
				cursor: "pointer",
				label: { show: true, position: "right", formatter: "{c} MiB" },
				data: ROWS.map((r) => ({
					value: r.mib,
					itemStyle: { color: colour(r) },
					tooltip: { formatter: `${r.tip}<br>${r.mib} MiB` },
				})),
				markLine: {
					silent: true,
					symbol: "none",
					lineStyle: { color: "var(--accent)", type: "dashed" },
					label: { show: false },
					data: budget <= AXIS_MAX ? [{ xAxis: budget }] : [],
				},
			},
		],
	};
}

/** A click on a bar opens that algorithm's view. */
const openView = (chart: ECharts) =>
	chart.on("click", (p) => {
		const row = ROWS[p.dataIndex];
		if (row) {
			location.hash = `#algo/${row.view}`;
		}
	});

/**
 * The presets, sliders and switches that describe the reader's deployment. `set` merges a change into the latest state:
 * restoring a reload fires every control's event before the next render, so a merge into `d` would undo the earlier ones.
 */
function DeploymentControls({
	d,
	set,
}: {
	d: Deployment;
	set: (change: Partial<Deployment>) => void;
}) {
	return (
		<>
			<div class="controls">
				<fieldset class="presets" aria-label="Example deployments">
					<span class="label">Try</span>
					{PRESETS.map(([id, name, preset]) => (
						<button type="button" class="btn" data-preset={id} onClick={() => set(preset)}>
							{name}
						</button>
					))}
				</fieldset>
			</div>
			<div class="controls">
				<label class="field">
					<span>Spare memory for hashing</span>
					<input
						type="range"
						id="ram"
						min="64"
						max="2048"
						step="32"
						value={d.ram}
						onInput={(e) => set({ ram: Number(e.currentTarget.value) })}
					/>
					<output for="ram">{d.ram} MiB</output>
				</label>
				<label class="field">
					<span>Simultaneous logins</span>
					<input
						type="range"
						id="conc"
						min="1"
						max="64"
						value={d.conc}
						onInput={(e) => set({ conc: Number(e.currentTarget.value) })}
					/>
					<output for="conc">{d.conc}</output>
				</label>
			</div>
			<div class="controls">
				<label class="toggle">
					<input
						type="checkbox"
						id="fips"
						checked={d.fips}
						onChange={(e) => set({ fips: e.currentTarget.checked })}
					/>
					<span>A customer requires FIPS-140 validated cryptography</span>
				</label>
				<label class="toggle">
					<input
						type="checkbox"
						id="argon-ok"
						checked={d.argon}
						onChange={(e) => set({ argon: e.currentTarget.checked })}
					/>
					<span>Our stack has an Argon2id library</span>
				</label>
			</div>
		</>
	);
}

/** The first screen's figure: the deployment, the setting it leads to, and every setting against the budget. */
export function Budget() {
	const [d, setD] = useState<Deployment>({ ram: 256, conc: 8, fips: false, argon: true });
	const budget = d.ram / d.conc;
	const result = plan(d, budget);
	const option = useMemo(() => budgetOption(d, budget, result.pick), [d, budget, result.pick]);
	return (
		<figure class="fig">
			<DeploymentControls d={d} set={(change) => setD((was) => ({ ...was, ...change }))} />
			<dl class="stats" aria-live="polite">
				<div class="stat">
					<dt>Memory per login available</dt>
					<dd>{fmtBudget(budget)}</dd>
				</div>
				<div class="stat">
					<dt>Choice</dt>
					<dd>{result.algo}</dd>
				</div>
				<div class="stat">
					<dt>OWASP setting</dt>
					<dd>{result.setting}</dd>
				</div>
				<div class="stat">
					<dt>Nominal algorithm memory</dt>
					<dd>{result.mem}</dd>
				</div>
			</dl>
			<p class="verdict-note">{result.why}</p>
			<Chart
				id="budget-chart"
				label="Memory needed by each OWASP Argon2id and scrypt setting, against the memory available per login"
				option={option}
				setup={openView}
			/>
			<figcaption>
				Dark: the setting chosen. Light: also fits. Grey: not usable here (too much memory for one
				login, FIPS-140 required, or no library). The dashed line is spare memory divided by
				simultaneous logins (not drawn above {AXIS_MAX} MiB); capping simultaneous hashes with a
				queue is your design choice, not an OWASP setting. Memory figures are the algorithm's
				nominal allocation, not process memory: library overhead adds to it, so measure real use on
				your own stack. Click a bar to open that algorithm.
				<span class="src">
					Settings: OWASP Password Storage Cheat Sheet. Each Argon2id row gives equal defence per
					OWASP, and so does each scrypt row; they trade memory against CPU time.
				</span>
			</figcaption>
		</figure>
	);
}
