/* unpack: pack's loader for a compressed script, the ECharts runtime; pages never name it. The script element it sits in has the base64 of
   the deflate-raw bytes in data-deflate. The loader inflates them with DecompressionStream and runs the text as a classic script, so
   the globals it defines (echarts) appear as if the page had carried it plain. window.echartsReady is the promise of that: it
   resolves once echarts exists and rejects if the browser cannot unpack, leaving the charts pack drew where they are. */
(() => {
	const packed = document.currentScript?.getAttribute("data-deflate") ?? "";

	async function unpack(): Promise<void> {
		const bytes = Uint8Array.from(atob(packed), (char) => char.charCodeAt(0));
		const inflated = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
		const script = document.createElement("script");
		script.text = await new Response(inflated).text();
		// A script element runs when it is inserted, in the page's global scope, as the plain tag would.
		document.head.append(script);
		script.remove();
	}

	window.echartsReady = unpack();
})();
