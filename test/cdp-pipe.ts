import { PassThrough } from "node:stream";
import { Cdp } from "../skills/explainer/src/cdp.ts";

export interface Command {
	id: number;
	method: string;
	params: { loaderId?: string; name?: string; expression?: string };
}

/** A fake browser at the actual NUL-framed pipe boundary: tests decide when irreversible target operations reply. */
export function protocol(
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
	const cdp = Cdp.open(input, output);
	let observers = 0;
	const on = cdp.on.bind(cdp);
	cdp.on = (event, listener) => {
		observers++;
		const stop = on(event, listener);
		let stopped = false;
		return () => {
			if (!stopped) {
				stopped = true;
				observers--;
				stop();
			}
		};
	};
	return {
		cdp,
		observers: () => observers,
		reply,
		emit,
		close: () => {
			input.destroy();
			output.destroy();
		},
	};
}

// Drain protocol promise continuations, not a timed guess about a browser's speed.
export const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
