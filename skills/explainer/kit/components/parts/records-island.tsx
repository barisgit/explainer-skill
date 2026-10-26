"use client";
/* Records with controls (see ../records.tsx): the island that keeps the reader's state. Its first render is the state pack
   prerendered; then it reads the URL hash, and writes the whole state back with history.replaceState, so a link to the page or
   a reload shows what the reader saw and Back from an item's view returns to it. Opening or closing a fold writes only over
   this block's own hash or none, so an anchor the reader came by (#plan.1.wp1, which opens its group) stays. Print shows the
   whole tree. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import {
	createRecords,
	type GroupRow,
	type Records,
	type RecordsConfig,
	type RecordsState,
	type RecordsView,
} from "../../records/index.ts";
import { pageLabels, pageLang } from "./format.ts";
import { type RecordsActions, RecordsBlock } from "./records-view.tsx";

const groupsOf = (rows: readonly GroupRow[]): GroupRow[] =>
	rows.flatMap((g) => [g, ...groupsOf(g.children.filter((c) => c.kind === "group"))]);

const groupsShown = (vm: RecordsView) => (vm.body.kind === "tree" ? groupsOf(vm.body.groups) : []);

/** The state with `id` in its open groups or details when `open`, else without it; the same state when it already is. */
function flipped(
	state: RecordsState,
	key: "open" | "details",
	id: string,
	open: boolean,
): RecordsState {
	const ids = state[key];
	if (ids.includes(id) === open) {
		return state;
	}
	return { ...state, [key]: open ? [...ids, id] : ids.filter((other) => other !== id) };
}

/** What print shows: the default state as the tree (when the block has one) with every group and detail open. */
function printState(records: Records): RecordsState {
	const tree = records.view({ ...records.initial, view: "tree" });
	return tree.body.kind === "tree" ? tree.body.expandAll : records.initial;
}

/** Whether the block sits in a drill-down view, which leaves the URL hash to views.js. */
const inView = (root: { current: HTMLElement | null }) =>
	Boolean(root.current?.closest("[data-view]"));

/** Whether two states differ only in their open groups and details. */
const sameBesideFolds = (records: Records, a: RecordsState, b: RecordsState) =>
	records.writeHash({ ...a, open: [], details: [] }) ===
	records.writeHash({ ...b, open: [], details: [] });

/**
 * Keeps the hash in step with `state`, which follows `previous`. Over a hash that is not this block's (an anchor, another
 * block's state), a change of folds alone and a return to the default write nothing; any other change replaces it.
 */
function syncHash(records: Records, state: RecordsState, previous: RecordsState) {
	const want = records.writeHash(state);
	const current = location.hash.slice(1);
	const mine = current === "" || records.readHash(current) !== null;
	if (!mine && (want === records.config.id || sameBesideFolds(records, state, previous))) {
		return;
	}
	const next = want === records.config.id ? "" : want;
	if (next !== current) {
		history.replaceState(
			history.state,
			"",
			next ? `#${next}` : location.pathname + location.search,
		);
	}
}

/**
 * Reads the hash now and at every hashchange. A hash that is not this block's leaves the state as it is; a change to no hash
 * (Back to the page as it opened) is the default state, since the block writes none for it.
 */
function useHash(
	records: Records,
	root: { current: HTMLElement | null },
	set: (s: RecordsState) => void,
) {
	const ready = useRef(false);
	useEffect(() => {
		const read = (event?: Event) => {
			if (inView(root)) {
				return;
			}
			if (event && location.hash.length <= 1) {
				set(records.initial);
				return;
			}
			const found = records.readHash(location.hash);
			if (found) {
				set(found);
				requestAnimationFrame(() => root.current?.scrollIntoView({ block: "start" }));
			}
		};
		read();
		ready.current = true;
		addEventListener("hashchange", read);
		return () => removeEventListener("hashchange", read);
	}, [records, root, set]);
	return ready;
}

/** Shows the whole tree while the page prints, and the reader's state again after. */
function usePrint(set: (printing: boolean) => void) {
	useEffect(() => {
		const before = () => set(true);
		const after = () => set(false);
		addEventListener("beforeprint", before);
		addEventListener("afterprint", after);
		return () => {
			removeEventListener("beforeprint", before);
			removeEventListener("afterprint", after);
		};
	}, [set]);
}

/** Records with controls; `config` is the props the page gave Records, as JSON. */
export function RecordsIsland({ config }: { config: RecordsConfig }) {
	const records = useMemo(
		() => createRecords(config, { locale: pageLang(), labels: pageLabels() }),
		[config],
	);
	const [state, setState] = useState(records.initial);
	const [live, setLive] = useState(false);
	const [printing, setPrinting] = useState(false);
	const root = useRef<HTMLDivElement>(null);
	const vm = records.view(printing ? printState(records) : state);
	const shown = useRef(vm);
	shown.current = vm;

	const ready = useHash(records, root, setState);
	usePrint(setPrinting);
	useEffect(() => setLive(true), []);
	const written = useRef(state);
	useEffect(() => {
		if (ready.current && !printing && !inView(root)) {
			syncHash(records, state, written.current);
			written.current = state;
		}
	}, [records, state, printing, ready]);
	// The reader may close a fold the state keeps open (a group a search opened); a later render opens it again. Only opening is
	// forced: a fold opened from outside (the router revealing an anchor) reaches the state through its toggle event, which a
	// render in between must not undo.
	useLayoutEffect(() => {
		for (const group of groupsShown(vm)) {
			const fold = document.getElementById(group.anchor);
			if (fold instanceof HTMLDetailsElement && group.open && !fold.open) {
				fold.open = true;
			}
		}
	});

	const actions = useMemo(
		(): RecordsActions => ({
			go: setState,
			search: (text) => setState((s) => ({ ...s, search: text })),
			groupToggled(id, open) {
				const group = groupsShown(shown.current).find((g) => g.id === id);
				if (group && group.open !== open) {
					setState((s) => flipped(s, "open", id, open));
				}
			},
			detailToggled(id, open) {
				setState((s) => flipped(s, "details", id, open));
			},
		}),
		[],
	);
	return <RecordsBlock vm={vm} actions={actions} live={live} root={root} />;
}
