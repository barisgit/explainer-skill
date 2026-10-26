"use client";
/* Records with controls (see ../records.tsx): the island that keeps the reader's state. Its first render is the state pack
   prerendered; then it reads the URL hash, and writes the view, sort, search and filters back with history.replaceState, so a
   link to the page shows what the reader saw and Back from an item's view returns to it. Folds stay out of the hash: a toggle
   would otherwise replace an anchor the reader came by (a hand-written open= is still read). Print shows the whole tree. */
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

/** What print shows: the default state as the tree (when the block has one) with every group open. */
function printState(records: Records): RecordsState {
	const tree = records.view({ ...records.initial, view: "tree" });
	return tree.body.kind === "tree" ? tree.body.expandAll : records.initial;
}

/** Keeps the hash in step with `state` (folds left out); a block inside a view leaves the hash to views.js. */
function writeHash(records: Records, state: RecordsState) {
	const want = records.writeHash({ ...state, open: [] });
	const current = location.hash.slice(1);
	if (want === records.config.id) {
		// Back to the default: drop the hash only when it is this block's, never someone else's anchor.
		if (current && records.readHash(current)) {
			history.replaceState(history.state, "", location.pathname + location.search);
		}
	} else if (current !== want) {
		history.replaceState(history.state, "", `#${want}`);
	}
}

/** Reads the hash now and at every hashchange; a hash that is not this block's leaves the state as it is. */
function useHash(
	records: Records,
	root: { current: HTMLElement | null },
	set: (s: RecordsState) => void,
) {
	const ready = useRef(false);
	useEffect(() => {
		const inView = () => Boolean(root.current?.closest("[data-view]"));
		const read = () => {
			const found = inView() ? null : records.readHash(location.hash);
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
	useEffect(() => {
		if (ready.current && !printing && !root.current?.closest("[data-view]")) {
			writeHash(records, state);
		}
	}, [records, state, printing, ready]);
	// The reader may close a fold the state keeps open (a group a search opened); a later render opens it again.
	useLayoutEffect(() => {
		for (const group of groupsShown(vm)) {
			const fold = document.getElementById(group.anchor);
			if (fold instanceof HTMLDetailsElement && fold.open !== group.open) {
				fold.open = group.open;
			}
		}
	});

	const actions = useMemo(
		(): RecordsActions => ({
			go: setState,
			search: (text) => setState((s) => ({ ...s, search: text })),
			toggled(id, open) {
				const group = groupsShown(shown.current).find((g) => g.id === id);
				if (!group || group.open === open) {
					return;
				}
				setState((s) => {
					const has = s.open.includes(id);
					if (open === has) {
						return s;
					}
					return { ...s, open: open ? [...s.open, id] : s.open.filter((g) => g !== id) };
				});
			},
		}),
		[],
	);
	return <RecordsBlock vm={vm} actions={actions} live={live} root={root} />;
}
