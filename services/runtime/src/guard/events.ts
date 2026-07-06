import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { GuardDecision, GuardEvent } from "../../../../packages/shared/src/index.mjs";
import { canonicalJson } from "./hash.ts";
import {
  buildMissionTimelineEventFromGuard,
  recordMissionTimelineEvent
} from "../mission_timeline.ts";

export interface RecordGuardEventInput {
  id?: string;
  missionId: string;
  layer: string;
  decision: GuardDecision;
  reason?: string;
  evidenceJson: Record<string, unknown>;
  createdAt?: number;
}

export function recordGuardEvent(
  database: DatabaseSync,
  input: RecordGuardEventInput
): GuardEvent {
  const event: GuardEvent = {
    id: input.id ?? `evt_${randomUUID()}`,
    missionId: input.missionId,
    layer: input.layer,
    decision: input.decision,
    evidenceJson: input.evidenceJson,
    createdAt: input.createdAt ?? Date.now()
  };

  if (input.reason !== undefined) {
    event.reason = input.reason;
  }

  database
    .prepare(
      `insert into guard_events (
        id,
        mission_id,
        layer,
        decision,
        reason,
        evidence_json,
        created_at
      ) values (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      event.id,
      event.missionId,
      event.layer,
      event.decision,
      event.reason ?? null,
      canonicalJson(event.evidenceJson),
      event.createdAt
    );

  recordMissionTimelineEvent(database, {
    id: event.id,
    missionId: event.missionId,
    type: "guard",
    createdAt: event.createdAt,
    payload: buildMissionTimelineEventFromGuard({
      layer: event.layer,
      decision: event.decision,
      reason: event.reason ?? null,
      evidenceJson: canonicalJson(event.evidenceJson),
      createdAt: event.createdAt
    })
  });

  return event;
}

export function listGuardEvents(database: DatabaseSync, missionId: string): GuardEvent[] {
  const rows = database
    .prepare(
      `select
        id,
        mission_id as missionId,
        layer,
        decision,
        reason,
        evidence_json as evidenceJson,
        created_at as createdAt
      from guard_events
      where mission_id = ?
      order by created_at asc, id asc`
    )
    .all(missionId) as Array<{
    id: string;
    missionId: string;
    layer: string;
    decision: GuardDecision;
    reason: string | null;
    evidenceJson: string;
    createdAt: number;
  }>;

  return rows.map((row) => {
    const event: GuardEvent = {
      id: row.id,
      missionId: row.missionId,
      layer: row.layer,
      decision: row.decision,
      evidenceJson: JSON.parse(row.evidenceJson) as Record<string, unknown>,
      createdAt: row.createdAt
    };

    if (row.reason !== null) {
      event.reason = row.reason;
    }

    return event;
  });
}
