import { afterAll, test } from "bun:test";
import { packAndCheck, pageAssertion, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const contract = (name: string, body: string) => pageAssertion("charts contract", name, body);

/** A bar series whose data starts with a plain number and then has an item with a token colour. */
const PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><main><h1>Charts</h1><div class="chart" id="c"></div></main>
<script src="kit:echarts.js"></script><script src="kit:charts.js"></script>
<script>
const handle = Charts.make(document.getElementById("c"), {
	xAxis: { type: "category", data: ["a", "b"] },
	yAxis: { type: "value" },
	series: [{ type: "bar", data: [1, { value: 2, itemStyle: { color: "var(--c3)" } }] }],
});
const itemColor = () => handle.chart?.getOption().series[0].data[1].itemStyle.color;
${contract("a token colour resolves in an item after a plain number", `/^rgba?\\(/.test(itemColor())`)}
</script></body></html>`;

test("colour tokens resolve in any element of a series' data, not only when it starts with an object", async () => {
	await packAndCheck(dir, "mixed", PAGE, "charts contract", ["--view", "none"]);
}, 30_000);
