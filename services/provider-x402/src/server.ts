import { pathToFileURL } from "node:url";
import { createServer, type ServerResponse } from "node:http";

import {
  healthResponseSchema,
  type HealthResponse
} from "../../../packages/shared/src/index.js";
import { createProviderHttpHandler, createProviderState } from "./http.mjs";

const providerServiceName = "provider-x402";
const providerVersion = "0.1.0";
const providerPort = Number.parseInt(process.env.PROVIDER_X402_PORT ?? "4010", 10);
const providerHost = process.env.PROVIDER_X402_HOST ?? "127.0.0.1";

export function startProviderServer(options: { host?: string; port?: number } = {}) {
  const host = options.host ?? providerHost;
  const port = options.port ?? providerPort;
  const state = createProviderState();
  const providerHandler = createProviderHttpHandler({ state });

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, buildProviderHealth());
    }

    return providerHandler(request, response);
  });

  return new Promise<{
    server: ReturnType<typeof createServer>;
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
        port: actualPort,
        close: async () => {
          await new Promise<void>((closeResolve, closeReject) => {
            server.close((error: unknown) => {
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

function buildProviderHealth(): HealthResponse {
  return healthResponseSchema.parse({
    service: providerServiceName,
    status: "ok",
    evidenceMode: "live",
    timestamp: new Date().toISOString(),
    version: providerVersion,
    details: {
      protocol: "x402",
      challengeMode: "foundation"
    }
  });
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(body));
}

const mainPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
const isMainModule = mainPath !== null && import.meta.url === mainPath;

if (isMainModule) {
  const started = await startProviderServer();
  console.log(
    JSON.stringify(
      {
        service: providerServiceName,
        status: "listening",
        port: started.port
      },
      null,
      2
    )
  );
}
