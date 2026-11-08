import { afterAll, expect, test } from "bun:test";
import { withTestPage } from "./browser.ts";
import { packedMdx, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

test("the shared text metric intentionally sets title and grid geometry without a legend", async () => {
	const path = await packedMdx(
		dir,
		"no-legend-metrics",
		`import { Chart } from "kit";

# No legend

<Chart id="plain" height="520px" label="No legend" option={{ textStyle: { fontSize: 18 }, title: { text: "First\\nSecond", textStyle: { fontSize: 18 } }, xAxis: { type: "category", data: ["a", "b"], axisLabel: { fontSize: 18 } }, yAxis: { axisLabel: { fontSize: 18 } }, series: [{ type: "bar", data: [1, 3] }] }} />
`,
	);
	const geometry = await withTestPage(async (cdp) => {
		await Promise.all(["Page", "Runtime"].map((domain) => cdp.send(`${domain}.enable`)));
		await cdp.send("Emulation.setScriptExecutionDisabled", { value: true });
		await cdp.load(`file://${path}`);
		return cdp.evaluate(`(() => {
			const svg = document.querySelector('#plain svg[data-fit="phone"]');
			svg.style.display = "block";
			const texts = [...svg.querySelectorAll("text")];
			const y = name => texts.find(text => text.textContent === name).getBBox().y;
			const bars = [...svg.querySelectorAll('path[style*="fill:var(--c1)"]')];
			return { advance: y("Second") - y("First"), gridHeight: Math.max(...bars.map(bar => bar.getBBox().height)) };
		})()`);
	});
	expect(geometry).toEqual({ advance: 18, gridHeight: 340 });
}, 30_000);
