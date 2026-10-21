/**
 * The questions of an event are copied, under new ids, onto the next segment when a series is split (src/lib/booking/series.ts),
 * so an information edit that reaches a later segment cannot reuse the ids of the segment the pro edited. Pure.
 */
import type { QuestionRow } from "@/lib/booking/answers";

/**
 * The question list to send for ANOTHER segment of the same series: each question the pro kept (it carries the id it
 * has on the edited segment, `source`) follows the copy at the same place in that segment's own list (`target`), so the
 * answers already given there stay attached; any other question is new there, with no id. A copy is followed only when
 * it still is the same question (same label and type: it may have been edited on its own since) and only once.
 * The order of the result is the order of `patch`.
 */
export function questionsForSegment<Q extends { id?: string }>(
  patch: readonly Q[],
  source: readonly QuestionRow[],
  target: readonly QuestionRow[],
): Q[] {
  const used = new Set<string>();
  return patch.map((q) => {
    const { id, ...rest } = q;
    const at = id === undefined ? -1 : source.findIndex((s) => s.id === id);
    const was = source[at];
    const copy = at === -1 ? undefined : target[at];
    if (copy && was && copy.label === was.label && copy.type === was.type && !used.has(copy.id)) {
      used.add(copy.id);
      return { ...rest, id: copy.id } as unknown as Q;
    }
    return rest as unknown as Q;
  });
}
