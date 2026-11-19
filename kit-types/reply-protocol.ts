/**
 * Fails the kit typecheck when the envelope kit/reply.ts sends (ReplyEnvelope, declared in globals.d.ts because a kit script
 * cannot import) and the protocol's differ. Checking it with the kit's settings also checks the protocol and the handler with
 * the DOM lib and no Bun types: they use web standards only.
 */
import type { replyHandler } from "../skills/explainer/src/reply/handler.ts";
import type { ReplyEnvelope as Protocol } from "../skills/explainer/src/reply/protocol.ts";

/** Whether A and B are the same type, optional fields included (mutual assignability would let an optional field differ). */
type Same<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** The two envelope types and their parts compared; a handler type keeps the handler's module in the check. */
export type ReplyProtocolChecks = [
	Same<ReplyEnvelope, Protocol>,
	Same<ReplyEnvelope["reply"]["notes"][number], Protocol["reply"]["notes"][number]>,
	Same<ReplyEnvelope["reply"]["answers"][number], Protocol["reply"]["answers"][number]>,
	ReturnType<typeof replyHandler>,
];
export const replyProtocolMatches: ReplyProtocolChecks[0] &
	ReplyProtocolChecks[1] &
	ReplyProtocolChecks[2] = true;
