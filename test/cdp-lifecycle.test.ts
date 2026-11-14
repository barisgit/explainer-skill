import { expect, test } from "bun:test";
import { ChromeError } from "../skills/explainer/src/cdp.ts";
import { type Command, protocol, tick } from "./cdp-pipe.ts";

test.each(["Target.createTarget", "Target.attachToTarget"])(
	"cancel during %s still owns the late target and waits for destruction",
	async (method) => {
		const held = Promise.withResolvers<Command>();
		const closing = Promise.withResolvers<void>();
		const wire = protocol((command, reply) => {
			if (command.method === method) {
				held.resolve(command);
			} else if (command.method === "Target.createTarget") {
				reply(command, { targetId: "temporary" });
			} else {
				reply(command, {});
				if (command.method === "Target.closeTarget") {
					closing.resolve();
				}
			}
		});
		const limit = new AbortController();
		const reason = new ChromeError("work budget ended");
		let ran = false;
		let settled = false;
		const work = wire.cdp
			.temporaryPage(async () => {
				ran = true;
			}, limit.signal)
			.catch((error: unknown) => error)
			.finally(() => {
				settled = true;
			});
		try {
			const command = await held.promise;
			limit.abort(reason);
			await tick();
			expect(settled).toBe(false);
			wire.reply(
				command,
				method === "Target.createTarget"
					? { targetId: "temporary" }
					: { sessionId: "temporary-session" },
			);
			await closing.promise;
			await tick();
			expect(settled).toBe(false);
			wire.emit({ method: "Target.targetDestroyed", params: { targetId: "temporary" } });
			expect(await work).toBe(reason);
			expect(ran).toBe(false);
			expect(await wire.cdp.send("Runtime.enable")).toEqual({});
		} finally {
			wire.close();
			await work;
		}
	},
);

test("cancellation closes a known target even when attachment never replies", async () => {
	const attaching = Promise.withResolvers<void>();
	let closed = false;
	const wire = protocol((command, reply) => {
		if (command.method === "Target.attachToTarget") {
			attaching.resolve();
			return;
		}
		reply(command, command.method === "Target.createTarget" ? { targetId: "temporary" } : {});
		if (command.method === "Target.closeTarget") {
			closed = true;
			wire.emit({ method: "Target.targetDestroyed", params: { targetId: "temporary" } });
		}
	});
	const limit = new AbortController();
	const reason = new ChromeError("work budget ended");
	let ran = false;
	const work = wire.cdp
		.temporaryPage(async () => {
			ran = true;
		}, limit.signal)
		.catch((error: unknown) => error);
	try {
		await attaching.promise;
		limit.abort(reason);
		expect(await work).toBe(reason);
		expect(closed).toBe(true);
		expect(ran).toBe(false);
		expect(await wire.cdp.send("Runtime.enable")).toEqual({});
	} finally {
		wire.close();
		await work;
	}
});

test("unreconciled target creation fails instead of masquerading as incomplete coverage", async () => {
	const held = Promise.withResolvers<void>();
	const wire = protocol((command, reply) => {
		if (command.method === "Target.createTarget") {
			held.resolve();
		} else {
			reply(command, {});
		}
	});
	const limit = new AbortController();
	const reason = new ChromeError("work budget ended");
	const work = wire.cdp
		.temporaryPage(async () => undefined, limit.signal)
		.catch((error: unknown) => error);
	try {
		await held.promise;
		limit.abort(reason);
		const error = await work;
		expect(error).toBeInstanceOf(ChromeError);
		expect(error).not.toBe(reason);
		expect(String(error)).toContain("cleanup budget");
	} finally {
		wire.close();
		await work;
	}
}, 5_000);
