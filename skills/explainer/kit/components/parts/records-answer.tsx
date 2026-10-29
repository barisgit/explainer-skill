/* The answer a Records row takes (config `reply`): its choices and note as a reply question, one per record. This module is the
   only place Records writes `data-reply` and ids on controls, so pack leaves it out of the scripts Records' code needs
   (src/mdx/kit-scripts.ts) and brings keep and reply only for a Records whose config has a reply. */
import type { ReplyView } from "../../records/index.ts";
import { idOf, idPart } from "./answer-ids.ts";
import type { AnswerMemory } from "./answer-memory.ts";

/** Whether the radio `id` was checked when last entered; undefined for one never touched, which stays as the markup says. */
function checkedBefore(kept: AnswerMemory | undefined, id: string): boolean | undefined {
	const before = kept?.get(id);
	return typeof before === "boolean" ? before : undefined;
}

/** The note's text when last entered; undefined for one never touched. */
function textBefore(kept: AnswerMemory | undefined, id: string): string | undefined {
	const before = kept?.get(id);
	return typeof before === "string" ? before : undefined;
}

/**
 * A record's answer: `fieldset[data-reply]` named by the record's label, the choices as a `.seg` of radios and the note as a
 * text field marked `data-note`, which the reply sends under the answer. Ids are the block's, the record's and the choice's, so
 * the same record has the same ids in every view and keep restores the answer across a reload and a change of view. The note's
 * id has a dot, which no choice's id can: a choice named "note" would otherwise share it.
 */
export function Answer({
	block,
	recordId,
	label,
	reply,
	noteText,
	kept,
}: {
	block: string;
	recordId: string;
	label: string;
	reply: ReplyView;
	noteText: string;
	/** What the reader entered before this copy of the answer was drawn; none at pack time. */
	kept?: AnswerMemory | undefined;
}) {
	const name = `${block}-answer-${idPart(recordId)}`;
	const noteId = `${idPart(name)}.note`;
	return (
		<fieldset class="answer" data-reply={label}>
			<legend class="vh">{label}</legend>
			<div class="seg">
				{reply.choices.map((choice) => (
					<label key={choice.value}>
						<input
							type="radio"
							name={name}
							value={choice.value}
							id={idOf(name, choice.value)}
							checked={checkedBefore(kept, idOf(name, choice.value))}
						/>
						<span>{choice.label}</span>
					</label>
				))}
			</div>
			{reply.note && (
				<input
					type="text"
					class="note"
					id={noteId}
					value={textBefore(kept, noteId)}
					data-note=""
					aria-label={`${noteText}: ${label}`}
					placeholder={noteText}
				/>
			)}
		</fieldset>
	);
}
