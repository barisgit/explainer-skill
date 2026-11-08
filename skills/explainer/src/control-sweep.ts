import { ChromeError, DISPOSE_DEADLINE_MS } from "./cdp.ts";
import { CheckedPage, type Screen } from "./checked-page.ts";
import { PAINTS_JS, VIEW_ROUTES_JS } from "./page-js.ts";
import { runStep } from "./steps.ts";

/** One wall-clock ceiling, including temporary-tab creation and bounded disposal, never renewed per control. */
export const CONTROL_BUDGET_MS = 8_000;
/** A representative per role/component, capped so large collections cannot dominate a check. */
export const CONTROL_LIMIT = 12;

interface Control {
	step: string;
	name: string;
}

/** Visible, enabled initial-state samples, deduplicated by element and returned in document order. */
export const CONTROLS_JS = `(() => {
	const paints = ${PAINTS_JS};
	const eligible = el => paints(el) && !el.matches(':disabled, [aria-disabled="true"]') && !el.closest('[inert]');
	const seen = new Set();
	const picked = [];
	const add = (el, query) => {
		if (!el || seen.has(el) || !eligible(el)) return;
		seen.add(el);
		picked.push({el, query});
	};
	// One meaningful click per role/instance, not every radio, series or tree row. Prefer Next when it can advance.
	const rules = [
		['[data-stepper]', ['button[data-go="1"]', 'button[data-go="-1"]']],
		['.plot', ['.plot-legend button[data-i]']],
		['fieldset.self-check, fieldset[data-reply]', ['.seg input[type="radio"]:not(:checked)', '.seg input[type="checkbox"]:not(:checked)', '.seg input[type="checkbox"]']],
		['fieldset.written.self-check', ['details.answer > summary']],
		['.tree', ['details > summary']],
		['section, [data-records]', ['button.expand.fold-all']],
		['[data-records]', ['.toolbar [role="radiogroup"] input[type="radio"]:not(:checked)']],
		['[data-records] .facets fieldset', ['button[aria-pressed]']],
		['.fig > .controls .field > .seg[role="radiogroup"]', ['input[type="radio"]:not(:checked)']],
		['.fig > .controls label.toggle', ['input[type="checkbox"]']],
	];
	for (const [rootQuery, selectors] of rules) {
		for (const root of document.querySelectorAll(rootQuery)) {
			for (const selector of selectors) {
				const el = [...root.querySelectorAll(selector)].find(el => eligible(el) && !seen.has(el));
				if (!el) continue;
				add(el, ':is(' + rootQuery + ') ' + selector);
				break;
			}
		}
	}
	// The view runtime drives ordinary fragment links too. Sample the first visible link per view name, not per record.
	const route = (${VIEW_ROUTES_JS})([...document.querySelectorAll('[data-view]')].map(el => el.dataset.view));
	const linked = new Set();
	for (const el of document.querySelectorAll('a[href^="#"]')) {
		const href = el.getAttribute('href');
		const {name} = route(href.slice(1));
		if (!name || linked.has(name) || !eligible(el)) continue;
		linked.add(name);
		add(el, 'a[href="' + CSS.escape(href) + '"]');
	}
	picked.sort((a, b) => a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
	return picked.map(({el, query}) => {
		const id = el.id && '#' + CSS.escape(el.id);
		const unique = id && document.querySelectorAll(id).length === 1;
		const selector = unique ? id : query;
		const index = unique ? 0 : [...document.querySelectorAll(selector)].indexOf(el);
		return {step: 'click:' + selector + '@' + index, name: unique ? id : selector + '@' + index};
	});
})()`;

interface Findings {
	problems: string[];
	warnings: string[];
}

/** Clicks only initial-state kit samples in a disposable default-context page; no control state reaches screenshots. */
export async function sweepControls(owner: CheckedPage, screen: Screen): Promise<Findings> {
	const findings: Findings = { problems: [], warnings: [] };
	const limit = new AbortController();
	const reason = new ChromeError("the kit control sweep exhausted its work budget");
	// Reserve target disposal inside the total ceiling; timeout never poisons the caller's screenshot session.
	const timer = setTimeout(() => limit.abort(reason), CONTROL_BUDGET_MS - DISPOSE_DEADLINE_MS);
	let controls: Control[] | undefined;
	let completed = 0;
	let active = "";
	let exhausted = false;
	try {
		await owner.cdp.temporaryPage(async (cdp) => {
			const page = new CheckedPage(cdp, owner.url);
			await page.start();
			await page.screen(screen);
			await page.open();
			controls = await cdp.evaluate<Control[]>(CONTROLS_JS);
			for (const control of controls.slice(0, CONTROL_LIMIT)) {
				active = control.name;
				await probeControl(page, control, screen, completed > 0, findings);
				completed++;
			}
		}, limit.signal);
	} catch (error) {
		if (error !== reason) {
			throw error;
		}
		exhausted = true;
	} finally {
		clearTimeout(timer);
	}
	if (exhausted || (controls && completed < controls.length)) {
		const why = exhausted
			? `${CONTROL_BUDGET_MS / 1000}s total budget`
			: `${CONTROL_LIMIT}-control cap`;
		findings.warnings.push(
			`control sweep incomplete: completed ${completed} of ${controls?.length ?? "unknown"} sampled control clicks (${why}${exhausted && active ? `; stopped at ${active}` : ""})`,
		);
	}
	return findings;
}

/** The discovery load is already fresh for the first click; later clicks unload before clearing Keep storage again. */
async function probeControl(
	page: CheckedPage,
	control: Control,
	screen: Screen,
	reload: boolean,
	findings: Findings,
) {
	try {
		// No #15 scroll sweep on these fresh loads: its per-load budget must not multiply this one total control budget.
		if (reload) {
			await page.open();
		}
		const step = await runStep(page.cdp, control.step, () => "unused");
		if (step.problem) {
			page.problems.push(step.problem);
		}
		const layout = await page.inspect(screen);
		findings.warnings.push(
			...[...layout.warnings, ...layout.scrolls].map((w) => `control ${control.name}: ${w}`),
		);
	} finally {
		// Preserve diagnostics already observed even when the current click or its settling work times out.
		findings.problems.push(...new Set(page.problems.map((p) => `control ${control.name}: ${p}`)));
		findings.warnings.push(...new Set(page.warnings.map((w) => `control ${control.name}: ${w}`)));
	}
}
