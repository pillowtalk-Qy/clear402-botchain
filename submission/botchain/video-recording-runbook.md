# Demo Video Recording Runbook

Target length: 3 to 5 minutes.

## Before Recording

Run the app:

```bash
cd /Users/qy/Documents/clear402-botchain
pnpm --filter @clear402/runtime dev
pnpm --filter @clear402/provider-x402 dev
pnpm --filter dashboard dev
```

Open:

```text
http://127.0.0.1:3000
```

Also prepare these tabs:

```text
https://github.com/pillowtalk-Qy/clear402-botchain
https://scan.bohr.life/address/0x67c8fbf5adc3ba683a7b3667e6a1a5e4374ba3b8
https://scan.bohr.life/tx/0x746f4dea40d4a6f249e5e834fd13db0ba7e89c2891c95c74d202af53ff4892e0
```

## Recording Flow

### 1. Intro

Say:

```text
This is Clear402 for BOT Chain. It is an AI-agent payment guard for x402-style paid APIs. BOT Chain is the EVM settlement layer; Clear402 is the guard and evidence layer around the payment.
```

Show the dashboard title and live runtime/provider chips.

### 2. BOT Chain Settlement Evidence

Point to the BOT Chain Settlement panel.

Say:

```text
This panel is loaded from recorded BOT Chain testnet evidence. The ServiceEscrow contract is live, the settlement state is confirmed, and the explorer links show deploy and deliver transactions.
```

Open the deliver tx explorer link.

### 3. PaymentContext Binding

Click `Create mission`, `Dry run 402`, and `Prepare guard`.

Say:

```text
The key object is PaymentContext. It binds the paid resource, provider, chain, amount, nonce, and policy into a hash. The escrow evidence is not a random tx; it is bound to this payment context.
```

### 4. Guard Pipeline

Point to:

- x402 Challenge Inspector
- Provider Registry + ERC-8004 Trust Panel
- Metadata Firewall Diff
- Clear Signing Panel

Say:

```text
Before any settlement claim, the guard checks provider identity, resource binding, metadata leakage, amount and nonce, and transaction intent.
```

### 5. Execute And Boundary

Click `Record BOT evidence` or `Verify receipt`.

Say:

```text
The dashboard shows recorded BOT Chain evidence as live. The runtime verify path remains conservative: if production payment execution is not available, it stays fallback instead of pretending the whole gateway is production-ready.
```

### 6. Attack Lab

Click `Attack`, choose `Replay same nonce`, and run it.

Say:

```text
The attack input is modeled, but the defense path is real local runtime code. Every scenario must return blocked and a guard event id, or the script fails.
```

Optionally show terminal:

```bash
pnpm run attack:all
```

### 7. Close

Say:

```text
So the completed demo is: x402-style challenge, Clear402 guard pipeline, BOT Chain testnet ServiceEscrow settlement evidence, and attack-lab regression checks. The current claim is testnet evidence, not mainnet or production custody.
```

## After Recording

Upload the video, then update:

- `submission/botchain/form-answers.md`
- `submission/botchain/README.md`
- `submission/botchain/x-post.md`

with the final demo video URL.

