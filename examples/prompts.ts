/* The question each example answers, read from its own prompt.md so the gallery never carries a copy. */
import battery from "./battery/prompt.md" with { type: "text" };
import dijkstra from "./dijkstra/prompt.md" with { type: "text" };
import echarts from "./echarts-compressed/prompt.md" with { type: "text" };
import electricity from "./electricity-mix/prompt.md" with { type: "text" };
import fourier from "./fourier-series/prompt.md" with { type: "text" };
import i2c from "./i2c-pull-ups/prompt.md" with { type: "text" };
import modules from "./node-modules/prompt.md" with { type: "text" };

export const prompts = { battery, dijkstra, echarts, electricity, fourier, i2c, modules };
