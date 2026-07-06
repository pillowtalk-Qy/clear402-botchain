import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import {
  healthResponseSchema,
  problemJsonSchema,
  type HealthResponse
} from "../../../packages/shared/src/index.js";
import { initializeRuntimeDatabase } from "./db/init.js";
import {
  buildEvidenceExport,
  parseEvidenceExportPath,
  renderEvidenceExportMarkdown,
  serializeEvidenceExportJson
} from "./evidence_export.js";
import { startMissionTimelineStream } from "./mission_timeline.js";
import {
  createMission,
  dryRunMission,
  getMission,
  guardMission,
  MissionFlowError,
  verifyMission
} from "./mission_flow.js";

const runtimeVersion = "0.1.0";
const runtimeServiceName = "runtime";
const runtimePort = Number.parseInt(process.env.RUNTIME_PORT ?? "4000", 10);
const runtimeHost = process.env.RUNTIME_HOST ?? "127.0.0.1";
const runtimeDatabasePath = process.env.CLEAR402_RUNTIME_DATABASE_PATH;

function jsonResponse(
  response: ServerResponse,
  statusCode: number,
  payload: unknown
) {
  const body = JSON.stringify(payload);
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(body);
}

function textResponse(
  response: ServerResponse,
  statusCode: number,
  body: string,
  contentType: string
) {
  response.statusCode = statusCode;
  response.setHeader("content-type", contentType);
  response.setHeader("cache-control", "no-store");
  response.end(body);
}

function buildRuntimeHealth(databasePath: string): HealthResponse {
  return healthResponseSchema.parse({
    service: runtimeServiceName,
    status: "ok",
    evidenceMode: "live",
    timestamp: new Date().toISOString(),
    version: runtimeVersion,
    details: {
      databasePath,
      schemaVersion: 1
    }
  });
}

function buildProblem(code: string, message: string, details?: Record<string, unknown>) {
  return problemJsonSchema.parse({
    code,
    message,
    details
  });
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const body = Buffer.concat(chunks).toString("utf8");
  if (body.trim().length === 0) {
    return {};
  }

  return JSON.parse(body) as unknown;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  databasePath: string,
  database: DatabaseSync
) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "GET" && url.pathname === "/health") {
    jsonResponse(response, 200, buildRuntimeHealth(databasePath));
    return;
  }

  const timelineRoute = url.pathname.match(/^\/api\/missions\/([^/]+)\/timeline\.sse$/);
  if (timelineRoute) {
    if (request.method !== "GET") {
      jsonResponse(
        response,
        405,
        buildProblem("METHOD_NOT_ALLOWED", "Only GET is supported for mission timeline SSE.", {
          path: url.pathname
        })
      );
      return;
    }

    const missionId = decodeURIComponent(timelineRoute[1] ?? "");
    const streamOptions: Parameters<typeof startMissionTimelineStream>[3] = {};
    const lastEventId = request.headers["last-event-id"];
    if (lastEventId !== undefined) {
      streamOptions.lastEventId = String(lastEventId);
    }
    const found = startMissionTimelineStream(response, database, missionId, streamOptions);
    if (!found) {
      jsonResponse(
        response,
        404,
        buildProblem("MISSION_NOT_FOUND", "Mission not found for timeline stream.", {
          missionId
        })
      );
      return;
    }

    return;
  }

  const missionRoute = url.pathname.match(/^\/api\/missions(?:\/([^/]+)(?:\/([^/]+))?)?$/);
  if (missionRoute) {
    try {
      const missionId = missionRoute[1] ? decodeURIComponent(missionRoute[1]) : undefined;
      const action = missionRoute[2] ? decodeURIComponent(missionRoute[2]) : undefined;

      if (request.method === "POST" && missionId === undefined && action === undefined) {
        const body = await readJsonBody(request);
        jsonResponse(response, 201, createMission(database, body as Record<string, unknown>));
        return;
      }

      if (request.method === "GET" && missionId !== undefined && action === undefined) {
        jsonResponse(response, 200, getMission(database, missionId));
        return;
      }

      if (request.method === "POST" && missionId !== undefined && action === "dry-run") {
        jsonResponse(response, 200, dryRunMission(database, missionId));
        return;
      }

      if (request.method === "POST" && missionId !== undefined && action === "guard") {
        jsonResponse(response, 200, await guardMission(database, missionId));
        return;
      }

      if (request.method === "POST" && missionId !== undefined && action === "verify") {
        jsonResponse(response, 200, verifyMission(database, missionId));
        return;
      }

      jsonResponse(
        response,
        405,
        buildProblem("METHOD_NOT_ALLOWED", "Unsupported mission route method.", {
          path: url.pathname,
          method: request.method ?? "GET"
        })
      );
      return;
    } catch (error) {
      if (error instanceof SyntaxError) {
        jsonResponse(
          response,
          400,
          buildProblem("INVALID_JSON", "Request body must be valid JSON.", {
            path: url.pathname
          })
        );
        return;
      }

      if (error instanceof MissionFlowError) {
        jsonResponse(
          response,
          error.statusCode,
          buildProblem(error.code, error.message, error.details)
        );
        return;
      }

      jsonResponse(
        response,
        500,
        buildProblem("MISSION_FLOW_ERROR", "Mission flow request failed.", {
          error: error instanceof Error ? error.message : String(error)
        })
      );
      return;
    }
  }

  const evidenceExportPath = parseEvidenceExportPath(url.pathname);
  if (evidenceExportPath !== null) {
    if (request.method !== "GET") {
      jsonResponse(
        response,
        405,
        buildProblem("METHOD_NOT_ALLOWED", "Only GET is supported for evidence export.", {
          path: url.pathname
        })
      );
      return;
    }

    const result = buildEvidenceExport(database, evidenceExportPath.missionId);
    if (!result.found || !result.export) {
      jsonResponse(
        response,
        404,
        buildProblem("EVIDENCE_NOT_FOUND", "Evidence export not found for mission.", {
          missionId: evidenceExportPath.missionId
        })
      );
      return;
    }

    if (evidenceExportPath.format === "json") {
      textResponse(
        response,
        200,
        serializeEvidenceExportJson(result.export),
        "application/json; charset=utf-8"
      );
      return;
    }

    textResponse(
      response,
      200,
      renderEvidenceExportMarkdown(result.export),
      "text/markdown; charset=utf-8"
    );
    return;
  }

  jsonResponse(
    response,
    404,
    buildProblem("NOT_FOUND", "Route not found", { path: url.pathname })
  );
}

export function startRuntimeServer(options: {
  host?: string;
  port?: number;
  databasePath?: string;
} = {}) {
  const host = options.host ?? runtimeHost;
  const port = options.port ?? runtimePort;
  const databaseOptions: { databasePath?: string } = {};
  const selectedDatabasePath = options.databasePath ?? runtimeDatabasePath;

  if (selectedDatabasePath) {
    databaseOptions.databasePath = selectedDatabasePath;
  }

  const { database, databasePath } = initializeRuntimeDatabase(databaseOptions);

  const server = createServer((request, response) => {
    void handleRequest(request, response, databasePath, database);
  });

  return new Promise<{
    server: ReturnType<typeof createServer>;
    databasePath: string;
    close: () => Promise<void>;
    port: number;
  }>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      const actualPort =
        typeof address === "object" && address !== null ? address.port : port;

      resolve({
        server,
        databasePath,
        port: actualPort,
        close: async () => {
          await new Promise<void>((closeResolve, closeReject) => {
            server.close((error) => {
              database.close();
              if (error) {
                closeReject(error);
                return;
              }

              closeResolve();
            });
          });
        }
      });
    });
  });
}

const mainPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
const isMainModule = mainPath !== null && import.meta.url === mainPath;

if (isMainModule) {
  const started = await startRuntimeServer();
  console.log(
    JSON.stringify(
      {
        service: runtimeServiceName,
        status: "listening",
        port: started.port,
        databasePath: started.databasePath
      },
      null,
      2
    )
  );
}
