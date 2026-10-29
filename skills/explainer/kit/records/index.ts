/**
 * records: one collection of records shown as a tree, a table or a board, framework-free and DOM-free, so the Records
 * component's prerender in pack and its island in the browser share it, and `pack` can check a config without a browser.
 *
 *   const records = createRecords(config, { locale: "sl", labels: kitLabels });   // throws RecordsConfigError
 *   let state = records.readHash(location.hash) ?? records.initial;
 *   const model = records.view(state);   // draw model.body; a control's `next` is the state it leads to
 *
 * The config is `RecordsConfig` (config.ts), the view model `RecordsView` (view-model.ts), the state and its hash form
 * `RecordsState` (state.ts). The island (kit/components/parts/records-island.tsx) decides when `model.hash` goes to the URL.
 */
import type { RecordsConfig, ViewKind } from "./config.ts";
import { LABELS, type RecordsLabel } from "./labels.ts";
import { buildModel } from "./model.ts";
import { initialState, type RecordsState, readHash, writeHash } from "./state.ts";
import { parseConfig, RecordsConfigError } from "./validate.ts";
import { buildView, type ViewTexts } from "./view.ts";
import type { RecordsView } from "./view-model.ts";

export type * from "./config.ts";
export { VIEW_KINDS } from "./config.ts";
export { LABELS as RECORDS_LABELS, type RecordsLabel } from "./labels.ts";
export type { RecordsState, SortState } from "./state.ts";
export { RecordsConfigError } from "./validate.ts";
export type * from "./view-model.ts";

export interface RecordsOptions {
	/** The page's language as a BCP 47 tag (its `<html lang>`), for numbers, amounts, dates and collation. Default "en". */
	locale?: string;
	/** The page's kitLabels; keys that are not the records' are ignored, and a key left out stays English. */
	labels?: Readonly<Record<string, string>>;
}

/** One records block: its checked config, and the view model, the default state and the hash form of any state. */
export interface Records {
	readonly config: RecordsConfig;
	/** The state the block opens with: the first view, the config's ranking or source order, nothing filtered, groups closed. */
	readonly initial: RecordsState;
	/** The view model of a state (the initial one when left out); a state naming what the block lacks is cut down to it. */
	view(state?: RecordsState): RecordsView;
	/** The state a URL hash holds for this block, or null when the hash is not this block's (keep the current state then). */
	readHash(hash: string): RecordsState | null;
	/** A state's URL hash, without `#`. */
	writeHash(state: RecordsState): string;
}

function checkedLocale(locale: string): string {
	try {
		return Intl.getCanonicalLocales(locale)[0] ?? "en";
	} catch {
		throw new RecordsConfigError("records", [
			`locale: expected a language tag such as "en" or "sl"; got ${JSON.stringify(locale)}`,
		]);
	}
}

function textsOf(labels: Readonly<Record<string, string>>): ViewTexts {
	const text = (key: RecordsLabel) => labels[key] || LABELS[key];
	const views: Record<ViewKind, string> = {
		tree: text("recordsTree"),
		table: text("recordsTable"),
		board: text("recordsBoard"),
	};
	return {
		controls: {
			view: text("recordsView"),
			search: text("recordsSearch"),
			noMatches: text("recordsNoMatches"),
			clear: text("recordsClear"),
			expandAll: text("expandAll"),
			collapseAll: text("collapseAll"),
			count: text("recordsCount"),
			answer: text("recordsAnswer"),
			note: text("recordsNote"),
		},
		total: text("recordsTotal"),
		shown: text("recordsShown"),
		known: text("recordsKnown"),
		unknown: text("recordsUnknown"),
		views,
	};
}

/**
 * A records block from a config read as JSON. Throws a RecordsConfigError that lists every problem in the config (property
 * path, value found, what to write), so pack can report them all at once; the same check runs wherever the block is created.
 */
export function createRecords(config: unknown, options: RecordsOptions = {}): Records {
	const checked = parseConfig(config);
	const model = buildModel(checked, checkedLocale(options.locale ?? "en"));
	const texts = textsOf(options.labels ?? {});
	const initial = initialState(model.rules);
	return {
		config: checked,
		initial,
		view: (state = initial) => buildView(model, state, texts),
		readHash: (hash) => readHash(model.rules, hash),
		writeHash: (state) => writeHash(model.rules, state),
	};
}
