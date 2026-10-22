/**
 * Entry for the custom ECharts bundle (`bun run vendor`). Only the charts and components listed here
 * ship in kit/echarts.js; to offer another one, import and register it here, then rebuild.
 * Exposes the usual global `echarts` (core API plus `echarts.connect`, `echarts.registerTheme`).
 */
import { BarChart, BoxplotChart, HeatmapChart, LineChart, PieChart, RadarChart, SankeyChart, ScatterChart, SunburstChart, TreemapChart } from "echarts/charts";
import {
	AriaComponent, AxisPointerComponent, BrushComponent, CalendarComponent, DataZoomComponent, DatasetComponent,
	GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, MarkPointComponent, PolarComponent,
	RadarComponent, TitleComponent, ToolboxComponent, TooltipComponent, TransformComponent, VisualMapComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { LabelLayout, UniversalTransition } from "echarts/features";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
	BarChart, BoxplotChart, HeatmapChart, LineChart, PieChart, RadarChart, SankeyChart, ScatterChart, SunburstChart, TreemapChart,
	AriaComponent, AxisPointerComponent, BrushComponent, CalendarComponent, DataZoomComponent, DatasetComponent,
	GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, MarkPointComponent, PolarComponent,
	RadarComponent, TitleComponent, ToolboxComponent, TooltipComponent, TransformComponent, VisualMapComponent,
	LabelLayout, UniversalTransition, CanvasRenderer,
]);

Object.assign(globalThis, { echarts });
