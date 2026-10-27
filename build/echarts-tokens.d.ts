/** ECharts ships its tokens module without types beside it; these are the ones it ships under types/. */
declare module "echarts/lib/visual/tokens.js" {
	const tokens: typeof import("echarts/types/src/visual/tokens.js").default;
	export default tokens;
}
