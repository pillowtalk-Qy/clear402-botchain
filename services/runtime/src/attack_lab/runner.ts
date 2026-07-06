import { createServer } from "node:http";

import { createProblem, hashObject } from "../../../../packages/shared/src/index.mjs";
import {
  buildEvidenceExport,
  parseEvidenceExportPath,
  renderEvidenceExportMarkdown,
  serializeEvidenceExportJson
} from "../evidence_export.ts";
import { probeCawCapabilities } from "../caw-capabilities.mjs";
import { ATTACK_NAMES, runAllScenarios, runScenarioByName } from "./scenarios.ts";

let cachedCapabilityReport: unknown;

export function getAttackLabCapabilityReport() {
  if (cachedCapabilityReport === undefined) {
    cachedCapabilityReport = probeCawCapabilities();
  }

  return cachedCapabilityReport;
}

export function listAttackLabScenarios() {
  return [...ATTACK_NAMES];
}

export async function runAttackLabScenario(
  attackName: string,
  options: {
    capabilityReport?: unknown;
    now?: number;
  } = {}
) {
  if (!ATTACK_NAMES.includes(attackName as never)) {
    throw new Error(`Unknown attack: ${attackName}`);
  }

  const scenarioOptions = {
    capabilityReport: options.capabilityReport ?? getAttackLabCapabilityReport(),
    ...(options.now !== undefined ? { now: options.now } : {})
  };

  return runScenarioByName(attackName, scenarioOptions);
}

export async function runAllAttackLabScenarios(options: {
  capabilityReport?: unknown;
  now?: number;
} = {}) {
  const scenarioOptions = {
    capabilityReport: options.capabilityReport ?? getAttackLabCapabilityReport(),
    ...(options.now !== undefined ? { now: options.now } : {})
  };

  return runAllScenarios(scenarioOptions);
}

export function createAttackLabRouteHandler(options: {
  capabilityReport?: unknown;
  now?: number;
} = {}) {
  return async function handleAttackLabRoute(request: Request) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/attacks\/([^/]+)\/run$/);

    if (!match) {
      return jsonResponse(404, createProblem("NOT_FOUND", "Attack route not found."));
    }

    if (request.method !== "POST") {
      return jsonResponse(
        405,
        createProblem("METHOD_NOT_ALLOWED", "Only POST is supported for attack runs.")
      );
    }

    let body: { now?: number } | undefined;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      return jsonResponse(
        400,
        createProblem("INVALID_JSON", "Attack request body must be valid JSON.", {
          error: error instanceof Error ? error.message : String(error)
        })
      );
    }

    const attackName = decodeURIComponent(match[1] ?? "");

    try {
      const result = await runAttackLabScenario(attackName, {
        capabilityReport: options.capabilityReport,
        ...(body?.now !== undefined
          ? { now: body.now }
          : options.now !== undefined
            ? { now: options.now }
            : {})
      });

      return jsonResponse(200, {
        ok: true,
        requestId: `attack_${hashObject({ attackName, now: body?.now ?? options.now }).slice(0, 16)}`,
        ...result
      });
    } catch (error) {
      return jsonResponse(
        404,
        createProblem(
          "ATTACK_NOT_FOUND",
          error instanceof Error ? error.message : "Unknown attack",
          { attackName }
        )
      );
    }
  };
}

export function createRuntimeHttpHandler(options: {
  capabilityReport?: unknown;
  now?: number;
} = {}) {
  const attackHandler = createAttackLabRouteHandler(options);

  return async function handleRuntimeRequest(request: Request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse(200, {
        service: "runtime",
        status: "ok",
        evidenceMode: "fallback",
        attackLab: true
      });
    }

    const evidenceExportPath = parseEvidenceExportPath(url.pathname);
    if (evidenceExportPath !== null) {
      if (request.method !== "GET") {
        return jsonResponse(
          405,
          createProblem("METHOD_NOT_ALLOWED", "Only GET is supported for evidence export.")
        );
      }

      const result = buildEvidenceExport(undefined, evidenceExportPath.missionId, {
        capabilityReport: options.capabilityReport,
        ...(options.now !== undefined ? { now: options.now } : {})
      });
      if (!result.found || !result.export) {
        return jsonResponse(
          404,
          createProblem("EVIDENCE_NOT_FOUND", "Evidence export not found for mission.", {
            missionId: evidenceExportPath.missionId
          })
        );
      }

      if (evidenceExportPath.format === "json") {
        return textResponse(
          200,
          serializeEvidenceExportJson(result.export),
          "application/json; charset=utf-8"
        );
      }

      return textResponse(
        200,
        renderEvidenceExportMarkdown(result.export),
        "text/markdown; charset=utf-8"
      );
    }

    if (url.pathname.startsWith("/api/attacks/")) {
      return attackHandler(request);
    }

    return jsonResponse(404, createProblem("NOT_FOUND", "Route not found.", { path: url.pathname }));
  };
}

export function createRuntimeServer(options: {
  capabilityReport?: unknown;
  now?: number;
} = {}) {
  const handler = createRuntimeHttpHandler(options);

  return createServer(async (request, response) => {
    try {
      const bodyText = await readNodeBody(request);
      const headers = normalizeNodeHeaders(request.headers);
      const requestInit = {
        method: request.method ?? "GET",
        headers,
        ...(request.method === "GET" || request.method === "HEAD"
          ? {}
          : { body: bodyText })
      };
      const responseBody = await handler(
        new Request(
          `http://${request.headers.host ?? "127.0.0.1"}${request.url}`,
          requestInit
        )
      );

      const text = await responseBody.text();
      response.writeHead(responseBody.status, Object.fromEntries(responseBody.headers.entries()));
      response.end(text);
    } catch (error) {
      const fallback = jsonResponse(
        500,
        createProblem("RUNTIME_INTERNAL_ERROR", "Runtime request failed.", {
          error: error instanceof Error ? error.message : String(error)
        })
      );
      const text = await fallback.text();
      response.writeHead(fallback.status, Object.fromEntries(fallback.headers.entries()));
      response.end(text);
    }
  });
}

async function readJsonBody(request: Request) {
  if (!request.body) {
    return undefined;
  }

  const text = await request.text();
  if (text.trim().length === 0) {
    return undefined;
  }

  return JSON.parse(text) as { now?: number };
}

async function readNodeBody(request: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

function normalizeNodeHeaders(
  headers: import("node:http").IncomingHttpHeaders
): Record<string, string> {
  const entries: Array<[string, string]> = [];
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }

    entries.push([name, Array.isArray(value) ? value.join(", ") : value]);
  }

  return Object.fromEntries(entries);
}

function jsonResponse(status: number, body: unknown) {
  const payload = JSON.stringify(body, null, 2);
  return new Response(payload, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-length": String(Buffer.byteLength(payload))
    }
  });
}

function textResponse(status: number, body: string, contentType: string) {
  return new Response(body, {
    status,
    headers: {
      "content-type": contentType,
      "content-length": String(Buffer.byteLength(body))
    }
  });
}
