/* Spike: screenshots each figure of a packed page with scripts disabled, to show what the HTML carries before hydration.
   bun spike/nojs.ts <page.html> <out-dir> <selector>... */
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { settle, withPage } from "../skills/explainer/src/chrome.ts";

const [page, out, ...selectors] = process.argv.slice(2);
if (!(page && out && selectors.length)) {
	throw new Error("usage: bun spike/nojs.ts <page.html> <out-dir> <selector>...");
}

interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

await withPage(async (cdp) => {
	await cdp.send("Emulation.setScriptExecutionDisabled", { value: true });
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		width: 1200,
		height: 900,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await cdp.send("Page.enable");
	const loaded = cdp.once("Page.loadEventFired");
	await cdp.send("Page.navigate", { url: `file://${resolve(page)}` });
	await loaded;
	await settle(300);
	for (const [i, selector] of selectors.entries()) {
		const { root } = await cdp.send<{ root: { nodeId: number } }>("DOM.getDocument");
		const { nodeId } = await cdp.send<{ nodeId: number }>("DOM.querySelector", {
			nodeId: root.nodeId,
			selector,
		});
		if (!nodeId) {
			console.log(`${selector}: not found`);
			continue;
		}
		const { model } = await cdp.send<{ model: { border: number[] } }>("DOM.getBoxModel", {
			nodeId,
		});
		const [x0 = 0, y0 = 0, x1 = 0, , , y2 = 0] = model.border;
		const clip: Box & { scale: number } = {
			x: x0,
			y: y0,
			width: x1 - x0,
			height: y2 - y0,
			scale: 1,
		};
		const { data } = await cdp.send<{ data: string }>("Page.captureScreenshot", {
			format: "png",
			clip,
			captureBeyondViewport: true,
		});
		const file = join(out, `nojs-${i + 1}.png`);
		writeFileSync(file, Buffer.from(data, "base64"));
		console.log(`${selector}: ${file}`);
	}
});
