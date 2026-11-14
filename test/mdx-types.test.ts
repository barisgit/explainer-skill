import { afterAll, expect, test } from "bun:test";
import { cpSync } from "node:fs";
import { SKILL_DIR, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/** Executes the author's commands outside the repository, with a copy of the skill and no node_modules. */
async function run(args: string[]) {
	const proc = Bun.spawn([process.execPath, ...args], {
		cwd: dir.path("page"),
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, code };
}

test("kit types checks a nested page despite a repository check script, without installs or unrelated source checks", async () => {
	cpSync(SKILL_DIR, dir.path("skill"), { recursive: true });
	dir.write(
		"package.json",
		JSON.stringify({ scripts: { check: "echo REPOSITORY_CHECK_RAN_INSTEAD" } }),
	);
	const write = (path: string, content: string) => dir.write(`page/${path}`, content);
	write(
		"page.mdx",
		'import { Figure } from "./figure.tsx";\nimport { start } from "./data.ts";\n\n# Page\n\n<Figure start={start} />\n',
	);
	write("data.ts", 'import plan from "./plan.json";\nexport const start: number = plan.start;\n');
	write("plan.json", '{ "start": 1 }');
	// What authors keep beside a page: a Bun script that prepares the data, and a scratch file with errors of its own.
	write(
		"prepare.ts",
		'await Bun.write("plan.json", JSON.stringify({ start: Number(process.argv[2] ?? 1) }));\n',
	);
	write(
		"scratch/probe.ts",
		'const probe: number = "not checked";\nconsole.log(probe, Bun.version);\n',
	);
	const good = `"use client";
import { Chart, Explore, Plot, Question, Records, type RecordsProps, Stepper, Table, View } from "kit";
import { useState } from "preact/hooks";
import { start as first } from "./data.ts";
const option: PlotOption = { series: [{ type: "line", data: [[0, 1]] }] };
const plan = {
  id: "plan", idField: "id", data: [{ id: "A", phase: "One", hours: 2 }],
  fields: { id: { label: "Task", kind: "text" }, phase: { label: "Phase", kind: "category", values: [{ value: "One", color: "var(--c1)" }] }, hours: { label: "Hours", kind: "number", unit: "h", sum: true } },
  columns: ["id", "hours"], groupBy: ["phase"], views: ["tree", "table"], sort: { field: "hours", desc: true },
} satisfies RecordsProps;
const chart: ChartOption = { series: [{ type: "bar", data: [1] }] };
export function Figure({ start = first }: { start?: number }) {
  const [count, setCount] = useState(start);
  return <><button onClick={() => setCount(count + 1)}>{count}</button>
    <Chart option={chart} label="Values" setup={(instance) => instance.resize()} />
    <Plot option={option} label="Values" />
    <Explore label="Values" controls={[{ id: "on", label: "On", toggle: true }]} frame={(on: boolean) => ({ plot: option, readout: on ? <b>On</b> : "Off" })} />
    <Question name="q" legend="Pick" options={["a", "b"]} />
    <Stepper captions={["One", "Two"]}><p data-step="1">One</p></Stepper>
    <Records {...plan} />
    <Table rows={[{ name: "A", share: 0.5 }]} cols={[{ head: "Name", value: "name", link: (r) => \`#\${r.name}\` }, { head: "Share", value: "share", format: { percent: true } }]} />
    <View name="detail"><h1>Detail</h1></View></>;
}
`;
	write("figure.tsx", good);
	const config = await run(["../skill/cli.ts", "kit", "types"]);
	expect(config.code).toBe(0);
	expect(config.stderr).toContain("figure.tsx");
	expect(config.stderr).toContain("bun --check");
	write("tsconfig.json", config.stdout);
	const checked = await run(["--check"]);
	expect(checked.stdout + checked.stderr).not.toContain("error TS");
	expect(checked.code).toBe(0);
	expect(checked.stdout + checked.stderr).not.toContain("REPOSITORY_CHECK_RAN_INSTEAD");
	write(
		"figure.tsx",
		`${good}\nconst badNumber: number = "wrong";\nconst bad: PlotOption = { series: [{ data: ["wrong"] }] };\nconst wrong = <Records {...plan} cell="4rem" />;\n`,
	);
	const failed = await run(["--check"]);
	expect(failed.code).not.toBe(0);
	expect(failed.stdout + failed.stderr).toContain(
		"Type 'string' is not assignable to type 'number'",
	);
	expect(failed.stdout + failed.stderr).toContain("cell");
	expect(failed.stdout + failed.stderr).not.toContain("prepare.ts");
	expect(failed.stdout + failed.stderr).not.toContain("probe.ts");
}, 30_000);

test("the vendored kit declarations that kit types points authors at match kit-types/globals.d.ts (bun run vendor copies them)", async () => {
	const source = await Bun.file(`${import.meta.dir}/../kit-types/globals.d.ts`).text();
	expect(await Bun.file(`${SKILL_DIR}/vendor/types/globals.d.ts`).text()).toBe(source);
});
