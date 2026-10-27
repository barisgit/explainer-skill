/**
 * The charts and components both ECharts bundles register (`bun run vendor`): kit/echarts.js, which draws in the browser, and
 * vendor/echarts-ssr.js, which pack draws each chart into the page with. Only those listed here ship; to offer another one,
 * import and register it here, then rebuild. Each entry adds its renderer.
 */
import {
	BarChart,
	BoxplotChart,
	HeatmapChart,
	LineChart,
	PieChart,
	RadarChart,
	SankeyChart,
	ScatterChart,
	SunburstChart,
	TreemapChart,
} from "echarts/charts";
import {
	AriaComponent,
	AxisPointerComponent,
	BrushComponent,
	CalendarComponent,
	DatasetComponent,
	DataZoomComponent,
	GridComponent,
	LegendComponent,
	MarkAreaComponent,
	MarkLineComponent,
	MarkPointComponent,
	PolarComponent,
	RadarComponent,
	TitleComponent,
	ToolboxComponent,
	TooltipComponent,
	TransformComponent,
	VisualMapComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { LabelLayout, UniversalTransition } from "echarts/features";

echarts.use([
	BarChart,
	BoxplotChart,
	HeatmapChart,
	LineChart,
	PieChart,
	RadarChart,
	SankeyChart,
	ScatterChart,
	SunburstChart,
	TreemapChart,
	AriaComponent,
	AxisPointerComponent,
	BrushComponent,
	CalendarComponent,
	DataZoomComponent,
	DatasetComponent,
	GridComponent,
	LegendComponent,
	MarkAreaComponent,
	MarkLineComponent,
	MarkPointComponent,
	PolarComponent,
	RadarComponent,
	TitleComponent,
	ToolboxComponent,
	TooltipComponent,
	TransformComponent,
	VisualMapComponent,
	LabelLayout,
	UniversalTransition,
]);

export { echarts };
