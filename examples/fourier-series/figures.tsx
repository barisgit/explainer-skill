"use client";
/* The page's interactive parts. Each section whose heading follows its controls renders that heading too; everything else on
   the page is rendered once when it packs (page.mdx). */
import { Chart, Plot, Stepper } from "kit";
import { useLayoutEffect, useMemo, useState } from "preact/hooks";
import { Seg, Slider, Toggle } from "./controls.tsx";
import { DERIVATIONS } from "./derivations.tsx";
import {
	coefficient,
	fixed,
	LIMIT,
	linspace,
	MINUS,
	partial,
	pct,
	peak,
	piLabel,
	SYMS,
	type SymName,
	survivors,
	symGrid,
	WAVES,
	type Wave,
	type WaveName,
} from "./fourier.ts";

const PI = Math.PI;
const WAVE_NAMES = { square: "Square wave", saw: "Sawtooth" } as const;
/** What an axis pointer label formatter receives. */
type Pointer = { value: number };

/* ---- 1. Hero: build a wave from sines ---- */
const PARTS_SHOWN = 8;
const heroGrid = linspace(-2 * PI, 2 * PI, 1400);
const terms = (k: number) => `${k} ${k === 1 ? "term" : "terms"}`;

function heroOption(wave: Wave, k: number, withParts: boolean): ChartOption {
	const sumName = `Sum of ${terms(k)}`;
	const parts = withParts
		? Array.from({ length: Math.min(k, PARTS_SHOWN) }, (_, j) => {
				const n = wave.harmonic(j + 1);
				return {
					id: `part${j}`,
					name: `${n}× sine`,
					type: "line",
					showSymbol: false,
					silent: true,
					lineStyle: { width: 1.2, opacity: 0.75 },
					z: 1,
					data: heroGrid.map((x) => [x, wave.coef(n) * Math.sin(n * x)]),
				};
			})
		: [];
	return {
		grid: { top: 44, left: 8, right: 24, bottom: 8 },
		legend: { top: 8, left: 8, data: ["Target", sumName] },
		tooltip: {
			trigger: "axis",
			valueFormatter: (y: number) => fixed(y, 3),
			axisPointer: { label: { formatter: (p: Pointer) => `${fixed(p.value / PI)}π` } },
		},
		xAxis: {
			type: "value",
			min: -2 * PI,
			max: 2 * PI,
			interval: PI,
			axisLabel: { formatter: piLabel },
		},
		yAxis: { type: "value", min: -wave.yLim, max: wave.yLim, interval: wave.yStep },
		dataZoom: [{ type: "inside", xAxisIndex: 0, filterMode: "none" }],
		series: [
			{
				id: "target",
				name: "Target",
				type: "line",
				showSymbol: false,
				silent: true,
				color: "var(--muted)",
				lineStyle: { type: "dashed", width: 1.6 },
				data: wave.target,
				z: 2,
			},
			...parts,
			{
				id: "sum",
				name: sumName,
				type: "line",
				showSymbol: false,
				color: "var(--accent)",
				lineStyle: { width: 2.6 },
				z: 3,
				data: heroGrid.map((x) => [x, partial(wave, k, x)]),
			},
		],
	};
}

/** The first screen's figure: pick a wave and a number of terms, see the sum, its peak, and optionally each sine. */
export function Hero() {
	const [name, setName] = useState<WaveName>("square");
	const [k, setK] = useState(3);
	const [withParts, setWithParts] = useState(false);
	const wave = WAVES[name];
	const option = useMemo(() => heroOption(wave, k, withParts), [wave, k, withParts]);
	const best = peak(wave, k);
	const above = (best - wave.top) / wave.jump;
	const partsNote = withParts
		? `Thin lines: the first ${Math.min(k, PARTS_SHOWN)} sines of the sum, each at its own amplitude. `
		: "";
	return (
		<figure class="fig">
			<div class="controls">
				<Seg
					name="wave"
					label="Signal to build"
					options={WAVE_NAMES}
					value={name}
					onChange={setName}
				/>
				<Slider id="terms" label="Terms in the sum" max={40} value={k} onInput={setK} />
				<Toggle id="parts" label="Show each sine" on={withParts} onChange={setWithParts} />
			</div>
			<dl class="stats" aria-live="polite">
				<div class="stat">
					<dt>Highest frequency used</dt>
					<dd>
						{wave.harmonic(k)}× <small>base frequency</small>
					</dd>
				</div>
				<div class="stat">
					<dt>Highest point of the sum</dt>
					<dd>
						{fixed(best, 3)} <small>target {fixed(wave.top, name === "saw" ? 2 : 0)}</small>
					</dd>
				</div>
				<div class="stat">
					<dt>Highest point vs target, share of the jump</dt>
					<dd>
						{above < 0 ? MINUS : "+"}
						{pct(Math.abs(above))}
					</dd>
				</div>
			</dl>
			<Chart
				id="hero-chart"
				label="A square wave or sawtooth and the sum of its first sines, over two periods"
				option={option}
			/>
			<figcaption>
				Dashed: the {wave.name.toLowerCase()} to build. Solid: the sum. {partsNote}Horizontal axis
				in radians, one period is 2π. Scroll or pinch to zoom.
			</figcaption>
		</figure>
	);
}

/* ---- 2. Coefficients: a derivation to step through, with the resulting b_n ---- */

/** The value printed on a stem: (x, y) => text. */
const stemLabel = (_: number, y = 0) => (y === 0 ? "0" : fixed(y));

function coefOption(name: WaveName): PlotOption {
	const wave = WAVES[name];
	const data = Array.from({ length: 12 }, (_, i): [number, number] => {
		const n = i + 1;
		return [n, name === "saw" || n % 2 === 1 ? wave.coef(n) : 0];
	});
	return {
		series: [
			{
				name: "b",
				type: "stem",
				data,
				color: "var(--accent)",
				label: stemLabel,
			},
		],
		x: { min: 0, max: 13, step: 1, name: "harmonic n" },
		y: name === "square" ? { min: 0, max: 1.6 } : { min: -1.4, max: 2.4 },
		legend: false,
	};
}

/** The coefficients section: its heading, the derivation stepper for the chosen wave, and the b_n it ends with. */
export function Coefficients() {
	const [name, setName] = useState<WaveName>("square");
	const steps = DERIVATIONS[name];
	const option = useMemo(() => coefOption(name), [name]);
	// Another wave is another derivation: start it from its first line. Before steps.js has loaded (hydration) there is nothing to restart.
	useLayoutEffect(() => {
		const figure = document.getElementById("deriv-fig");
		if (figure && typeof Steps !== "undefined") {
			Steps.refresh(figure, 1);
		}
	}, [name]);
	return (
		<>
			<h2>
				{name === "square"
					? "Square wave: only odd harmonics, amplitudes 4/(nπ)"
					: "Sawtooth: every harmonic, amplitudes 2/n with alternating sign"}
			</h2>
			<p>
				Pick a wave and step through its integral, one line at a time. Both waves are odd, so the
				cosine integrals vanish at once and only the sine integral takes work.
			</p>
			<Stepper
				id="deriv-fig"
				start={1}
				label="Derivation of the Fourier coefficients, step by step"
			>
				<div class="controls">
					<Seg
						name="coef"
						label="Wave to derive"
						options={WAVE_NAMES}
						value={name}
						onChange={setName}
					/>
				</div>
				{/* The captions sit between the switch and the maths, so steps.js puts the player there. */}
				<ol data-captions="">
					{steps.map((s) => (
						<li>{s.caption}</li>
					))}
				</ol>
				<div class="eqs">
					{steps.map((s, i) => (
						<p class="eq" data-step={i + 1}>
							{s.eq}
						</p>
					))}
				</div>
				<Plot id="coef-plot" label="The sine coefficients b-n for n from 1 to 12" option={option} />
				<figcaption>
					The sine coefficients <i>b</i>
					<sub>
						<i>n</i>
					</sub>
					, first twelve. Square wave: ±1 jumps at 0 and ±π. Sawtooth: <i>f</i>(<i>x</i>) = <i>x</i>{" "}
					on (−π, π), repeating, with jumps at ±π.
				</figcaption>
			</Stepper>
		</>
	);
}

/* ---- 3. Gibbs: the bump keeps its height ---- */
const square = WAVES.square;
const gGrid = linspace(-1.6, 1.6, 2400);
const peakData = Array.from({ length: 200 }, (_, i) => [i + 1, peak(square, i + 1)]);
const rule = (y: number, label: string, type: string) => ({
	yAxis: y,
	lineStyle: { type, color: "var(--muted)" },
	label: { formatter: label, position: "insideEndTop", color: "var(--muted)" },
});
const dot = (coord: number[], size: number) => ({
	symbol: "circle",
	symbolSize: size,
	itemStyle: { color: "var(--accent)" },
	label: { show: false },
	data: [{ coord }],
});

function gibbsOption(k: number, zoom: boolean): ChartOption {
	return {
		grid: { top: 24, left: 8, right: 24, bottom: 8 },
		tooltip: {
			trigger: "axis",
			valueFormatter: (y: number) => fixed(y, 3),
			axisPointer: { label: { formatter: (p: Pointer) => `x = ${fixed(p.value, 3)}` } },
		},
		xAxis: {
			type: "value",
			interval: 0.4,
			axisLabel: { formatter: (x: number) => fixed(x, 1).replace(".0", "") },
			...(zoom ? { min: 0, max: 1.6 } : { min: -1.6, max: 1.6 }),
		},
		yAxis: { type: "value", ...(zoom ? { min: 0.8, max: 1.3 } : { min: -1.4, max: 1.4 }) },
		series: [
			{
				id: "target",
				name: "Square wave",
				type: "line",
				showSymbol: false,
				silent: true,
				color: "var(--muted)",
				lineStyle: { type: "dashed", width: 1.6 },
				data: [
					[-1.6, -1],
					[0, -1],
					[0, 1],
					[1.6, 1],
				],
			},
			{
				id: "sum",
				name: `Sum of ${k} terms`,
				type: "line",
				showSymbol: false,
				color: "var(--accent)",
				lineStyle: { width: 2.4 },
				z: 3,
				data: gGrid.map((x) => [x, partial(square, k, x)]),
				markLine: { silent: true, symbol: "none", data: [rule(LIMIT, "limit 1.179", "dotted")] },
				markPoint: dot([square.bumpAt(k), peak(square, k)], 11),
			},
		],
	};
}

function peakOption(k: number): ChartOption {
	return {
		grid: { top: 24, left: 8, right: 24, bottom: 36 },
		tooltip: { trigger: "axis", valueFormatter: (y: number) => fixed(y, 4) },
		xAxis: {
			type: "log",
			min: 1,
			max: 200,
			name: "terms in the sum",
			nameLocation: "middle",
			nameGap: 28,
			axisLabel: { formatter: "{value}" },
		},
		yAxis: { type: "value", min: 0.9, max: 1.3 },
		series: [
			{
				id: "peak",
				name: "Highest point",
				type: "line",
				showSymbol: false,
				color: "var(--accent)",
				lineStyle: { width: 2.4 },
				data: peakData,
				markLine: {
					silent: true,
					symbol: "none",
					data: [rule(1, "square wave = 1", "dashed"), rule(LIMIT, "limit 1.179", "dotted")],
				},
				markPoint: dot([k, peak(square, k)], 12),
			},
		],
	};
}

/** The mean-square error of the k-term sum (Parseval): what the unused terms would carry. */
function rms(k: number): number {
	let used = 0;
	for (let j = 1; j <= k; j++) {
		used += square.coef(square.harmonic(j)) ** 2 / 2;
	}
	return Math.sqrt(Math.max(0, 1 - used));
}

/** The Gibbs section: its heading, the sum near the jump, and the peak against the number of terms. */
export function Gibbs() {
	const [k, setK] = useState(5);
	const [zoom, setZoom] = useState(false);
	const best = peak(square, k);
	const near = useMemo(() => gibbsOption(k, zoom), [k, zoom]);
	const peaks = useMemo(() => peakOption(k), [k]);
	return (
		<>
			<h2>
				With {terms(k)} the sum peaks at {fixed(best, 3)}; as the number of terms grows, the peak
				approaches 1.179
			</h2>
			<p>
				Here is the square wave from the top, close to its jump at <i>x</i> = 0. Drag the slider
				from 1 term up to 200 and watch two things: the width of the bump and its height.
			</p>
			<figure class="fig">
				<div class="controls">
					<Slider id="gk" label="Terms" max={200} value={k} onInput={setK} />
					<Toggle id="gzoom" label="Zoom in on the bump" on={zoom} onChange={setZoom} />
				</div>
				<dl class="stats" aria-live="polite">
					<div class="stat">
						<dt>Highest point</dt>
						<dd>
							{fixed(best, 3)} <small>wave is 1</small>
						</dd>
					</div>
					<div class="stat">
						<dt>Bump sits at</dt>
						<dd>
							{fixed(square.bumpAt(k), 3)} <small>radians from the jump</small>
						</dd>
					</div>
					<div class="stat">
						<dt>Typical error (rms)</dt>
						<dd>{fixed(rms(k), 3)}</dd>
					</div>
				</dl>
				<Chart
					id="gibbs-chart"
					label="Partial sum of the square wave near its jump at zero, with the target and the limit of the peak"
					option={near}
				/>
				<figcaption>
					Dashed grey: the square wave. Dotted: the limit the peak approaches, 1.179. Horizontal
					axis in radians.
					<span class="src">
						Computed in the page from the series. Peak position and the 9% limit: Wikipedia, “Gibbs
						phenomenon”.
					</span>
				</figcaption>
			</figure>
			<div class="beside">
				<p>
					The bump keeps its height and gets thinner. The typical error falls because the bump takes
					up less and less of the period, so the area under it goes to zero. The largest error does
					not fall: the bump stays, and just beside the jump the sum is still far from the wave.
					That is why the series converges at every fixed point away from the jump (convergence is
					not uniform) while no finite number of terms removes the bump.
				</p>
				<figure class="fig">
					<Chart
						id="peak-chart"
						label="Highest point of the square-wave partial sum against the number of terms, levelling off at 1.179"
						option={peaks}
					/>
					<figcaption>
						Highest point of the partial sum for 1 to 200 terms (logarithmic horizontal axis). It
						does not head for 1; it levels off at 1.179, which is 1 + 0.179, and 0.179 is 8.95% of
						the jump of 2. The sawtooth behaves the same way at its jump.
					</figcaption>
				</figure>
			</div>
		</>
	);
}

/* ---- 4. Symmetry: which coefficients survive ---- */
const SYM_NAMES = {
	even: "Even: triangle",
	odd: "Odd: square wave",
	none: "Neither: half ramp",
} as const;
const piHalves = ["−π", "−π/2", "0", "π/2", "π"];
const A_AXIS = { min: -0.5, max: 9.5, step: 1, name: "aₙ : cosine coefficients" };
const B_AXIS = { min: 0.5, max: 9.5, step: 1, name: "bₙ : sine coefficients" };

/** The chosen signal's coefficients, what its heading says about them, and its three lines. */
function symmetry(key: SymName) {
	const shape = SYMS[key];
	const g = shape.fn;
	const aList = Array.from({ length: 10 }, (_, n): [number, number] => [
		n,
		coefficient(g, Math.cos, n),
	]);
	const bList = Array.from({ length: 9 }, (_, i): [number, number] => [
		i + 1,
		coefficient(g, Math.sin, i + 1),
	]);
	const noCos = aList.every(([, y]) => y === 0);
	const noSin = bList.every(([, y]) => y === 0);
	const heading = noSin
		? `${shape.name} is even, so every sine coefficient is zero`
		: noCos
			? `${shape.name} is odd, so a₀ and every cosine coefficient are zero`
			: `${shape.name} is neither even nor odd, so it needs sines and cosines`;
	const reach = Math.max(...[...aList, ...bList].map(([, y]) => Math.abs(y))) * 1.2;
	const y = { min: -reach, max: reach };
	const stems = (
		name: string,
		data: [number, number][],
		color: string,
		x: AxisSpec,
	): PlotOption => ({
		series: [{ name, type: "stem", data, color, label: stemLabel }],
		x,
		y,
		legend: false,
	});
	const line = (id: string, name: string, color: string, fn: (x: number) => number) => ({
		id,
		name,
		type: "line",
		showSymbol: false,
		color,
		lineStyle: id === "f" ? { width: 3 } : { width: 1.8, type: "dashed" },
		data: symGrid.map((x) => [x, fn(x)]),
	});
	const chart: ChartOption = {
		grid: { top: 44, left: 8, right: 24, bottom: 8 },
		legend: { top: 8, left: 8 },
		tooltip: { trigger: "axis", valueFormatter: (v: number) => fixed(v, 3) },
		xAxis: {
			type: "value",
			min: -PI,
			max: PI,
			interval: PI / 2,
			axisLabel: { formatter: (x: number) => piHalves[Math.round(x / (PI / 2)) + 2] },
		},
		yAxis:
			key === "odd"
				? { type: "value", min: -1.5, max: 1.5, interval: 0.5 }
				: { type: "value", min: -1, max: 4, interval: 1 },
		series: [
			line("f", "f(x)", "var(--accent)", g),
			line("even", "Even part", "var(--c2)", (x) => (g(x) + g(-x)) / 2),
			line("odd", "Odd part", "var(--c3)", (x) => (g(x) - g(-x)) / 2),
		],
	};
	return {
		heading,
		cosines: survivors("a", aList),
		sines: survivors("b", bList),
		chart,
		a: stems("a", aList, "var(--c1)", A_AXIS),
		b: stems("b", bList, "var(--c2)", B_AXIS),
	};
}

/** The symmetry section's heading and figure: one signal, its even and odd parts, the coefficients that survive. */
export function Symmetry() {
	const [key, setKey] = useState<SymName>("even");
	const s = useMemo(() => symmetry(key), [key]);
	return (
		<>
			<h2>{s.heading}</h2>
			<p>
				An even function (<i>f</i>(−<i>x</i>) = <i>f</i>(<i>x</i>)) is a mirror image across the
				vertical axis; an odd one flips sign. Cosines are even and sines are odd, so a
				mirror-symmetric signal can only contain cosines and an odd one only sines. Try the three
				cases; the coefficients are computed by numerical integration.
			</p>
			<figure class="fig">
				<div class="controls">
					<Seg name="sym" label="Signal" options={SYM_NAMES} value={key} onChange={setKey} />
				</div>
				<dl class="stats" aria-live="polite">
					<div class="stat">
						<dt>Cosine terms that survive</dt>
						<dd>{s.cosines}</dd>
					</div>
					<div class="stat">
						<dt>Sine terms that survive</dt>
						<dd>{s.sines}</dd>
					</div>
				</dl>
				<Chart
					id="sym-chart"
					label="The chosen signal on one period, with its even part and odd part"
					option={s.chart}
				/>
				<div class="split">
					<Plot id="sym-a" label="Cosine coefficients a-n for n from 0 to 9" option={s.a} />
					<Plot id="sym-b" label="Sine coefficients b-n for n from 1 to 9" option={s.b} />
				</div>
				<figcaption>
					Top: the signal over one period, with its even part (<i>f</i>(<i>x</i>) + <i>f</i>(−
					<i>x</i>))/2 and odd part (<i>f</i>(<i>x</i>) − <i>f</i>(−<i>x</i>))/2; click a legend
					entry to hide a line. Bottom: coefficients <i>a</i>
					<sub>0</sub> to <i>a</i>
					<sub>9</sub> (left) and <i>b</i>
					<sub>1</sub> to <i>b</i>
					<sub>9</sub> (right), where <i>a</i>
					<sub>0</sub>/2 is the average.
				</figcaption>
			</figure>
		</>
	);
}
