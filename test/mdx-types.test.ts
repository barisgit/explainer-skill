import { afterAll, expect, test } from "bun:test";
import { cpSync } from "node:fs";
import { SKILL_DIR, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/** Executes the author's commands outside the repository, with a copy of the skill and no node_modules. */
async function run(args: string[]) {
	const proc = Bun.spawn([process.execPath, ...args], {
		cwd: dir.path(""),
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

test("kit types makes an external author's TSX typecheck without installed dependencies, and catches bad props and plot data", async () => {
	cpSync(SKILL_DIR, dir.path("skill"), { recursive: true });
	const config = await run(["skill/cli.ts", "kit", "types"]);
	expect(config.code).toBe(0);
	dir.write("tsconfig.json", config.stdout);
	const good = `"use client";
import { Chart, Explore, Plot, Question, Stepper, Table, Tree, View } from "kit";
import { useState } from "preact/hooks";
const option: PlotOption = { series: [{ type: "line", data: [[0, 1]] }] };
const chart: ChartOption = { series: [{ type: "bar", data: [1] }] };
export function Figure() {
  const [count, setCount] = useState(0);
  return <><button onClick={() => setCount(count + 1)}>{count}</button>
    <Chart option={chart} label="Values" setup={(instance) => instance.resize()} />
    <Plot option={option} label="Values" />
    <Explore label="Values" controls={[{ id: "on", label: "On", toggle: true }]} frames={[{ plot: option }, { plot: option, readout: <b>On</b> }]} />
    <Question name="q" legend="Pick" options={["a", "b"]} />
    <Stepper captions={["One", "Two"]}><p data-step="1">One</p></Stepper>
    <Tree cols="4rem" head={["Task", "Hours"]} items={[{ label: "A", cells: [1], text: "Full" }]} />
    <Table rows={[{ name: "A", share: 0.5 }]} cols={[{ head: "Name", value: "name", link: (r) => \`#\${r.name}\` }, { head: "Share", value: "share", format: { percent: true } }]} />
    <View name="detail"><h1>Detail</h1></View></>;
}
`;
	dir.write("figure.tsx", good);
	const checked = await run(["check", "--no-pretty", "--all"]);
	expect(checked.stdout + checked.stderr).not.toContain("error TS");
	expect(checked.code).toBe(0);
	dir.write(
		"figure.tsx",
		`${good}\nconst bad: PlotOption = { series: [{ data: ["wrong"] }] };\nconst wrong = <Tree items={[]} cell="4rem" />;\n`,
	);
	const failed = await run(["check", "--no-pretty", "--all"]);
	expect(failed.code).not.toBe(0);
	expect(failed.stdout + failed.stderr).toContain("'string' is not assignable");
	expect(failed.stdout + failed.stderr).toContain("cell");
}, 30_000);
