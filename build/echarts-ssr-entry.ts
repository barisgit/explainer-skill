/**
 * Entry for vendor/echarts-ssr.js (`bun run vendor`): the charts and components of echarts-charts.ts with the SVG renderer, as
 * an ES module for pack, which draws each chart into the page as SVG with it (skills/explainer/src/mdx/draw.ts). Never inlined.
 */
import { SVGRenderer } from "echarts/renderers";
import { echarts } from "./echarts-charts.ts";

echarts.use([SVGRenderer]);

export const { init, setPlatformAPI } = echarts;
