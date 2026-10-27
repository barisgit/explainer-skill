/**
 * Entry for kit/echarts.js (`bun run vendor`): the charts and components of echarts-charts.ts with the canvas renderer, as the
 * usual global `echarts` (core API plus `echarts.connect`, `echarts.registerTheme`).
 */
import { CanvasRenderer } from "echarts/renderers";
import { echarts } from "./echarts-charts.ts";

echarts.use([CanvasRenderer]);

Object.assign(globalThis, { echarts });
