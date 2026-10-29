/* The answer a Records row takes (config `reply`): its choices and note as a reply question, one per record. This module is the
   only place Records writes `data-reply` and ids on controls, so pack's scan of client code leaves it out (src/mdx/bundle.ts) and
   the page carries keep and reply only when its prerendered markup holds these controls. */
import type { ReplyView } from "../../records/index.ts";
import { idOf, idPart } from "./answer-ids.ts";

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
}: {
	block: string;
	recordId: string;
	label: string;
	reply: ReplyView;
	noteText: string;
}) {
	const name = `${block}-answer-${idPart(recordId)}`;
	return (
		<fieldset class="answer" data-reply={label}>
			<legend class="vh">{label}</legend>
			<div class="seg">
				{reply.choices.map((choice) => (
					<label key={choice.value}>
						<input type="radio" name={name} value={choice.value} id={idOf(name, choice.value)} />
						<span>{choice.label}</span>
					</label>
				))}
			</div>
			{reply.note && (
				<input
					type="text"
					class="note"
					id={`${idPart(name)}.note`}
					data-note=""
					aria-label={`${noteText}: ${label}`}
					placeholder={noteText}
				/>
			)}
		</fieldset>
	);
}
