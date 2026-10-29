/**
 * Page-side functions, as source text for `Runtime.evaluate`, that both check's page analysis and its `--do` steps use, so a report
 * and a step agree on what an element is called and whether the reader can see it or something in it.
 */

/** Page-side function naming an element in reports: `div#panel.card` (tag, id, first class). */
export const ELEMENT_NAME_JS = `(el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : "")`;

/**
 * Page-side function: true for an element laid out for the reader. Chrome still returns layout boxes for the descendants of a closed
 * `<details>`, so a box alone does not mean visible; only the `<summary>` of a closed disclosure is.
 */
const LAID_OUT_JS = `(el) => {
	if (el.getClientRects().length === 0) return false;
	for (let child = el, p = el.parentElement; p; child = p, p = p.parentElement) {
		if (p.tagName === "DETAILS" && !p.open && child.tagName !== "SUMMARY") return false;
	}
	return true;
}`;

/**
 * Page-side function: true when the element itself paints: laid out and not `visibility: hidden`. Visibility inherits, so the
 * element's own computed value covers its ancestors'. For things that are their own picture: a figure, a link, a text run.
 */
export const PAINTS_JS = `(el) => getComputedStyle(el).visibility === "visible" && (${LAID_OUT_JS})(el)`;

/**
 * Page-side function: true when the element's region shows the reader something: it paints, or a laid-out descendant does, since a
 * child may set `visibility: visible` inside a hidden parent. For regions: a clipping or scrolling box, a shot: target.
 */
export const REGION_VISIBLE_JS = `(el) => {
	const paints = ${PAINTS_JS};
	if (!(${LAID_OUT_JS})(el)) return false;
	return paints(el) || [...el.querySelectorAll("*")].some(paints);
}`;

/** Timers due within this time count as work the page is about to do: check waits for them. */
const SHORT_TIMER_MS = 1000;
/** How long SETTLE_JS waits before it gives up and says what is still missing. */
export const SETTLE_DEADLINE_MS = 10_000;
/** The script name TIMERS_JS gives itself, so a report can leave its wrapper out of a page error's stack. */
export const TIMERS_URL = "explainer-check-timers.js";
/** Where TIMERS_JS keeps its state on `window`: a registered symbol, so no page script or enumeration meets it. */
const TIMERS_KEY = `Symbol.for("explainer.check.timers")`;

/**
 * Page script for every new document (Page.addScriptToEvaluateOnNewDocument): wraps setTimeout to track the timers due within
 * SHORT_TIMER_MS, the work a page defers by a moment (a restore after load, a redraw after a click, a test's contract), so
 * SETTLE_JS can wait for that work instead of for a fixed time. Timeouts and intervals share one id pool, so clearTimeout and
 * clearInterval each cancel either and both stop tracking the id. It keeps the original setTimeout for its own waits.
 */
export const TIMERS_JS = `(() => {
	if (window[${TIMERS_KEY}]) return;
	const set = window.setTimeout.bind(window);
	const clearTimeout = window.clearTimeout.bind(window);
	const clearInterval = window.clearInterval.bind(window);
	const pending = new Set();
	window.setTimeout = function (handler, ms, ...args) {
		const id = set(function () {
			pending.delete(id);
			return typeof handler === "function" ? handler.apply(this, args) : (0, eval)(String(handler));
		}, ms);
		if (!(Number(ms) > ${SHORT_TIMER_MS})) pending.add(id);
		return id;
	};
	// The native functions convert the id to a 32-bit integer ("7" cancels timer 7), and so does the tracking.
	window.clearTimeout = (id) => { pending.delete(Number(id) | 0); clearTimeout(id); };
	window.clearInterval = (id) => { pending.delete(Number(id) | 0); clearInterval(id); };
	window[${TIMERS_KEY}] = {
		set,
		/**
		 * Resolves once every short timer pending now has run or been cleared, with how many there were; timers those set are not
		 * waited for, so a page that keeps re-arming one still settles.
		 */
		ran: () => new Promise((done) => {
			const ids = [...pending];
			const poll = () => (ids.some((id) => pending.has(id)) ? set(poll, 10) : done(ids.length));
			poll();
		}),
	};
})()
//# sourceURL=${TIMERS_URL}`;

/**
 * Page expression: a promise of "" once the page has drawn what its load or the last step started, or of what is still missing
 * after SETTLE_DEADLINE_MS. In order: a frame, a task and a frame (Preact runs an island's effects in between, which make its
 * charts and start their fonts); ECharts unpacked; the fonts; every chart the reader can see drawn, that is each `.chart` with a
 * width (plots aside, which plot.js draws as it makes them) has its ECharts instance, since Charts.make mounts a chart once its
 * font has loaded; the
 * same frames again for the redraws those start; then the short timers pending by then (TIMERS_JS, where check installed it) and,
 * when there were any, the frames, fonts and charts again for what they started (a timer that adds a chart). That one batch of
 * timers bounds the wait: timers they set are not waited for. The deadline runs on a timer, so a page that stops producing frames
 * still ends the wait.
 */
export const SETTLE_JS = `(() => {
	const timers = window[${TIMERS_KEY}];
	const later = timers?.set ?? setTimeout;
	const name = ${ELEMENT_NAME_JS};
	const frame = () => new Promise((done) => requestAnimationFrame(() => done()));
	const frames = () => frame().then(() => new Promise((done) => later(done, 50))).then(frame);
	const undrawn = () => window.echarts ? [...document.querySelectorAll(".chart:not(.plot)")].filter((el) => el.clientWidth && !echarts.getInstanceByDom(el)) : [];
	let waiting = "an animation frame";
	const drawn = async () => {
		// A packed page unpacks ECharts as it loads; its rejection is the page's error, which check reports itself.
		waiting = "ECharts to unpack";
		await window.echartsReady?.catch(() => {});
		waiting = "the page's fonts";
		await document.fonts.ready;
		// "": the deadline names the charts still undrawn.
		waiting = "";
		while (undrawn().length) await frame();
		waiting = "an animation frame";
		await frames();
	};
	const work = (async () => {
		await frames();
		await drawn();
		waiting = "the page's timers of up to ${SHORT_TIMER_MS / 1000} s";
		if (await timers?.ran()) {
			waiting = "an animation frame";
			await frames();
			await drawn();
		}
		return "";
	})();
	let timer;
	const deadline = new Promise((done) => { timer = later(() => {
		const charts = undrawn().map(name);
		const what = waiting || (charts.length ? "charts to be drawn: " + charts.join(", ") : "an animation frame");
		done("still waiting after ${SETTLE_DEADLINE_MS / 1000} s for " + what);
	}, ${SETTLE_DEADLINE_MS}); });
	return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
})()`;
