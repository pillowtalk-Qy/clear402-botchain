import type { IncomingMessage, Server, ServerResponse } from "node:http";

export interface ProviderState {
  issuedChallenges: Map<string, unknown>;
}

export declare function createProviderState(): ProviderState;

export declare function createProviderHttpHandler(options?: {
  config?: Record<string, unknown>;
  state?: ProviderState;
  clock?: () => number;
}): (request: IncomingMessage, response: ServerResponse) => Promise<void>;

export declare function createProviderServer(options?: {
  config?: Record<string, unknown>;
  state?: ProviderState;
  clock?: () => number;
}): Server;
