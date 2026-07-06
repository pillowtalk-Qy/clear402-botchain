import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "./guard/hash.ts";

export type MissionTimelineEventType = "mission" | "guard" | "receipt" | "attack";

export interface MissionTimelineEvent {
  id: string;
  missionId: string;
  type: MissionTimelineEventType;
  createdAt: number;
  payload: Record<string, unknown>;
}

export interface RecordMissionTimelineEventInput {
  id?: string;
  missionId: string;
  type: MissionTimelineEventType;
  createdAt?: number;
  payload: Record<string, unknown>;
}

export interface MissionTimelineQueryOptions {
  afterEventId?: string;
  limit?: number;
}

export interface MissionTimelineStreamOptions {
  lastEventId?: string;
  heartbeatIntervalMs?: number;
  pollIntervalMs?: number;
}

interface MissionTimelineRow {
  timelineId: number;
  eventId: string;
  missionId: string;
  eventType: MissionTimelineEventType;
  createdAt: number;
  payloadJson: string;
}

interface MissionRow {
  id: string;
  userPrompt: string;
  budgetUsd: string;
  status: string;
  cawWalletAddress: string | null;
  pactId: string | null;
  createdAt: number;
  updatedAt: number;
}

export function recordMissionTimelineEvent(
  database: DatabaseSync,
  input: RecordMissionTimelineEventInput
): MissionTimelineEvent {
  const event: MissionTimelineEvent = {
    id: input.id ?? createMissionTimelineEventId(input.type, input.missionId),
    missionId: input.missionId,
    type: input.type,
    createdAt: input.createdAt ?? Date.now(),
    payload: input.payload
  };

  database
    .prepare(
      `insert into mission_timeline_events (
        event_id,
        mission_id,
        event_type,
        created_at,
        payload_json
      ) values (?, ?, ?, ?, ?)`
    )
    .run(event.id, event.missionId, event.type, event.createdAt, canonicalJson(event.payload));

  return event;
}

export function readMissionTimelineEvents(
  database: DatabaseSync,
  missionId: string,
  options: MissionTimelineQueryOptions = {}
): MissionTimelineEvent[] {
  const cursor = resolveMissionTimelineCursor(database, missionId, options.afterEventId);
  const limitClause = typeof options.limit === "number" ? "limit ?" : "";
  const statement = database.prepare(
    `select
      timeline_id as timelineId,
      event_id as eventId,
      mission_id as missionId,
      event_type as eventType,
      created_at as createdAt,
      payload_json as payloadJson
    from mission_timeline_events
    where mission_id = ?
      ${cursor !== undefined ? "and timeline_id > ?" : ""}
    order by timeline_id asc
    ${limitClause}`
  );

  const rows = statement.all(
    ...(cursor !== undefined
      ? typeof options.limit === "number"
        ? [missionId, cursor, options.limit]
        : [missionId, cursor]
      : typeof options.limit === "number"
        ? [missionId, options.limit]
        : [missionId])
  ) as unknown as MissionTimelineRow[];

  return rows.map(toMissionTimelineEvent);
}

export function buildMissionTimeline(
  database: DatabaseSync,
  missionId: string,
  options: MissionTimelineQueryOptions = {}
): { found: boolean; events: MissionTimelineEvent[] } {
  const mission = readMission(database, missionId);
  if (!mission) {
    return { found: false, events: [] };
  }

  return {
    found: true,
    events: readMissionTimelineEvents(database, missionId, options)
  };
}

export function serializeMissionTimelineEvent(event: MissionTimelineEvent): string {
  return [
    `id: ${event.id}`,
    `event: ${event.type}`,
    `data: ${JSON.stringify({
      eventId: event.id,
      eventType: event.type,
      createdAt: event.createdAt,
      missionId: event.missionId,
      payload: event.payload
    })}`,
    ""
  ].join("\n");
}

export function serializeMissionTimelineHeartbeat(createdAt = Date.now()): string {
  return `: heartbeat ${new Date(createdAt).toISOString()}\n\n`;
}

export function serializeMissionTimelineBatch(events: MissionTimelineEvent[]): string {
  return events.map(serializeMissionTimelineEvent).join("");
}

export function startMissionTimelineStream(
  response: ServerResponse,
  database: DatabaseSync,
  missionId: string,
  options: MissionTimelineStreamOptions = {}
): boolean {
  const mission = readMission(database, missionId);
  if (!mission) {
    return false;
  }

  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15_000;
  let lastEventId = options.lastEventId;
  let lastHeartbeatAt = Date.now();
  let closed = false;
  let interval: NodeJS.Timeout | undefined;

  const write = (chunk: string) => {
    if (!closed) {
      response.write(chunk);
    }
  };

  const deliverEvents = () => {
    const queryOptions: MissionTimelineQueryOptions = {};
    if (lastEventId !== undefined) {
      queryOptions.afterEventId = lastEventId;
    }
    const events = readMissionTimelineEvents(database, missionId, queryOptions);
    if (events.length > 0) {
      write(serializeMissionTimelineBatch(events));
      lastEventId = events.at(-1)?.id ?? lastEventId;
      lastHeartbeatAt = Date.now();
      return true;
    }

    return false;
  };

  const tick = () => {
    if (closed) {
      return;
    }

    const delivered = deliverEvents();
    if (!delivered && Date.now() - lastHeartbeatAt >= heartbeatIntervalMs) {
      write(serializeMissionTimelineHeartbeat());
      lastHeartbeatAt = Date.now();
    }
  };

  response.statusCode = 200;
  response.setHeader("content-type", "text/event-stream; charset=utf-8");
  response.setHeader("cache-control", "no-store, no-transform");
  response.setHeader("connection", "keep-alive");
  response.setHeader("x-accel-buffering", "no");
  response.setHeader("access-control-allow-origin", "*");
  response.write(": clear402 mission timeline\n\n");
  response.flushHeaders?.();

  const initialDelivered = deliverEvents();
  if (!initialDelivered) {
    lastHeartbeatAt = Date.now();
  }

  interval = setInterval(tick, pollIntervalMs);
  response.on("close", () => {
    closed = true;
    if (interval) {
      clearInterval(interval);
    }
  });

  return true;
}

function readMission(database: DatabaseSync, missionId: string): MissionRow | undefined {
  return database
    .prepare(
      `select
        id,
        user_prompt as userPrompt,
        budget_usd as budgetUsd,
        status,
        caw_wallet_address as cawWalletAddress,
        pact_id as pactId,
        created_at as createdAt,
        updated_at as updatedAt
      from missions
      where id = ?`
    )
    .get(missionId) as MissionRow | undefined;
}

function resolveMissionTimelineCursor(
  database: DatabaseSync,
  missionId: string,
  lastEventId?: string
): number | undefined {
  if (!lastEventId) {
    return undefined;
  }

  const row = database
    .prepare(
      `select timeline_id as timelineId
      from mission_timeline_events
      where mission_id = ? and event_id = ?`
    )
    .get(missionId, lastEventId) as { timelineId: number } | undefined;

  return row?.timelineId;
}

function toMissionTimelineEvent(row: MissionTimelineRow): MissionTimelineEvent {
  return {
    id: row.eventId,
    missionId: row.missionId,
    type: row.eventType,
    createdAt: row.createdAt,
    payload: parseJsonObject(row.payloadJson)
  };
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createMissionTimelineEventId(type: MissionTimelineEventType, missionId: string) {
  return `timeline_${type}_${missionId}_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

export function buildMissionTimelineEventFromGuard(row: {
  layer: string;
  decision: string;
  reason: string | null;
  evidenceJson: string;
  createdAt: number;
}) {
  const evidence = parseJsonObject(row.evidenceJson);
  const evidenceMode = evidence.evidenceMode === "live" || evidence.evidenceMode === "mock" || evidence.evidenceMode === "fallback"
    ? evidence.evidenceMode
    : "fallback";
  return {
    title: `Guard ${row.decision}`,
    detail: row.reason ?? `Guard layer ${row.layer} produced ${row.decision}.`,
    status:
      row.decision === "allow"
        ? "success"
        : row.decision === "require_approval"
          ? "pending_approval"
          : row.decision === "block"
            ? "blocked"
            : "fallback",
    evidenceMode,
    layer: row.layer,
    decision: row.decision,
    reason: row.reason,
    evidence
  };
}

export function buildMissionTimelineEventFromReceipt(row: {
  receiptId: string;
  paymentContextHash: string;
  cawRequestId: string | null;
  txHash: string | null;
  status: string;
  evidenceMode: string;
}) {
  return {
    title: "Receipt recorded",
    detail:
      row.txHash === null
        ? "Receipt is recorded without claiming a live CAW transaction hash."
        : "Receipt is recorded with transaction evidence.",
    status: row.status === "delivered" ? "success" : "fallback",
    evidenceMode: row.evidenceMode,
    receiptId: row.receiptId,
    paymentContextHash: row.paymentContextHash,
    cawRequestId: row.cawRequestId,
    txHash: row.txHash,
    receiptStatus: row.status
  };
}
