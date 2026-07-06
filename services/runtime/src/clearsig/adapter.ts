import { compareDecimalStrings } from "../guard/amount.ts";
import { hashObject, sha256Hex } from "../guard/hash.ts";

export interface ClearSignInput {
  chainId: string;
  to: string;
  calldata?: string;
  value?: string;
  typedData?: unknown;
  expected: {
    merchantAddress?: string;
    amount?: string;
    tokenId?: string;
    allowedSelectors: string[];
    paymentContextHash?: string;
    allowedSpenders?: string[];
    functionAbis?: Array<{
      selector: string;
      signature: string;
    }>;
    paramsMatch?: Record<string, string | number | boolean>;
    messageMatch?: {
      requiredFields?: string[];
      contains?: Record<string, string | number | boolean>;
      paymentContextHash?: string;
    };
  };
}

export interface ClearSignResult {
  decision: "allow" | "require_approval" | "block";
  intent: string;
  functionSignature?: string;
  selector?: string;
  decodedParams?: Record<string, unknown>;
  calldataDigest?: string;
  typedDataDigest?: string;
  riskTags: string[];
  reason?: string;
}

const functionSignatures: Record<string, string> = {
  "0xa9059cbb": "transfer(address,uint256)",
  "0x095ea7b3": "approve(address,uint256)",
  "0x23b872dd": "transferFrom(address,address,uint256)",
  "0xac9650d8": "multicall(bytes[])",
  "0x40c10f19": "mint(address,uint256)",
  "0x2e1a7d4d": "withdraw(uint256)",
  "0xf8388f0f": "fund(bytes32,address,uint256)",
  "0x7249fbb6": "refund(bytes32)",
  "0x0fa566fa": "deliver(bytes32)"
};

const maxUint256 =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";

function normalizeHex(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]*$/.test(trimmed) || trimmed.length < 10) {
    throw new Error("Invalid calldata hex");
  }

  return trimmed;
}

function selectorOf(calldata: string): string {
  return calldata.slice(0, 10);
}

function readWord(calldata: string, index: number): string {
  const start = 10 + index * 64;
  const word = calldata.slice(start, start + 64);
  if (word.length !== 64) {
    throw new Error("Calldata word is missing");
  }

  return word;
}

function wordToAddress(word: string): string {
  return `0x${word.slice(24)}`.toLowerCase();
}

function wordToBigIntString(word: string): string {
  return BigInt(`0x${word}`).toString();
}

function wordToBytes32(word: string): string {
  return `0x${word}`.toLowerCase();
}

function sameAddress(left: string | undefined, right: string | undefined): boolean {
  if (left === undefined || right === undefined) {
    return false;
  }

  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function decodeKnownCalldata(calldata: string): {
  functionSignature?: string;
  decodedParams?: Record<string, unknown>;
  intent: string;
} {
  const selector = selectorOf(calldata);
  const functionSignature = functionSignatures[selector];

  if (functionSignature === "transfer(address,uint256)") {
    const recipient = wordToAddress(readWord(calldata, 0));
    const amount = wordToBigIntString(readWord(calldata, 1));
    return {
      functionSignature,
      decodedParams: { recipient, amount },
      intent: `Transfer ${amount} units to ${recipient}`
    };
  }

  if (functionSignature === "approve(address,uint256)") {
    const spender = wordToAddress(readWord(calldata, 0));
    const amount = wordToBigIntString(readWord(calldata, 1));
    return {
      functionSignature,
      decodedParams: { spender, amount },
      intent: `Approve ${spender} to spend ${amount} units`
    };
  }

  if (functionSignature === "transferFrom(address,address,uint256)") {
    const from = wordToAddress(readWord(calldata, 0));
    const recipient = wordToAddress(readWord(calldata, 1));
    const amount = wordToBigIntString(readWord(calldata, 2));
    return {
      functionSignature,
      decodedParams: { from, recipient, amount },
      intent: `Transfer ${amount} units from ${from} to ${recipient}`
    };
  }

  if (functionSignature === "multicall(bytes[])") {
    return {
      functionSignature,
      decodedParams: { nestedSelectors: findNestedSelectors(calldata) },
      intent: "Execute multicall"
    };
  }

  if (functionSignature === "fund(bytes32,address,uint256)") {
    const paymentContextHash = wordToBytes32(readWord(calldata, 0));
    const provider = wordToAddress(readWord(calldata, 1));
    const amount = wordToBigIntString(readWord(calldata, 2));
    return {
      functionSignature,
      decodedParams: { paymentContextHash, provider, amount },
      intent: `Fund ServiceEscrow ${paymentContextHash} for ${provider} with ${amount} wei`
    };
  }

  if (functionSignature === "refund(bytes32)") {
    const paymentContextHash = wordToBytes32(readWord(calldata, 0));
    return {
      functionSignature,
      decodedParams: { paymentContextHash },
      intent: `Refund ServiceEscrow ${paymentContextHash}`
    };
  }

  if (functionSignature === "deliver(bytes32)") {
    const paymentContextHash = wordToBytes32(readWord(calldata, 0));
    return {
      functionSignature,
      decodedParams: { paymentContextHash },
      intent: `Deliver ServiceEscrow ${paymentContextHash}`
    };
  }

  const result: {
    functionSignature?: string;
    decodedParams?: Record<string, unknown>;
    intent: string;
  } = {
    intent: functionSignature === undefined ? "Unknown calldata selector" : functionSignature
  };

  if (functionSignature !== undefined) {
    result.functionSignature = functionSignature;
  }

  return result;
}

function findNestedSelectors(calldata: string): string[] {
  const selectors = new Set<string>();
  for (const selector of Object.keys(functionSignatures)) {
    if (calldata.slice(10).includes(selector.slice(2))) {
      selectors.add(selector);
    }
  }

  return [...selectors];
}

function decisionFromTags(riskTags: string[]): ClearSignResult["decision"] {
  if (
    riskTags.some((tag) =>
      [
        "unknown_selector",
        "selector_not_allowed",
        "unlimited_approve",
        "spender_not_allowed",
        "recipient_mismatch",
        "amount_mismatch",
        "context_hash_mismatch",
        "function_abi_mismatch",
        "params_match_failed",
        "message_match_failed",
        "multicall_hidden_selector"
      ].includes(tag)
    )
  ) {
    return "block";
  }

  if (riskTags.includes("clearsig_unavailable")) {
    return "require_approval";
  }

  return "allow";
}

function decimalPlaces(value: string): number {
  const fraction = value.split(".")[1] ?? "";
  return fraction.length;
}

export function clearSign(input: ClearSignInput): ClearSignResult {
  const allowedSelectors = input.expected.allowedSelectors.map((selector) =>
    selector.toLowerCase()
  );
  const riskTags: string[] = [];
  const result: ClearSignResult = {
    decision: "allow",
    intent: "Typed data review",
    riskTags
  };

  if (input.typedData !== undefined) {
    result.typedDataDigest = hashObject(input.typedData);
    const typedDataText = JSON.stringify(input.typedData).toLowerCase();
    if (
      input.expected.paymentContextHash !== undefined &&
      !typedDataText.includes(input.expected.paymentContextHash.toLowerCase())
    ) {
      riskTags.push("context_hash_mismatch");
    }
    applyMessageMatchPolicy(input.typedData, input.expected.messageMatch, riskTags);
  }

  if (input.calldata === undefined) {
    if (input.typedData === undefined) {
      riskTags.push("clearsig_unavailable");
    }

    result.decision = decisionFromTags(riskTags);
    if (result.decision !== "allow") {
      result.reason =
        riskTags.length > 0
          ? `clearsig blocked typed data: ${riskTags.join(", ")}`
          : "No calldata or typed data was available for semantic review";
    }

    return result;
  }

  let calldata: string;
  try {
    calldata = normalizeHex(input.calldata);
  } catch (error) {
    return {
      decision: "block",
      intent: "Invalid calldata",
      riskTags: ["invalid_calldata"],
      reason: error instanceof Error ? error.message : "Invalid calldata",
      calldataDigest: sha256Hex(input.calldata)
    };
  }

  const selector = selectorOf(calldata);
  const decoded = decodeKnownCalldata(calldata);
  result.selector = selector;
  if (decoded.functionSignature !== undefined) {
    result.functionSignature = decoded.functionSignature;
  }

  if (decoded.decodedParams !== undefined) {
    result.decodedParams = decoded.decodedParams;
  }
  result.intent = decoded.intent;
  result.calldataDigest = sha256Hex(calldata);

  if (!allowedSelectors.includes(selector)) {
    riskTags.push(decoded.functionSignature === undefined ? "unknown_selector" : "selector_not_allowed");
  }

  if (
    input.expected.functionAbis !== undefined &&
    input.expected.functionAbis.length > 0 &&
    !input.expected.functionAbis.some(
      (abi) =>
        abi.selector.toLowerCase() === selector &&
        decoded.functionSignature === abi.signature
    )
  ) {
    riskTags.push("function_abi_mismatch");
  }

  if (decoded.functionSignature === "approve(address,uint256)") {
    const spender = String(decoded.decodedParams?.spender ?? "");
    const amount = String(decoded.decodedParams?.amount ?? "");
    const allowedSpenders = input.expected.allowedSpenders ?? [input.expected.merchantAddress].filter(Boolean);

    if (amount === maxUint256) {
      riskTags.push("unlimited_approve");
    }

    if (!allowedSpenders.some((allowed) => sameAddress(allowed, spender))) {
      riskTags.push("spender_not_allowed");
    }
  }

  if (
    decoded.functionSignature === "transfer(address,uint256)" ||
    decoded.functionSignature === "transferFrom(address,address,uint256)"
  ) {
    const recipient = String(decoded.decodedParams?.recipient ?? "");
    const amount = String(decoded.decodedParams?.amount ?? "");

    if (
      input.expected.merchantAddress !== undefined &&
      !sameAddress(input.expected.merchantAddress, recipient)
    ) {
      riskTags.push("recipient_mismatch");
    }

    if (
      input.expected.amount !== undefined &&
      compareDecimalStrings(amount, input.expected.amount, Math.max(decimalPlaces(amount), decimalPlaces(input.expected.amount)))
    ) {
      riskTags.push("amount_mismatch");
    }
  }

  if (decoded.functionSignature === "multicall(bytes[])") {
    const nestedSelectors = (decoded.decodedParams?.nestedSelectors as string[] | undefined) ?? [];
    const hidden = nestedSelectors.filter((nested) => !allowedSelectors.includes(nested));
    if (hidden.length > 0) {
      riskTags.push("multicall_hidden_selector");
    }
  }

  if (
    ["fund(bytes32,address,uint256)", "refund(bytes32)", "deliver(bytes32)"].includes(
      decoded.functionSignature ?? ""
    )
  ) {
    const paymentContextHash = String(decoded.decodedParams?.paymentContextHash ?? "");
    if (
      input.expected.paymentContextHash !== undefined &&
      paymentContextHash.toLowerCase() !== input.expected.paymentContextHash.toLowerCase()
    ) {
      riskTags.push("context_hash_mismatch");
    }
  }

  applyParamsMatchPolicy(decoded.decodedParams, input.expected.paramsMatch, riskTags);

  result.decision = decisionFromTags(riskTags);
  if (result.decision === "block") {
    result.reason = `clearsig blocked calldata: ${riskTags.join(", ")}`;
  }

  return result;
}

function applyParamsMatchPolicy(
  decodedParams: Record<string, unknown> | undefined,
  paramsMatch: Record<string, string | number | boolean> | undefined,
  riskTags: string[]
): void {
  if (paramsMatch === undefined) {
    return;
  }

  if (decodedParams === undefined) {
    riskTags.push("params_match_failed");
    return;
  }

  for (const [key, expected] of Object.entries(paramsMatch)) {
    const actual = decodedParams[key];
    const actualText = normalizeComparable(actual);
    const expectedText = normalizeComparable(expected);
    if (actualText !== expectedText) {
      riskTags.push("params_match_failed");
      return;
    }
  }
}

function applyMessageMatchPolicy(
  typedData: unknown,
  messageMatch: ClearSignInput["expected"]["messageMatch"],
  riskTags: string[]
): void {
  if (messageMatch === undefined) {
    return;
  }

  const flattened = flattenForMatch(typedData);
  for (const field of messageMatch.requiredFields ?? []) {
    if (!flattened.has(field.toLowerCase())) {
      riskTags.push("message_match_failed");
      return;
    }
  }

  for (const [field, expected] of Object.entries(messageMatch.contains ?? {})) {
    const actual = flattened.get(field.toLowerCase());
    if (actual === undefined || normalizeComparable(actual) !== normalizeComparable(expected)) {
      riskTags.push("message_match_failed");
      return;
    }
  }

  if (
    messageMatch.paymentContextHash !== undefined &&
    !JSON.stringify(typedData).toLowerCase().includes(messageMatch.paymentContextHash.toLowerCase())
  ) {
    riskTags.push("message_match_failed");
  }
}

function normalizeComparable(value: unknown): string {
  if (typeof value === "string") {
    return value.toLowerCase();
  }

  return String(value).toLowerCase();
}

function flattenForMatch(value: unknown, prefix = "", output = new Map<string, unknown>()): Map<string, unknown> {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      flattenForMatch(entry, prefix.length > 0 ? `${prefix}.${index}` : String(index), output);
    });
    return output;
  }

  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix.length > 0 ? `${prefix}.${key}` : key;
      output.set(path.toLowerCase(), entry);
      flattenForMatch(entry, path, output);
    }
    return output;
  }

  if (prefix.length > 0) {
    output.set(prefix.toLowerCase(), value);
  }

  return output;
}
