import { sha256Hex } from "../../../packages/shared/src/index.mjs";

export const DEBUG_PAYMENT_KEY_ID = "clear402-local-debug-key-v1";
export const DEBUG_PAYMENT_KEY = "clear402 local debug payment key - not a secret";

export const DEFAULT_PROVIDER_CONFIG = Object.freeze({
  providerId: "local-provider-x402",
  origin: "http://localhost:4010",
  merchantAddress: "0xA882b939c4Ca15c904760b8c240124Cb68cc2A88",
  network: "botchain-testnet",
  chainId: "968",
  tokenId: "BOT",
  asset: "BOT",
  amount: "1000000000000",
  amountDecimals: 18,
  facilitatorUrl: "https://facilitator.local.clear402.test/botchain",
  challengeTtlMs: 5 * 60 * 1000,
  providerPublicKey: sha256Hex(DEBUG_PAYMENT_KEY),
  allowedResources: ["/paid/report"]
});
