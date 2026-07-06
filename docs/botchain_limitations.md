# BOT Chain Limitations

This document controls the claims for the BOT Chain challenge version.

## Current Claim Before Deployment

Until deployment evidence is recorded, the safe claim is:

> The project contains a BOT Chain-ready EVM escrow contract and scripts for
> compiling, deploying, interacting, and recording evidence.

Do not claim live BOT Chain settlement until contract and transaction evidence
are filled in.

## Claim After Deployment

After deployment and interaction evidence are recorded, the safe claim becomes:

> Clear402 for BOT Chain records a live BOT Chain testnet `ServiceEscrow`
> deployment and a tiny escrow interaction bound to a Clear402
> `paymentContextHash`.

## Explicit Non-Claims

| Limitation | Status |
|---|---|
| No mainnet claim | BOT Chain evidence is testnet evidence unless a future mainnet deployment is separately recorded. |
| No production custody | `ServiceEscrow` is a minimal demo escrow, not audited custody infrastructure. |
| No ERC-20 custody | The current escrow is native-value only and uses `msg.value == amount`. |
| No unrestricted AI-agent spending | Clear402 blocks or requires evidence for unsafe flows; it is not a wallet authorization bypass. |
| No full x402 standard settlement claim | The provider is x402-style/local; the demo proves binding and evidence, not a universal settlement network. |
| No fake live evidence | Contract address and tx hashes must be recorded from BOT Chain explorer before being claimed. |
| Attack Lab inputs are modeled fixtures | The attack lab uses mock attack inputs but runs them through the real local guard pipeline. |

## Required Evidence For Submission

- BOT Chain testnet contract address.
- Deployment tx hash.
- At least one interaction tx hash.
- Explorer links.
- GitHub repository.
- Demo video or online demo.
- X post tagging `@BOTChain_ai`.
- Submission form.
