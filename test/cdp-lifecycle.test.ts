import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { Cdp, ChromeError } from "../skills/explainer/src/cdp.ts";

interface Command {
	id: number;
	method: string;
}

/** A fake browser at the actual NUL-framed pipe boundary: tests decide when irreversible target operations reply. */
function protocol(
	onCommand: (command: Command, reply: (command: Command, result: object) => void) => void,
) {
	const input = new PassThrough();
	const output = new PassThrough();
	const emit = (message: object) =>
		queueMicrotask(() => input.write(`${JSON.stringify(message)}\0`));
	const reply = (command: Command, result: object) => emit({ id: command.id, result });
	let pending = "";
	output.setEncoding("utf8");
	output.on("data", (chunk: string) => {
		const parts = (pending + chunk).split("\0");
		pending = parts.pop() ?? "";
		for (const part of parts) {
			onCommand(JSON.parse(part) as Command, reply);
		}
	});
	return {
		cdp: Cdp.open(input, output),
		reply,
		emit,
		close: () => {
			input.destroy();
			output.destroy();
		},
	};
}

// Drain protocol promise continuations, not a timed guess about a browser's speed.
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

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
