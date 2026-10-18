/**
 * Side-by-side layout of overlapping intervals for the planning (spec § 7):
 * occurrences that overlap share their column width. Intervals are [start,
 * end) in any unit (ms or minutes); touching intervals do not overlap.
 */
export type LaneItem = { id: string; start: number; end: number };
/** lane: 0-based column; lanes: columns used by the item's overlap cluster. */
export type LaneSlot = { lane: number; lanes: number };

/** Sorted by (start, end desc, id); clusters of transitively overlapping items; greedy first free lane; every item gets its cluster's lane count; touching intervals do not overlap. */
export function layoutLanes(items: readonly LaneItem[]): Map<string, LaneSlot> {
  const sorted = [...items].sort(
    (a, b) => a.start - b.start || b.end - a.end || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const result = new Map<string, LaneSlot>();
  let cluster: { id: string; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;

  const close = () => {
    for (const member of cluster) result.set(member.id, { lane: member.lane, lanes: laneEnds.length });
    cluster = [];
    laneEnds = [];
  };

  for (const item of sorted) {
    if (item.start >= clusterEnd) close();
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.end);
    } else {
      laneEnds[lane] = item.end;
    }
    cluster.push({ id: item.id, lane });
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  close();
  return result;
}
