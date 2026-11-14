import type { Cdp } from "./cdp.ts";
import { ELEMENT_NAME_JS } from "./page-js.ts";

const KEY = 'Symbol.for("explainer.check.pointer-hit")';
const TAG = { hit: "hit:", event: "event:", chart: "chart" } as const;

interface Observation {
	hits: Set<string>;
	events: Set<string>;
	chart: boolean;
}

/** Captures targets and public chart events in host-held, step-local state, so navigation cannot erase an observed hit. */
export async function beginHit(cdp: Cdp): Promise<() => Promise<string>> {
	const binding = `__explainer_hit_${crypto.randomUUID().replaceAll("-", "")}`;
	const observation: Observation = { hits: new Set(), events: new Set(), chart: false };
	const stop = cdp.on("Runtime.bindingCalled", ({ name, payload }) => {
		if (name !== binding) {
			return;
		}
		if (payload.startsWith(TAG.hit)) {
			observation.hits.add(payload.slice(TAG.hit.length));
		} else if (payload.startsWith(TAG.event)) {
			observation.events.add(payload.slice(TAG.event.length));
		} else if (payload === TAG.chart) {
			observation.chart = true;
		}
	});
	let removal: Promise<unknown> | undefined;
	const release = () => {
		stop();
		removal ??= cdp.send("Runtime.removeBinding", { name: binding });
		return removal;
	};
	let description: string | undefined;
	try {
		await cdp.send("Runtime.addBinding", { name: binding });
		const before = await cdp.evaluate<string>(hitScript(binding));
		return async () => {
			if (description !== undefined) {
				return description;
			}
			let after: string;
			try {
				after = await cdp.evaluate<string>(`(() => {
					window[${KEY}]?.cleanup();
					delete window[${KEY}];
					delete window[${JSON.stringify(binding)}];
					return location.hash;
				})()`);
			} catch (error) {
				await release().catch(() => undefined);
				throw error;
			}
			await release();
			description = describe(observation, before, after);
			return description;
		};
	} catch (error) {
		// Preserve setup's own error; an expired/closed target cannot accept cleanup and is being disposed by its owner.
		await release().catch(() => undefined);
		throw error;
	}
}

/** Only selectors, event names and fragments cross the binding; no mark payloads, chart options or canvas pixels are read. */
function hitScript(binding: string): string {
	return `(() => {
		const name = ${ELEMENT_NAME_JS};
		const emit = payload => window[${JSON.stringify(binding)}](payload);
		const charts = new Map();
		const record = event => {
			const el = event.composedPath().find(node => node instanceof Element);
			if (!el) return;
			const root = el.closest('.chart');
			emit(${JSON.stringify(TAG.hit)} + name(el) + (root && root !== el ? ' in ' + name(root) : ''));
			if (root) emit(${JSON.stringify(TAG.chart)});
			const chart = root && window.echarts?.getInstanceByDom(root);
			if (!chart || charts.has(chart)) return;
			const listeners = ['click', 'datazoom', 'legendselectchanged', 'selectchanged'].map(type => {
				const listener = () => emit(${JSON.stringify(TAG.event)} + type);
				chart.on(type, listener);
				return [type, listener];
			});
			charts.set(chart, listeners);
		};
		// Capture precedes canvas handlers; DOM .click() has no pointerdown, so observe click as well.
		for (const type of ['pointerdown', 'click']) document.addEventListener(type, record, true);
		window[${KEY}] = {cleanup: () => {
			for (const type of ['pointerdown', 'click']) document.removeEventListener(type, record, true);
			for (const [chart, listeners] of charts) {
				if (!chart.isDisposed()) for (const [type, listener] of listeners) chart.off(type, listener);
			}
		}};
		return location.hash;
	})()`;
}

const short = (text: string) => (text.length > 80 ? `${text.slice(0, 77)}...` : text);

/** Bounded observations, not a claim that every kind of state was compared. */
function describe({ hits, events, chart }: Observation, before: string, after: string): string {
	const targets = [...hits];
	const parts = [
		targets.length
			? `hit ${targets.slice(0, 3).map(short).join(", ")}${targets.length > 3 ? ` (+${targets.length - 3} more)` : ""}`
			: "no target event observed",
	];
	if (chart) {
		parts.push(`chart events: ${[...events].join(", ") || "none observed"}`);
	}
	if (after !== before) {
		parts.push(`hash ${JSON.stringify(short(before))} -> ${JSON.stringify(short(after))}`);
	}
	return parts.join("; ");
}
