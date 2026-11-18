/**
 * The pull-up model behind every number on the page: an ideal RC rise of the bus line through its pull-up resistor,
 * measured between the I2C input thresholds, and the limits of NXP UM10204 Rev. 7.0 (Table 10: VOL, IOL; Table 11:
 * tr, Cb; Section 7.1: the 0.8473 factor and the Rp bounds).
 */

/** Supply of the bus, volts. An assumption for this board. */
export const VDD = 3.3;
/** Capacitance of each bus line, farads: wire, connectors and pins. An estimate for this board. */
export const CB = 100e-12;
/** The pull-ups on the board as found. */
export const FOUND = 10_000;
/** The replacement the page recommends. */
export const FIX = 2_200;
/** The larger bus capacitance the self-check asks about. */
export const CB_GROWN = 200e-12;

/** VIL(max) and VIH(min) as fractions of VDD (Table 10); rise time is counted between them (Table 11). */
const LOW = 0.3;
const HIGH = 0.7;
/** VOL(max) at the rated sink current, VDD > 2 V (Table 10). */
const VOL = 0.4;

/** Rise time per unit RC: t(0.7 VDD) − t(0.3 VDD) of V = VDD (1 − e^(−t/RC)), which UM10204 rounds to 0.8473. */
export const K = Math.log((1 - LOW) / (1 - HIGH));
/** Time from the start of the charge to 0.3 VDD and to 0.7 VDD, per unit RC. */
const T_LOW = -Math.log(1 - LOW);
const T_HIGH = -Math.log(1 - HIGH);

export type Mode = { name: string; fSCL: number; tr: number; cb: number; iol: number };

/** Standard, Fast and Fast-mode Plus: SCL frequency (Hz), tr max (s), Cb max (F), IOL min at VOL = 0.4 V (A). */
export const MODES: Mode[] = [
	{ name: "Standard-mode", fSCL: 100e3, tr: 1000e-9, cb: 400e-12, iol: 3e-3 },
	{ name: "Fast-mode", fSCL: 400e3, tr: 300e-9, cb: 400e-12, iol: 3e-3 },
	{ name: "Fast-mode Plus", fSCL: 1000e3, tr: 120e-9, cb: 550e-12, iol: 20e-3 },
];
const [STANDARD, FAST] = MODES as [Mode, Mode, Mode];

/** Rise time, seconds, of a line pulled up through `r` ohms onto `cb` farads. */
export const riseTime = (r: number, cb = CB): number => K * r * cb;
/** Current a pin sinks to hold the line at VOL against `r`, amperes. */
export const sink = (r: number): number => (VDD - VOL) / r;
/** The largest pull-up a mode allows on `cb` (Section 7.1, Equation 1). */
export const rMax = (mode: Mode, cb = CB): number => mode.tr / (K * cb);
/** The smallest pull-up a mode allows at VDD (Section 7.1, Equation 2). */
export const rMin = (mode: Mode): number => (VDD - VOL) / mode.iol;

/** E12 values from 680 Ω to 10 kΩ. */
export const E12 = [
	680, 820, 1000, 1200, 1500, 1800, 2200, 2700, 3300, 3900, 4700, 5600, 6800, 8200, 10_000,
];

/** "2.2 kΩ", "680 Ω". */
export const ohms = (r: number): string =>
	r >= 1000 ? `${String(r / 1000).replace(/\.0$/, "")} kΩ` : `${r} Ω`;
/** "2k2", "10k", "680": the resistor code, short enough for a strip of fifteen on a phone. */
const short = (r: number): string =>
	r >= 1000 ? `${r / 1000}k`.replace(/^(\d)\.(\d)k$/, "$1k$2") : String(r);
/** Nanoseconds, rounded. */
export const ns = (t: number): number => Math.round(t * 1e9);
/** Milliamperes to one decimal. */
export const mA = (i: number): string => (i * 1e3).toFixed(1);

/** How a value fares at 400 kHz: too slow for tr, too strong for the 3 mA sink, or fine. */
export const verdict = (r: number, cb = CB): "slow" | "strong" | "fits" =>
	riseTime(r, cb) > FAST.tr ? "slow" : sink(r) > FAST.iol ? "strong" : "fits";

/** The largest E12 value that fits Fast-mode on `cb`. */
export const largestFitting = (cb = CB): number =>
	E12.filter((r) => verdict(r, cb) === "fits").at(-1) ?? Number.NaN;

/** The line's rise from 0.3 VDD to 0.7 VDD through `r`, as [ns since 0.3 VDD, fraction of VDD]: the segment tr measures. */
const rise = (r: number): [number, number][] => {
	const tau = r * CB;
	return Array.from({ length: 41 }, (_, i) => {
		const t = ((T_HIGH - T_LOW) * tau * i) / 40;
		return [t * 1e9, 1 - Math.exp(-(t / tau + T_LOW))];
	});
};

/** A line's labels with only its last point's written, which the plot prints after the line's name. */
const atEnd = (text: string): string[] => [...Array<string>(40).fill(""), text];

/** The opening figure: the found pull-up's rise in accent, the fix muted, on one time scale with both modes' limits. */
export const OPENING = {
	series: [
		{
			name: ohms(FOUND),
			type: "line",
			data: rise(FOUND),
			color: "var(--accent)",
			label: atEnd(`${ns(riseTime(FOUND))} ns`),
		},
		{ name: ohms(FIX), type: "line", data: rise(FIX), label: atEnd(`${ns(riseTime(FIX))} ns`) },
	],
	marks: [
		{ x: ns(FAST.tr), label: `400 kHz: ${ns(FAST.tr)} ns` },
		{ x: ns(STANDARD.tr), label: `100 kHz: ${ns(STANDARD.tr)} ns` },
	],
	x: { min: 0, max: 1000, format: { unit: "ns" } },
	// Starting the axis a little under 0.3 VDD keeps its first label clear of the time axis's "0 ns".
	y: { min: LOW - 0.05, max: HIGH, step: 0.1, format: { digits: 1, unit: "VDD" } },
};

/** One record per mode for the limits table, its bounds worked out for this board. */
export const LIMITS = MODES.map((m) => ({
	name: m.name,
	fSCL: `${m.fSCL / 1e3} kHz`,
	tr: ns(m.tr),
	cb: Math.round(m.cb * 1e12),
	iol: m.iol * 1e3,
	rMin: Math.round(rMin(m)),
	rMax: rMax(m) / 1000,
}));

/** The largest value that fits on the grown bus, and the next one up, which does not. */
const GROWN = largestFitting(CB_GROWN);
const GROWN_NEXT = E12[E12.indexOf(GROWN) + 1] ?? Number.NaN;

/** Numbers the prose quotes, computed here so they cannot drift from the figures. */
export const N = {
	vdd: VDD,
	cb: Math.round(CB * 1e12),
	found: ohms(FOUND),
	foundTr: ns(riseTime(FOUND)),
	fix: ohms(FIX),
	fastTr: ns(FAST.tr),
	standardTr: ns(STANDARD.tr),
	fastRMax: (rMax(FAST) / 1000).toFixed(2),
	fastRMin: Math.round(rMin(FAST)),
	fixCbMax: Math.round((FAST.tr / (K * FIX)) * 1e12),
	low: ohms(E12.find((r) => verdict(r) === "fits") ?? Number.NaN),
	high: ohms(largestFitting()),
	highTr: ns(riseTime(largestFitting())),
	grownCb: Math.round(CB_GROWN * 1e12),
	grownFixTr: ns(riseTime(FIX, CB_GROWN)),
	grownHigh: ohms(GROWN),
	grownHighCode: short(GROWN),
	grownHighTr: ns(riseTime(GROWN, CB_GROWN)),
	grownNext: ohms(GROWN_NEXT),
	grownNextTr: ns(riseTime(GROWN_NEXT, CB_GROWN)),
};

/** The strip's choices: each E12 value by its short name, keyed by its ohms. */
export const VALUES = Object.fromEntries(E12.map((r) => [String(r), short(r)]));

/**
 * The strip figure for the picked value: every E12 value's rise time as a column on one scale against the 400 kHz limit,
 * the found 10 kΩ in accent and the values too strong for a 3 mA pin hatched; the readout gives the pick's sink current.
 */
export const stripFrame = (picked: string) => {
	const r = Number(picked);
	const rated = `${FAST.iol * 1e3} mA`;
	const why = {
		slow: `too slow for ${ns(FAST.tr)} ns`,
		strong: `but a pin must sink ${mA(sink(r))} mA to hold it at ${VOL} V, over the ${rated} Fast-mode pins are rated for`,
		fits: `and a pin holding it low sinks ${mA(sink(r))} mA of its ${rated}`,
	}[verdict(r)];
	return {
		plot: {
			categories: E12.map(short),
			series: [
				{
					type: "bar",
					data: E12.map((v) => ns(riseTime(v))),
					fill: E12.map((v) => (v === FOUND ? "accent" : verdict(v) === "strong" ? "hatch" : "")),
					// Names the hatch once, on the first hatched bar.
					label: E12.map((_, i) => (i === 0 ? `over ${rated}` : "")),
				},
			],
			marks: [{ y: ns(FAST.tr), label: `400 kHz: ${ns(FAST.tr)} ns` }],
			y: { min: 0, max: 900, format: { unit: "ns" } },
			pick: E12.indexOf(r),
		},
		readout: `${ohms(r)} raises the line in ${ns(riseTime(r))} ns, ${why}.`,
	};
};
