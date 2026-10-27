/**
 * Entry for vendor/echarts-ssr.js (`bun run vendor`): the charts and components of echarts-charts.ts with the SVG renderer, as
 * an ES module for pack, which draws each chart into the page as SVG with it (skills/explainer/src/mdx/draw.ts). Never inlined.
 */
import tokens from "echarts/lib/visual/tokens.js";
import { SVGRenderer } from "echarts/renderers";
import { echarts } from "./echarts-charts.ts";

echarts.use([SVGRenderer]);

export const { init, setPlatformAPI } = echarts;

/** The colours of ECharts' own look (its light tokens), which it draws as they are where an option sets none. */
export const ownColors: string[] = Object.values(tokens.color).flat();
