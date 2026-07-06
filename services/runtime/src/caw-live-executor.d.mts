import type { PaymentContext } from "../../../packages/shared/src/index.mjs";

export declare function getCawLivePrerequisites(env?: Record<string, string | undefined>): string[];

export declare function createCawLiveExecutor(options?: {
  env?: Record<string, string | undefined>;
  sdkLoader?: () => Promise<unknown>;
  auditLimit?: number;
  cache?: Map<string, unknown>;
}): (input: {
  paymentContext: PaymentContext;
  paymentContextHash: string;
  attemptedOperation?: "transfer" | "contract_call" | "message_sign";
  requestId: string;
  contractAddress?: string;
  calldata?: string;
  amount?: string;
}) => Promise<unknown>;

export declare function toCawDecimalAmount(amount: string, decimals: number): string;
