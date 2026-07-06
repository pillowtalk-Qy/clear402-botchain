# BOT Chain Demo Script

## 0. Setup

Open three terminals:

```bash
pnpm --filter @clear402/runtime dev
pnpm --filter @clear402/provider-x402 dev
pnpm --filter dashboard dev
```

Open `http://127.0.0.1:3000`.

## 1. Intro

Clear402 for BOT Chain is a safety layer for AI-agent payments. BOT Chain is the
fast EVM settlement layer; Clear402 decides whether an agent payment is safe,
binds it to a `PaymentContext`, and exports evidence.

## 2. Show x402-Style Payment Request

Create a mission in the dashboard. Show that the provider returns a
payment-required challenge. Explain:

> We do not let an AI agent blindly pay a 402 challenge. We normalize the
> challenge, bind the resource, provider, amount, chain, and nonce, then create a
> PaymentContext.

## 3. Show Guard Pipeline

Run the guard step. Point out:

- provider check;
- metadata firewall;
- quote/nonce/budget lock;
- semantic transaction check;
- receipt expectations.

## 4. Show BOT Chain Settlement

Open the BOT Chain settlement evidence:

- contract address:
  `0x67c8fbf5adc3ba683a7b3667e6a1a5e4374ba3b8`;
- `paymentContextHash`:
  `0x252740b13a1c550438476ba3951577a8f80f8ad7f108fea9c6b6cc5a3535da51`;
- deploy tx:
  `0xcbf383441001307dd9bf843281038899715d8f2788ccfb3e725ddc8559dcb8aa`;
- `fund(...)` tx:
  `0xf5e4ae4447ed8dd4a97ec8f8526a46e5ba862e0db06539e2112ffa1eb3b4daf1`;
- `deliver(...)` tx:
  `0x746f4dea40d4a6f249e5e834fd13db0ba7e89c2891c95c74d202af53ff4892e0`.

Say:

> This is the BOT Chain part. The agent payment context that passed the guard is
> the same hash recorded by the onchain escrow transaction.

The chain readback confirms:

- payer: `0xf57D44090ff1e263Df574A2Ea4741a07d61a974e`;
- provider: `0xf57D44090ff1e263Df574A2Ea4741a07d61a974e`;
- amount: `1000000000000` wei, or `0.000001 BOT`;
- state: `2`, delivered.

## 5. Show Attack Lab

Run:

```bash
pnpm run attack:all
```

Show a few blocked scenarios:

- replay proof;
- cross-resource substitution;
- metadata leakage;
- malicious approval.

Say:

> The attack input is modeled, but the defense path is real local code. Every
> scenario must return `blocked` and a guard event id, or the script fails.

## 6. Close

BOT Chain gives us the fast settlement layer. Clear402 adds the missing safety
and evidence layer for agentic paid API calls.
