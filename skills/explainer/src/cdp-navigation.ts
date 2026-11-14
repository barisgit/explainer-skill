import type { Cdp } from "./cdp.ts";

type Frame = { id: string; loaderId: string };

/** Main-frame navigation evidence, retained even when events precede command replies. */
export class Navigation {
	readonly frameId: string;
	private readonly initial: string;
	loaderId: string;
	reloadLoaderId: string | undefined;
	private committedLoader: string;
	private readonly loads = new Set<string>();
	private readonly commits = new Set<string>();
	private readonly requests = new Map<string, string>();
	private readonly stops: Array<() => void>;
	changed: () => void = () => undefined;

	private constructor(frame: Frame, stops: Array<() => void>) {
		this.frameId = frame.id;
		this.initial = this.loaderId = this.committedLoader = frame.loaderId;
		this.stops = stops;
	}

	/** Subscribe before the snapshot: a reply and the next navigation event can share one pipe chunk. */
	static async open(cdp: Cdp): Promise<Navigation> {
		let navigation: Navigation | undefined;
		const pending: Array<(navigation: Navigation) => void> = [];
		const observe = (event: (navigation: Navigation) => void) => {
			if (navigation) {
				event(navigation);
			} else {
				pending.push(event);
			}
		};
		const stops = [
			cdp.on("Page.frameStartedNavigating", (event) =>
				observe((n) => {
					if (event.frameId !== n.frameId || !event.loaderId) {
						return;
					}
					n.loaderId = event.loaderId;
					if (event.navigationType === "reload" && event.loaderId !== n.initial) {
						// Reload returns no loader. Keep its first reload candidate, not a later supersession.
						n.reloadLoaderId ??= event.loaderId;
					}
					n.changed();
				}),
			),
			cdp.on("Page.frameNavigated", ({ frame }) =>
				observe((n) => {
					if (frame.id !== n.frameId || frame.parentId) {
						return;
					}
					n.loaderId = n.committedLoader = frame.loaderId;
					n.commits.add(frame.loaderId);
					n.changed();
				}),
			),
			cdp.on("Page.lifecycleEvent", (event) =>
				observe((n) => {
					if (event.frameId === n.frameId && event.name === "load") {
						n.loads.add(event.loaderId);
						n.changed();
					}
				}),
			),
			cdp.on("Network.requestWillBeSent", (event) =>
				observe((n) => {
					if (
						event.type === "Document" &&
						event.frameId === n.frameId &&
						event.loaderId &&
						event.requestId
					) {
						n.requests.set(event.requestId, event.loaderId);
					}
				}),
			),
			cdp.on("Network.loadingFailed", (event) =>
				observe((n) => {
					const loader = event.requestId && n.requests.get(event.requestId);
					// 204s, downloads and aborted requests can leave the original document intact. No unlabelled stop/load can prove it.
					if (event.canceled && loader === n.loaderId && !n.commits.has(loader)) {
						n.loaderId = n.committedLoader;
						n.changed();
					}
				}),
			),
		];
		try {
			const { frameTree } = await cdp.send<{ frameTree: { frame: Frame } }>("Page.getFrameTree");
			navigation = new Navigation(frameTree.frame, stops);
			for (const event of pending) {
				event(navigation);
			}
			return navigation;
		} catch (error) {
			for (const stop of stops) {
				stop();
			}
			throw error;
		}
	}

	get moved(): boolean {
		return this.loaderId !== this.initial;
	}

	get ready(): boolean {
		return this.loaded(this.loaderId);
	}

	get loading(): boolean {
		return this.moved && !this.ready;
	}

	get documentId(): string {
		return this.committedLoader;
	}

	/** Both signals name the same document; neither a request acknowledgement nor an old load is enough. */
	loaded(loaderId: string): boolean {
		return this.commits.has(loaderId) && this.loads.has(loaderId);
	}

	/** Releases all observers, including on refused commands and cancellation. */
	stop(): void {
		for (const stop of this.stops) {
			stop();
		}
	}
}

/** Only protocol context invalidation can be explained by navigation; page exceptions and lost targets remain failures. */
export const contextLost = (error: unknown): boolean =>
	error instanceof Error &&
	/^Runtime\.evaluate: (Inspected target navigated or closed|Execution context was destroyed\.?|Cannot find context with specified id)$/.test(
		error.message,
	);
