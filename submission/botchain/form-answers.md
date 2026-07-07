# BOT Chain Submission Form Answers

Use this as the copy-ready source for the BOT Chain Builder Challenge form.

## Basic

Project name:

```text
Clear402 for BOT Chain
```

Track:

```text
AI Agent
```

Submission type:

```text
Project Submission
```

GitHub repository:

```text
https://github.com/pillowtalk-Qy/clear402-botchain
```

Demo video:

```text
https://github.com/pillowtalk-Qy/clear402-botchain/releases/download/demo-video-v1/clear402-botchain-demo-voiceover.mp4
```

X post:

```text
TODO_AFTER_X_POST
```

## Short Intro

```text
Clear402 for BOT Chain is an AI-agent payment guard for x402-style paid APIs. It normalizes a 402 payment challenge, binds the paid resource/provider/amount/nonce into a PaymentContext, runs guard checks before settlement, and records live BOT Chain testnet ServiceEscrow evidence.
```

## BOT Chain Usage

```text
BOT Chain is used as the EVM settlement layer. We deployed a ServiceEscrow contract on BOT Chain testnet, funded a tiny escrow amount, delivered it, and bound the onchain evidence to a Clear402 PaymentContext hash. The dashboard reads the recorded BOT Chain evidence and shows the contract, deploy transaction, fund/deliver transaction, explorer links, and settlement state.
```

Integration type:

```text
Smart Contract Deployment, DApp Integration
```

## Contract And Transactions

Contract:

```text
0x67c8fbf5adc3ba683a7b3667e6a1a5e4374ba3b8
```

Deploy tx:

```text
0xcbf383441001307dd9bf843281038899715d8f2788ccfb3e725ddc8559dcb8aa
```

Fund tx:

```text
0xf5e4ae4447ed8dd4a97ec8f8526a46e5ba862e0db06539e2112ffa1eb3b4daf1
```

Deliver tx:

```text
0x746f4dea40d4a6f249e5e834fd13db0ba7e89c2891c95c74d202af53ff4892e0
```

Explorer links:

```text
https://scan.bohr.life/address/0x67c8fbf5adc3ba683a7b3667e6a1a5e4374ba3b8
https://scan.bohr.life/tx/0xcbf383441001307dd9bf843281038899715d8f2788ccfb3e725ddc8559dcb8aa
https://scan.bohr.life/tx/0xf5e4ae4447ed8dd4a97ec8f8526a46e5ba862e0db06539e2112ffa1eb3b4daf1
https://scan.bohr.life/tx/0x746f4dea40d4a6f249e5e834fd13db0ba7e89c2891c95c74d202af53ff4892e0
```

PaymentContext hash:

```text
0x252740b13a1c550438476ba3951577a8f80f8ad7f108fea9c6b6cc5a3535da51
```

## Technical Implementation

```text
The project uses Next.js, React, TypeScript, Node.js, SQLite via node:sqlite, Solidity, viem, Vitest, and Playwright. The runtime implements x402-style challenge normalization, provider/resource binding, ERC-8004-style trust checks, metadata firewall, quote/nonce/budget locks, semantic transaction inspection, ServiceEscrow calldata binding, receipt verification, evidence export, and a 16-scenario Attack Lab. The BOT Chain contract is a minimal native-value ServiceEscrow keyed by paymentContextHash.
```

## Product Completeness

```text
Completed: local dashboard, runtime API, local x402-style provider, Attack Lab, evidence export, BOT Chain testnet ServiceEscrow deploy/fund/deliver/read evidence, tests, E2E, and submission docs. Current boundary: this is testnet evidence and a demo escrow, not production custody, not mainnet, and not a universal x402 settlement network.
```

## Future Plan

```text
Next steps are to deploy a hosted public demo, add a production-grade settlement adapter, support token escrow, integrate live provider identity registration, improve receipt attestations, and turn the Attack Lab into a reusable security regression suite for AI-agent payment flows on BOT Chain.
```

## BOT Chain Feedback

```text
The quick-start path is straightforward for EVM developers. The most useful improvements for agent-payment builders would be a canonical testnet contract verification guide, more faucet reliability/status visibility, and example templates for common AI-agent payment patterns such as escrow, metered API calls, and signed receipts.
```
