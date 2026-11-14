import { expect, spyOn, test } from "bun:test";
import { ChromeError } from "../skills/explainer/src/cdp.ts";
import { runStep } from "../skills/explainer/src/steps.ts";
import { type Command, protocol, tick } from "./cdp-pipe.ts";

test("load ignores an earlier navigation's load while the requested navigate reply is pending", async () => {
	const requested = Promise.withResolvers<Command>();
	const wire = protocol((command, reply) => {
		if (command.method === "Page.navigate") {
			requested.resolve(command);
		} else {
			reply(command, { frameTree: { frame: { id: "main", loaderId: "old" } } });
		}
	});
	let settled = false;
	const work = wire.cdp.load("file:///next.html").finally(() => {
		settled = true;
	});
	work.catch(() => undefined);
	try {
		const command = await requested.promise;
		wire.emit({ method: "Page.loadEventFired", params: {} });
		wire.emit({
			method: "Page.lifecycleEvent",
			params: { frameId: "main", loaderId: "old", name: "load" },
		});
		wire.reply(command, { frameId: "main", loaderId: "next" });
		await tick();
		expect(settled).toBe(false);
		wire.emit({
			method: "Page.lifecycleEvent",
			params: { frameId: "child", loaderId: "next", name: "load" },
		});
		await tick();
		expect(settled).toBe(false);
		wire.emit({
			method: "Page.lifecycleEvent",
			params: { frameId: "main", loaderId: "next", name: "load" },
		});
		await tick();
		expect(settled).toBe(false);
		wire.emit({
			method: "Page.frameNavigated",
			params: { frame: { id: "main", loaderId: "next", url: "file:///next.html" } },
		});
		await work;
		expect(settled).toBe(true);
	} finally {
		wire.close();
		await work.catch(() => undefined);
	}
});

/** Emits committed-document evidence independently of the command reply. */
function committed(wire: ReturnType<typeof protocol>, loaderId: string) {
	wire.emit({
		method: "Page.frameNavigated",
		params: { frame: { id: "main", loaderId, url: "file:///next.html" } },
	});
	wire.emit({ method: "Page.lifecycleEvent", params: { frameId: "main", loaderId, name: "load" } });
}

test.each(["Page.navigate", "Page.reload"])(
	"%s retains matching events before its reply",
	async (method) => {
		const wire = protocol((command, reply) => {
			if (command.method === method) {
				if (method === "Page.reload") {
					expect(command.params.loaderId).toBe("old");
					wire.emit({
						method: "Page.frameStartedNavigating",
						params: { frameId: "main", loaderId: "next", navigationType: "reload" },
					});
				}
				committed(wire, "next");
				reply(command, { frameId: "main", loaderId: "next" });
			} else {
				reply(command, { frameTree: { frame: { id: "main", loaderId: "old" } } });
			}
		});
		try {
			await wire.cdp.load(method === "Page.navigate" ? "file:///next.html" : undefined);
		} finally {
			wire.close();
		}
	},
);

test("reload ignores an old load and a non-reload navigation", async () => {
	const requested = Promise.withResolvers<Command>();
	const wire = protocol((command, reply) => {
		if (command.method === "Page.reload") {
			requested.resolve(command);
		} else {
			reply(command, { frameTree: { frame: { id: "main", loaderId: "old" } } });
		}
	});
	let settled = false;
	const work = wire.cdp.load().finally(() => {
		settled = true;
	});
	work.catch(() => undefined);
	try {
		const command = await requested.promise;
		committed(wire, "old");
		wire.emit({
			method: "Page.frameStartedNavigating",
			params: { frameId: "main", loaderId: "other", navigationType: "differentDocument" },
		});
		committed(wire, "other");
		wire.reply(command, {});
		await tick();
		expect(settled).toBe(false);
		wire.emit({
			method: "Page.frameStartedNavigating",
			params: { frameId: "main", loaderId: "next", navigationType: "reload" },
		});
		committed(wire, "next");
		await work;
	} finally {
		wire.close();
		await work.catch(() => undefined);
	}
});

test.each([{}, { errorText: "net::ERR_ABORTED" }, { isDownload: true }])(
	"navigate handles same-document/no-op, refusal and download (%j)",
	async (result) => {
		const wire = protocol((command, reply) =>
			reply(
				command,
				command.method === "Page.navigate"
					? { frameId: "main", ...result }
					: { frameTree: { frame: { id: "main", loaderId: "old" } } },
			),
		);
		try {
			const work = wire.cdp.load("file:///page.html#same");
			if ("errorText" in result || "isDownload" in result) {
				await expect(work).rejects.toBeInstanceOf(ChromeError);
			} else {
				await work;
			}
			expect(wire.observers()).toBe(0);
		} finally {
			wire.close();
		}
	},
);

/** The protocol call being invalidated, not a replacement for the real runStep call chain. */
function stepPhase(expression: string): string {
	if (expression.includes("el.click()")) {
		return "action";
	}
	if (expression.includes("const timers =")) {
		return "settle";
	}
	if (expression.includes("?.cleanup()")) {
		return "cleanup";
	}
	return "other";
}

function evaluated(expression: string) {
	return {
		result: {
			value:
				expression.includes("querySelectorAll") && expression.includes(".length")
					? { count: 1 }
					: "",
		},
	};
}

test.each(["action", "settle", "cleanup"])(
	"a navigation invalidating %s keeps the hit, never replays the action, and waits for its destination",
	async (stage) => {
		const interrupted = Promise.withResolvers<void>();
		let binding = "";
		let actionCount = 0;
		let failed = false;
		let loaderId = "old";
		let hit = "hit:a#next";
		const wire = protocol((command, reply) => {
			if (command.method === "Page.getFrameTree") {
				reply(command, {
					frameTree: { frame: { id: "main", loaderId } },
				});
				return;
			}
			if (command.method === "Runtime.addBinding") {
				binding = String(command.params.name);
			}
			if (command.method !== "Runtime.evaluate") {
				reply(command, {});
				return;
			}
			const expression = String(command.params.expression);
			const phase = stepPhase(expression);
			if (phase === "action") {
				actionCount++;
				wire.emit({
					method: "Runtime.bindingCalled",
					params: { name: binding, payload: hit },
				});
			}
			if (!failed && stage === phase) {
				failed = true;
				wire.emit({
					method: "Page.frameStartedNavigating",
					params: { frameId: "main", loaderId: "next", navigationType: "differentDocument" },
				});
				wire.emit({ id: command.id, error: { message: "Inspected target navigated or closed" } });
				interrupted.resolve();
				return;
			}
			reply(command, evaluated(expression));
		});
		let settled = false;
		const work = runStep(wire.cdp, "click:#next", () => "unused").finally(() => {
			settled = true;
		});
		work.catch(() => undefined);
		try {
			await interrupted.promise;
			await tick();
			expect(settled).toBe(false);
			expect(actionCount).toBe(1);
			loaderId = "next";
			hit = "hit:button#after";
			committed(wire, "next");
			const first = await work;
			expect(first.note).toContain("hit a#next");
			expect(actionCount).toBe(1);
			const second = await runStep(wire.cdp, "click:#after", () => "unused");
			expect(second.note).toBe("click:#after: hit button#after");
		} finally {
			wire.close();
			await work.catch(() => undefined);
		}
	},
);

test("navigation events beside the frame snapshot reply are retained", async () => {
	const interrupted = Promise.withResolvers<void>();
	const wire = protocol((command, reply) => {
		if (command.method === "Page.getFrameTree") {
			reply(command, { frameTree: { frame: { id: "main", loaderId: "old" } } });
			wire.emit({
				method: "Page.frameStartedNavigating",
				params: { frameId: "main", loaderId: "next", navigationType: "differentDocument" },
			});
		} else if (command.method === "Runtime.evaluate") {
			wire.emit({ id: command.id, error: { message: "Inspected target navigated or closed" } });
			interrupted.resolve();
		} else {
			reply(command, {});
		}
	});
	let read = false;
	const work = wire.cdp.followingNavigation(
		async () => {
			await wire.cdp.evaluate("action");
		},
		async () => {
			read = true;
		},
	);
	work.catch(() => undefined);
	try {
		await interrupted.promise;
		await tick();
		expect(read).toBe(false);
		committed(wire, "next");
		await work;
		expect(read).toBe(true);
	} finally {
		wire.close();
		await work.catch(() => undefined);
	}
});

test("a canceled candidate cannot explain an evaluation's lost context", async () => {
	const interrupted = Promise.withResolvers<void>();
	const wire = protocol((command, reply) => {
		if (command.method !== "Runtime.evaluate") {
			reply(command, { frameTree: { frame: { id: "main", loaderId: "old" } } });
			return;
		}
		wire.emit({
			method: "Page.frameStartedNavigating",
			params: { frameId: "main", loaderId: "next", navigationType: "differentDocument" },
		});
		wire.emit({
			method: "Network.requestWillBeSent",
			params: {
				request: { url: "file:///next.html" },
				requestId: "request",
				type: "Document",
				frameId: "main",
				loaderId: "next",
			},
		});
		wire.emit({ id: command.id, error: { message: "Inspected target navigated or closed" } });
		interrupted.resolve();
	});
	const work = wire.cdp.followingNavigation(
		async () => {
			await wire.cdp.evaluate("action");
		},
		async () => {
			throw new Error("must not read");
		},
	);
	work.catch(() => undefined);
	try {
		await interrupted.promise;
		await tick();
		wire.emit({
			method: "Network.loadingFailed",
			params: { requestId: "request", canceled: true, errorText: "net::ERR_ABORTED" },
		});
		await expect(work).rejects.toThrow("Inspected target navigated or closed");
		expect(wire.observers()).toBe(0);
	} finally {
		wire.close();
		await work.catch(() => undefined);
	}
});

test("aborting a load releases its navigation observers and preserves the caller's reason", async () => {
	const requested = Promise.withResolvers<void>();
	const wire = protocol((command, reply) => {
		reply(
			command,
			command.method === "Page.navigate"
				? { frameId: "main", loaderId: "next" }
				: { frameTree: { frame: { id: "main", loaderId: "old" } } },
		);
		if (command.method === "Page.navigate") {
			requested.resolve();
		}
	});
	const work = wire.cdp.load("file:///next.html");
	work.catch(() => undefined);
	try {
		await requested.promise;
		const reason = new ChromeError("caller canceled");
		wire.cdp.abort(reason);
		await expect(work).rejects.toBe(reason);
		expect(wire.observers()).toBe(0);
	} finally {
		wire.close();
		await work.catch(() => undefined);
	}
});

test.each(["unexplained context loss", "page exception", "closed target", "child navigation"])(
	"navigation recovery preserves %s",
	async (kind) => {
		const wire = protocol((command, reply) => {
			if (command.method !== "Runtime.evaluate") {
				reply(command, { frameTree: { frame: { id: "main", loaderId: "old" } } });
				return;
			}
			wire.emit({
				method: "Page.frameStartedNavigating",
				params: {
					frameId: kind === "child navigation" ? "child" : "main",
					loaderId: "next",
					navigationType: "differentDocument",
				},
			});
			if (kind === "page exception") {
				reply(command, {
					result: {},
					exceptionDetails: { text: "author failure", lineNumber: 0, columnNumber: 0 },
				});
			} else {
				const message =
					kind === "closed target" ? "Session closed" : "Inspected target navigated or closed";
				if (kind === "unexplained context loss") {
					// An unrelated start with no loader change must not explain context invalidation.
					wire.emit({
						method: "Page.frameStartedNavigating",
						params: { frameId: "main", loaderId: "old", navigationType: "sameDocument" },
					});
				}
				wire.emit({ id: command.id, error: { message } });
			}
		});
		try {
			await expect(
				wire.cdp.followingNavigation(
					async () => {
						await wire.cdp.evaluate("action");
					},
					async () => {
						throw new Error("must not read");
					},
				),
			).rejects.toThrow(
				kind === "page exception"
					? "author failure"
					: kind === "closed target"
						? "Session closed"
						: "Inspected target navigated or closed",
			);
		} finally {
			wire.close();
		}
	},
);

test("an already loaded destination is not timed out by later action work", async () => {
	const clock = spyOn(performance, "now").mockReturnValue(0);
	const wire = protocol((command, reply) =>
		reply(command, { frameTree: { frame: { id: "main", loaderId: "old" } } }),
	);
	let read = false;
	try {
		await wire.cdp.followingNavigation(
			async () => {
				wire.emit({
					method: "Page.frameStartedNavigating",
					params: { frameId: "main", loaderId: "next", navigationType: "differentDocument" },
				});
				committed(wire, "next");
				await tick();
				clock.mockReturnValue(11_000);
			},
			async () => {
				read = true;
			},
		);
		expect(read).toBe(true);
	} finally {
		wire.close();
		clock.mockRestore();
	}
});
