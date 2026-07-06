# Clear402 for BOT Chain

Clear402 for BOT Chain is an AI-agent payment guard for x402-style paid API
requests. It binds each agent payment to a verifiable `PaymentContext`, runs
security checks before settlement, and records BOT Chain testnet escrow evidence
after settlement.

## Challenge Positioning

This repository is a standalone BOT Chain Builder Challenge version of
Clear402. It is separate from earlier wallet-integration submissions. The goal
is to show BOT Chain as the fast, low-cost EVM settlement layer for AI-agent
payments, with Clear402 providing the safety and evidence layer around those
payments.

Recommended track: **AI Agent**.

## What It Demonstrates

- x402-style HTTP 402 challenge normalization.
- AI-agent payment context binding.
- Provider trust and resource binding checks.
- Metadata firewall and redacted evidence export.
- Quote, nonce, and budget locking.
- Semantic transaction checks for unsafe payment intent.
- Service receipt and dual-receipt verification.
- Attack Lab scenarios that run mock attack inputs through the real guard
  pipeline.
- BOT Chain testnet `ServiceEscrow` deployment and interaction evidence.

## BOT Chain Integration

| Field | Value |
|---|---|
| Network | BOT Chain testnet |
| Chain ID | `968` |
| RPC | `https://rpc.bohr.life` |
| Explorer | `https://scan.bohr.life` |
| Settlement contract | `contracts/ServiceEscrow.sol` |
| Deployment status | `live testnet deploy recorded` |
| Contract address | `0x67c8fbf5adc3ba683a7b3667e6a1a5e4374ba3b8` |
| Deploy tx | `0xcbf383441001307dd9bf843281038899715d8f2788ccfb3e725ddc8559dcb8aa` |
| Fund tx | `0xf5e4ae4447ed8dd4a97ec8f8526a46e5ba862e0db06539e2112ffa1eb3b4daf1` |
| Deliver tx | `0x746f4dea40d4a6f249e5e834fd13db0ba7e89c2891c95c74d202af53ff4892e0` |
| PaymentContext hash | `0x252740b13a1c550438476ba3951577a8f80f8ad7f108fea9c6b6cc5a3535da51` |

The safe claim before deployment is:

> Clear402 for BOT Chain includes a BOT Chain-ready EVM escrow path and scripts
> for deployment and interaction.

The safe claim after deployment is:

> Clear402 for BOT Chain records a live BOT Chain testnet `ServiceEscrow`
> deployment and tiny escrow interaction bound to a Clear402
> `paymentContextHash`.

## Architecture

| Area | Path | Purpose |
|---|---|---|
| Dashboard | `apps/dashboard` | Next.js operator console for missions, guard status, attack lab, and evidence export. |
| Runtime | `services/runtime` | Guard pipeline, SQLite schema, evidence export, attack-lab execution, and receipt verification. |
| Provider | `services/provider-x402` | Local deterministic x402-style provider, challenge, payment proof, receipt, and fixture helpers. |
| Shared contracts | `packages/shared` | Shared schemas and domain types. |
| BOT Chain contract | `contracts/ServiceEscrow.sol` | Minimal EVM escrow bound by `paymentContextHash`. |
| BOT Chain scripts | `contracts/scripts` | Compile, deploy, interact, and record evidence JSON. |
| Submission package | `submission/botchain` | BOT Chain challenge checklist, demo script, and X post draft. |

## Setup

Requirements:

- Node.js `>=22.5.0`
- pnpm `>=10.33.2`

```bash
pnpm install
pnpm db:init
```

## Run The Local Demo

Start the three local services:

```bash
pnpm --filter @clear402/runtime dev
pnpm --filter @clear402/provider-x402 dev
pnpm --filter dashboard dev
```

Default endpoints:

- Dashboard: `http://127.0.0.1:3000`
- Runtime health: `http://127.0.0.1:4000/health`
- Provider health: `http://127.0.0.1:4010/health`

## BOT Chain Deployment Flow

Compile:

```bash
pnpm contracts:compile
```

Deploy to BOT Chain testnet:

```bash
export BOTCHAIN_RPC_URL="https://rpc.bohr.life"
export BOTCHAIN_CHAIN_ID="968"
export BOTCHAIN_EXPLORER_BASE_URL="https://scan.bohr.life"
export BOTCHAIN_DEPLOYER_PRIVATE_KEY="0x..."
pnpm botchain:deploy:escrow
```

Run a tiny escrow interaction:

```bash
export BOTCHAIN_SERVICE_ESCROW_ADDRESS="0x..."
export BOTCHAIN_PAYMENT_CONTEXT_HASH="0x..."
export BOTCHAIN_PROVIDER_ADDRESS="0x..."
export BOTCHAIN_ESCROW_AMOUNT_BOT="0.000001"
pnpm botchain:escrow fund
pnpm botchain:escrow deliver
```

Evidence JSON is written to `evidence/botchain/`. The current recorded BOT
Chain testnet evidence includes:

- deploy: `https://scan.bohr.life/tx/0xcbf383441001307dd9bf843281038899715d8f2788ccfb3e725ddc8559dcb8aa`
- fund: `https://scan.bohr.life/tx/0xf5e4ae4447ed8dd4a97ec8f8526a46e5ba862e0db06539e2112ffa1eb3b4daf1`
- deliver: `https://scan.bohr.life/tx/0x746f4dea40d4a6f249e5e834fd13db0ba7e89c2891c95c74d202af53ff4892e0`

The x402-style challenge and `PaymentContext` store amount values as base-unit
digit strings. In the demo, `1000000000000` represents `0.000001 BOT` with 18
decimals.

## Test Gates

```bash
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
pnpm run attack:all
```

## Challenge Submission

BOT Chain project submissions need:

- X post that tags `@BOTChain_ai`.
- Submission form with project name, track, repo, demo, tech summary, BOT Chain
  usage, contract address or tx hash, and wallet address.
- Real BOT Chain deployment or interaction evidence.

See:

- `docs/botchain_integration.md`
- `docs/botchain_limitations.md`
- `submission/botchain/README.md`
- `submission/botchain/final-submit-checklist.md`
- `submission/botchain/x-post.md`

## Claim Boundaries

This is a testnet challenge demo. Do not claim mainnet readiness, production
custody, ERC-20 escrow custody, unrestricted agent spending, or complete x402
settlement standardization. The BOT Chain claim is limited to the recorded
testnet deployment, fund, and deliver evidence.
