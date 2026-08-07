import type { SessionSummary } from "../../shared/protocol";

export const MAX_VISIBLE_SESSIONS = 8;

export interface SessionListGroups {
  recent: SessionSummary[];
  older: SessionSummary[];
}

export function splitSessionList(
  sessions: SessionSummary[],
  visibleLimit: number = MAX_VISIBLE_SESSIONS,
): SessionListGroups {
  const sorted = [...sessions].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt);
    const rightTime = Date.parse(right.updatedAt);
    if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return 0;
    if (Number.isNaN(leftTime)) return 1;
    if (Number.isNaN(rightTime)) return -1;
    return rightTime - leftTime;
  });

  return {
    recent: sorted.slice(0, visibleLimit),
    older: sorted.slice(visibleLimit),
  };
}
