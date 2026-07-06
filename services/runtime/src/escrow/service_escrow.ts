import type { EvidenceMode } from "../../../../packages/shared/src/index.mjs";
import { hashObject } from "../guard/hash.ts";

export type ServiceEscrowState = "open" | "funded" | "delivered" | "refunded";

export interface ServiceEscrowAccount {
  escrowId: string;
  paymentContextHash: string;
  payer: string;
  provider: string;
  amount: string;
  state: ServiceEscrowState;
  fundedAt?: number;
  deliveredAt?: number;
  refundedAt?: number;
  refundReason?: string;
  evidenceMode: EvidenceMode;
  events: ServiceEscrowEvent[];
}

export interface ServiceEscrowEvent {
  type: "fund" | "deliver" | "refund";
  escrowId: string;
  paymentContextHash: string;
  createdAt: number;
  evidenceMode: EvidenceMode;
  reason?: string;
}

export interface ServiceEscrowResult {
  decision: "allow" | "block";
  account: ServiceEscrowAccount;
  event?: ServiceEscrowEvent;
  reason?: string;
}

export function createServiceEscrow(input: {
  paymentContextHash: string;
  payer: string;
  provider: string;
  amount: string;
  evidenceMode?: EvidenceMode;
}): ServiceEscrowAccount {
  return {
    escrowId: `escrow_${hashObject({
      paymentContextHash: input.paymentContextHash,
      payer: input.payer,
      provider: input.provider,
      amount: input.amount
    }).slice(2, 18)}`,
    paymentContextHash: input.paymentContextHash,
    payer: input.payer,
    provider: input.provider,
    amount: input.amount,
    state: "open",
    evidenceMode: input.evidenceMode ?? "fallback",
    events: []
  };
}

export function fundServiceEscrow(
  account: ServiceEscrowAccount,
  input: { now?: number; evidenceMode?: EvidenceMode } = {}
): ServiceEscrowResult {
  if (account.state !== "open") {
    return {
      decision: "block",
      account,
      reason: `ServiceEscrow cannot fund from ${account.state}`
    };
  }

  const event = eventFor(account, "fund", input.now, input.evidenceMode);
  return {
    decision: "allow",
    event,
    account: {
      ...account,
      state: "funded",
      fundedAt: event.createdAt,
      evidenceMode: event.evidenceMode,
      events: [...account.events, event]
    }
  };
}

export function markServiceEscrowDelivered(
  account: ServiceEscrowAccount,
  input: { now?: number; evidenceMode?: EvidenceMode } = {}
): ServiceEscrowResult {
  if (account.state !== "funded") {
    return {
      decision: "block",
      account,
      reason: `ServiceEscrow cannot deliver from ${account.state}`
    };
  }

  const event = eventFor(account, "deliver", input.now, input.evidenceMode);
  return {
    decision: "allow",
    event,
    account: {
      ...account,
      state: "delivered",
      deliveredAt: event.createdAt,
      evidenceMode: event.evidenceMode,
      events: [...account.events, event]
    }
  };
}

export function refundServiceEscrow(
  account: ServiceEscrowAccount,
  input: { reason: string; now?: number; evidenceMode?: EvidenceMode }
): ServiceEscrowResult {
  if (account.state !== "funded") {
    return {
      decision: "block",
      account,
      reason: `ServiceEscrow cannot refund from ${account.state}`
    };
  }

  const event = eventFor(account, "refund", input.now, input.evidenceMode, input.reason);
  return {
    decision: "allow",
    event,
    account: {
      ...account,
      state: "refunded",
      refundedAt: event.createdAt,
      refundReason: input.reason,
      evidenceMode: event.evidenceMode,
      events: [...account.events, event]
    }
  };
}

function eventFor(
  account: ServiceEscrowAccount,
  type: ServiceEscrowEvent["type"],
  now = Date.now(),
  evidenceMode = account.evidenceMode,
  reason?: string
): ServiceEscrowEvent {
  return {
    type,
    escrowId: account.escrowId,
    paymentContextHash: account.paymentContextHash,
    createdAt: now,
    evidenceMode,
    ...(reason !== undefined ? { reason } : {})
  };
}
