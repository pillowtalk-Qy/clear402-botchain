import type { DatabaseSync } from "node:sqlite";

import type { PaymentContext, QuoteReservation } from "../../../../packages/shared/src/index.mjs";
import { compareDecimalStrings } from "./amount.ts";
import { canonicalJson } from "./hash.ts";
import { recordMissionTimelineEvent } from "../mission_timeline.ts";

export interface EnsureMissionInput {
  missionId: string;
  userPrompt?: string;
  budgetUsd: string;
  cawWalletUuid?: string;
  cawWalletAddress?: string;
  pactId?: string;
  createdAt?: number;
}

export interface EnsureProviderInput {
  providerId: string;
  origin: string;
  merchantAddress: string;
  facilitatorUrl?: string;
  chainId: string;
  tokenId: string;
  publicKey: string;
  allowedResources: string[];
  cawAllowlistStatus: "allowed" | "pending" | "blocked";
  erc8004AgentId?: string;
  erc8004AgentUri?: string;
  reputationThreshold?: number;
  validationTags?: string[];
  createdAt?: number;
}

export interface ReserveQuoteInput {
  missionId: string;
  provider: EnsureProviderInput;
  paymentContextHash: string;
  cawRequestId: string;
  context: PaymentContext;
  rawChallengeHash: string;
  reservedBudget: string;
  budgetLimitUsd: string;
  now?: number;
}

export interface ReserveQuoteResult {
  decision: "allow" | "block";
  reason?: string;
  reservation?: QuoteReservation;
  spentOrReservedUsd: string;
}

function withImmediateTransaction<T>(database: DatabaseSync, callback: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function dbErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toSqlJson(value: unknown): string {
  return canonicalJson(value);
}

export function ensureMission(database: DatabaseSync, input: EnsureMissionInput) {
  const now = input.createdAt ?? Date.now();
  const existingMission = database
    .prepare(`select id from missions where id = ?`)
    .get(input.missionId) as { id: string } | undefined;

  database
    .prepare(
      `insert into missions (
        id,
        user_prompt,
        budget_usd,
        status,
        caw_wallet_uuid,
        caw_wallet_address,
        pact_id,
        created_at,
        updated_at
      ) values (?, ?, ?, 'active', ?, ?, ?, ?, ?)
      on conflict(id) do update set
        budget_usd = excluded.budget_usd,
        caw_wallet_address = coalesce(excluded.caw_wallet_address, missions.caw_wallet_address),
        pact_id = coalesce(excluded.pact_id, missions.pact_id),
        updated_at = excluded.updated_at`
    )
    .run(
      input.missionId,
      input.userPrompt ?? "Clear402 guarded payment",
      input.budgetUsd,
      input.cawWalletUuid ?? "demo-wallet",
      input.cawWalletAddress ?? null,
      input.pactId ?? null,
      now,
      now
    );

  if (!existingMission) {
    recordMissionTimelineEvent(database, {
      id: `mission_${input.missionId}`,
      missionId: input.missionId,
      type: "mission",
      createdAt: now,
      payload: {
        title: "Mission created",
        detail: "Runtime mission record is available for timeline streaming.",
        status: "active",
        evidenceMode: "fallback",
        userPrompt: input.userPrompt ?? "Clear402 guarded payment",
        budgetUsd: input.budgetUsd,
        cawWalletAddress: input.cawWalletAddress ?? null,
        pactId: input.pactId ?? null,
        createdAt: now,
        updatedAt: now
      }
    });
  }
}

export function ensureProvider(database: DatabaseSync, input: EnsureProviderInput) {
  const now = input.createdAt ?? Date.now();
  database
    .prepare(
      `insert into provider_registry (
        provider_id,
        origin,
        merchant_address,
        facilitator_url,
        chain_id,
        token_id,
        public_key,
        allowed_resources,
        caw_allowlist_status,
        erc8004_agent_id,
        erc8004_agent_uri,
        reputation_threshold,
        validation_tags,
        created_at,
        updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(provider_id) do update set
        origin = excluded.origin,
        merchant_address = excluded.merchant_address,
        facilitator_url = excluded.facilitator_url,
        chain_id = excluded.chain_id,
        token_id = excluded.token_id,
        public_key = excluded.public_key,
        allowed_resources = excluded.allowed_resources,
        caw_allowlist_status = excluded.caw_allowlist_status,
        erc8004_agent_id = excluded.erc8004_agent_id,
        erc8004_agent_uri = excluded.erc8004_agent_uri,
        reputation_threshold = excluded.reputation_threshold,
        validation_tags = excluded.validation_tags,
        updated_at = excluded.updated_at`
    )
    .run(
      input.providerId,
      input.origin,
      input.merchantAddress,
      input.facilitatorUrl ?? null,
      input.chainId,
      input.tokenId,
      input.publicKey,
      toSqlJson(input.allowedResources),
      input.cawAllowlistStatus,
      input.erc8004AgentId ?? null,
      input.erc8004AgentUri ?? null,
      input.reputationThreshold?.toString() ?? null,
      toSqlJson(input.validationTags ?? []),
      now,
      now
    );
}

export function getLedgerExposureUsd(database: DatabaseSync, missionId: string): string {
  const rows = database
    .prepare(
      `select amount_usd as amountUsd
      from budget_ledger
      where mission_id = ?
        and entry_type in ('reserve', 'spend')
        and status in ('pending', 'posted')`
    )
    .all(missionId) as Array<{ amountUsd: string }>;

  return rows.reduce((sum, row) => {
    const [sumWhole = "0", sumFraction = ""] = sum.split(".");
    const [rowWhole = "0", rowFraction = ""] = row.amountUsd.split(".");
    const decimals = Math.max(sumFraction.length, rowFraction.length, 18);
    const scale = 10n ** BigInt(decimals);
    const sumMinor =
      BigInt(sumWhole) * scale + BigInt(sumFraction.padEnd(decimals, "0") || "0");
    const rowMinor =
      BigInt(rowWhole) * scale + BigInt(rowFraction.padEnd(decimals, "0") || "0");
    const total = sumMinor + rowMinor;
    const whole = total / scale;
    const fraction = (total % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
    return fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
  }, "0");
}

export function reserveQuoteAndBudget(
  database: DatabaseSync,
  input: ReserveQuoteInput
): ReserveQuoteResult {
  const now = input.now ?? Date.now();

  return withImmediateTransaction(database, () => {
    ensureMission(database, {
      missionId: input.missionId,
      budgetUsd: input.budgetLimitUsd,
      pactId: input.context.cawPactId,
      createdAt: now
    });
    ensureProvider(database, input.provider);

    const exposure = getLedgerExposureUsd(database, input.missionId);
    const projected = addForLedger(exposure, input.reservedBudget);
    if (compareDecimalStrings(projected, input.budgetLimitUsd) > 0) {
      return {
        decision: "block",
        reason: "Budget limit would be exceeded",
        spentOrReservedUsd: exposure
      };
    }

    try {
      database
        .prepare(
          `insert into x402_quotes (
            quote_id,
            mission_id,
            provider_id,
            resource_url,
            amount_usd,
            status,
            raw_challenge_hash,
            created_at,
            expires_at
          ) values (?, ?, ?, ?, ?, 'reserved', ?, ?, ?)`
        )
        .run(
          input.context.quoteId,
          input.missionId,
          input.context.providerId,
          `${input.context.origin}${input.context.resourcePath}`,
          input.context.amount,
          input.rawChallengeHash,
          now,
          input.context.expiresAt
        );

      database
        .prepare(
          `insert into payment_contexts (
            payment_context_hash,
            mission_id,
            provider_id,
            quote_id,
            method,
            origin,
            resource_path,
            canonical_url_hash,
            body_hash,
            sanitized_resource_hash,
            merchant_address,
            facilitator_url_hash,
            chain_id,
            token_id,
            amount,
            amount_decimals,
            nonce,
            issued_at,
            expires_at,
            quote_terms_hash,
            pii_policy_hash,
            clear_sign_digest,
            caw_pact_id,
            service_mode,
            raw_context_json
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.paymentContextHash,
          input.context.missionId,
          input.context.providerId,
          input.context.quoteId,
          input.context.method,
          input.context.origin,
          input.context.resourcePath,
          input.context.canonicalUrlHash,
          input.context.bodyHash,
          input.context.sanitizedResourceHash,
          input.context.merchantAddress,
          input.context.facilitatorUrlHash ?? null,
          input.context.chainId,
          input.context.tokenId,
          input.context.amount,
          input.context.amountDecimals,
          input.context.nonce,
          input.context.issuedAt,
          input.context.expiresAt,
          input.context.quoteTermsHash,
          input.context.piiPolicyHash,
          input.context.clearSignDigest ?? null,
          input.context.cawPactId,
          input.context.serviceMode,
          toSqlJson(input.context)
        );

      database
        .prepare(
          `insert into quote_reservations (
            quote_id,
            payment_context_hash,
            nonce,
            status,
            reserved_budget,
            reserved_at,
            expires_at
          ) values (?, ?, ?, 'reserved', ?, ?, ?)`
        )
        .run(
          input.context.quoteId,
          input.paymentContextHash,
          input.context.nonce,
          input.reservedBudget,
          now,
          input.context.expiresAt
        );

      database
        .prepare(
          `insert into budget_ledger (
            id,
            mission_id,
            entry_type,
            amount_usd,
            balance_after_usd,
            status,
            created_at
          ) values (?, ?, 'reserve', ?, ?, 'pending', ?)`
        )
        .run(
          `ledger_${input.paymentContextHash.slice(2, 18)}`,
          input.missionId,
          input.reservedBudget,
          projected,
          now
        );
    } catch (error) {
      const message = dbErrorMessage(error);
      return {
        decision: "block",
        reason: message.includes("UNIQUE")
          ? "Quote, nonce, or PaymentContext has already been reserved"
          : message,
        spentOrReservedUsd: exposure
      };
    }

    return {
      decision: "allow",
      reservation: {
        quoteId: input.context.quoteId,
        paymentContextHash: input.paymentContextHash,
        nonce: input.context.nonce,
        status: "reserved",
        reservedBudget: input.reservedBudget,
        reservedAt: now,
        expiresAt: input.context.expiresAt
      },
      spentOrReservedUsd: projected
    };
  });
}

function addForLedger(left: string, right: string): string {
  const decimals = Math.max(
    left.split(".")[1]?.length ?? 0,
    right.split(".")[1]?.length ?? 0,
    18
  );
  const scale = 10n ** BigInt(decimals);
  const [leftWhole = "0", leftFraction = ""] = left.split(".");
  const [rightWhole = "0", rightFraction = ""] = right.split(".");
  const total =
    BigInt(leftWhole) * scale +
    BigInt(leftFraction.padEnd(decimals, "0") || "0") +
    BigInt(rightWhole) * scale +
    BigInt(rightFraction.padEnd(decimals, "0") || "0");
  const whole = total / scale;
  const fraction = (total % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
}

export function markReservationSpent(database: DatabaseSync, paymentContextHash: string) {
  database
    .prepare(`update quote_reservations set status = 'spent' where payment_context_hash = ?`)
    .run(paymentContextHash);
  database
    .prepare(`update x402_quotes set status = 'spent' where quote_id = (
      select quote_id from quote_reservations where payment_context_hash = ?
    )`)
    .run(paymentContextHash);
  database
    .prepare(
      `update budget_ledger set entry_type = 'spend', status = 'posted'
      where id = ? and entry_type = 'reserve'`
    )
    .run(`ledger_${paymentContextHash.slice(2, 18)}`);
}

export function releaseReservationBudget(database: DatabaseSync, paymentContextHash: string) {
  database
    .prepare(`update quote_reservations set status = 'released' where payment_context_hash = ?`)
    .run(paymentContextHash);
  database
    .prepare(`update budget_ledger set status = 'void' where id = ? and entry_type = 'reserve'`)
    .run(`ledger_${paymentContextHash.slice(2, 18)}`);
}

export function markReservationDisputed(database: DatabaseSync, paymentContextHash: string) {
  database
    .prepare(`update quote_reservations set status = 'disputed' where payment_context_hash = ?`)
    .run(paymentContextHash);
}
