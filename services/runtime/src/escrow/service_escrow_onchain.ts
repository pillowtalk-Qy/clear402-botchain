import { sha256Hex } from "../guard/hash.ts";

export const SERVICE_ESCROW_FUND_SELECTOR = "0xf8388f0f";
export const SERVICE_ESCROW_REFUND_SELECTOR = "0x7249fbb6";
export const SERVICE_ESCROW_DELIVER_SELECTOR = "0x0fa566fa";

export const SERVICE_ESCROW_FUNCTION_ABIS = [
  {
    selector: SERVICE_ESCROW_FUND_SELECTOR,
    signature: "fund(bytes32,address,uint256)"
  },
  {
    selector: SERVICE_ESCROW_REFUND_SELECTOR,
    signature: "refund(bytes32)"
  },
  {
    selector: SERVICE_ESCROW_DELIVER_SELECTOR,
    signature: "deliver(bytes32)"
  }
] as const;

export interface ServiceEscrowFundCalldataInput {
  paymentContextHash: string;
  providerAddress: string;
  amount: string;
}

export interface ServiceEscrowRefundCalldataInput {
  paymentContextHash: string;
}

export interface ServiceEscrowCalldataPolicy {
  selector: string;
  functionSignature: string;
  paramsMatch: Record<string, string>;
  paymentContextHash: string;
  calldataDigest: string;
}

export function buildServiceEscrowFundCalldata(
  input: ServiceEscrowFundCalldataInput
): {
  calldata: string;
  value: string;
  policy: ServiceEscrowCalldataPolicy;
} {
  const paymentContextHash = normalizeBytes32(input.paymentContextHash, "paymentContextHash");
  const provider = normalizeAddress(input.providerAddress, "providerAddress");
  const amount = normalizeUint256(input.amount, "amount");
  const calldata = `${SERVICE_ESCROW_FUND_SELECTOR}${paymentContextHash.slice(2)}${addressWord(provider)}${uint256Word(amount)}`;

  return {
    calldata,
    value: amount,
    policy: {
      selector: SERVICE_ESCROW_FUND_SELECTOR,
      functionSignature: "fund(bytes32,address,uint256)",
      paramsMatch: {
        paymentContextHash,
        provider,
        amount
      },
      paymentContextHash,
      calldataDigest: sha256Hex(calldata)
    }
  };
}

export function buildServiceEscrowRefundCalldata(
  input: ServiceEscrowRefundCalldataInput
): {
  calldata: string;
  policy: ServiceEscrowCalldataPolicy;
} {
  const paymentContextHash = normalizeBytes32(input.paymentContextHash, "paymentContextHash");
  const calldata = `${SERVICE_ESCROW_REFUND_SELECTOR}${paymentContextHash.slice(2)}`;

  return {
    calldata,
    policy: {
      selector: SERVICE_ESCROW_REFUND_SELECTOR,
      functionSignature: "refund(bytes32)",
      paramsMatch: {
        paymentContextHash
      },
      paymentContextHash,
      calldataDigest: sha256Hex(calldata)
    }
  };
}

export function serviceEscrowAmountFromPaymentContext(amount: string, amountDecimals: number): string {
  if (!Number.isSafeInteger(amountDecimals) || amountDecimals < 0) {
    throw new TypeError("amountDecimals must be a non-negative safe integer");
  }
  return normalizeUint256(amount, "amount");
}

export function normalizeBytes32(value: string, fieldName: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(normalized)) {
    throw new TypeError(`${fieldName} must be a 0x-prefixed bytes32 value`);
  }
  return normalized;
}

function normalizeAddress(value: string, fieldName: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(normalized)) {
    throw new TypeError(`${fieldName} must be a 0x-prefixed EVM address`);
  }
  return normalized;
}

function normalizeUint256(value: string, fieldName: string): string {
  if (!/^[0-9]+$/.test(value)) {
    throw new TypeError(`${fieldName} must be a base-10 uint256 string`);
  }
  const parsed = BigInt(value);
  if (parsed < 0n || parsed > 2n ** 256n - 1n) {
    throw new TypeError(`${fieldName} is outside uint256 range`);
  }
  return parsed.toString();
}

function addressWord(address: string): string {
  return address.slice(2).padStart(64, "0");
}

function uint256Word(value: string): string {
  return BigInt(value).toString(16).padStart(64, "0");
}
