# BOT Chain Builder Challenge Submission

## Project

**Name:** Clear402 for BOT Chain

**Track:** AI Agent

**One-liner:** Clear402 for BOT Chain is an AI-agent payment guard that binds
x402-style paid API requests to BOT Chain testnet escrow evidence.

## What We Built

Clear402 wraps agent payment attempts with guard checks before settlement:

- x402-style challenge normalization;
- provider and resource binding;
- metadata firewall;
- `PaymentContext` hashing;
- quote, nonce, and budget locks;
- semantic transaction checks;
- service receipt verification;
- attack-lab blocked evidence;
- BOT Chain `ServiceEscrow` deployment and interaction evidence.

## BOT Chain Usage

BOT Chain is used as the EVM settlement layer for the demo escrow contract.
The challenge submission must include:

- contract address: `0x67c8fbf5adc3ba683a7b3667e6a1a5e4374ba3b8`;
- deployment tx: `0xcbf383441001307dd9bf843281038899715d8f2788ccfb3e725ddc8559dcb8aa`;
- escrow fund tx: `0xf5e4ae4447ed8dd4a97ec8f8526a46e5ba862e0db06539e2112ffa1eb3b4daf1`;
- escrow deliver tx: `0x746f4dea40d4a6f249e5e834fd13db0ba7e89c2891c95c74d202af53ff4892e0`;
- payment context hash: `0x252740b13a1c550438476ba3951577a8f80f8ad7f108fea9c6b6cc5a3535da51`;
- explorer links: deploy `https://scan.bohr.life/tx/0xcbf383441001307dd9bf843281038899715d8f2788ccfb3e725ddc8559dcb8aa`, fund `https://scan.bohr.life/tx/0xf5e4ae4447ed8dd4a97ec8f8526a46e5ba862e0db06539e2112ffa1eb3b4daf1`, deliver `https://scan.bohr.life/tx/0x746f4dea40d4a6f249e5e834fd13db0ba7e89c2891c95c74d202af53ff4892e0`.

## Demo Links

| Item | Link |
|---|---|
| GitHub repo | `TODO_REPO_URL` |
| Demo video | `TODO_DEMO_VIDEO_URL` |
| Live demo | `TODO_LIVE_DEMO_URL_OR_NA` |
| X post | `TODO_X_POST_URL` |
| Explorer contract | `https://scan.bohr.life/address/0x67c8fbf5adc3ba683a7b3667e6a1a5e4374ba3b8` |
| Explorer tx | `https://scan.bohr.life/tx/0x746f4dea40d4a6f249e5e834fd13db0ba7e89c2891c95c74d202af53ff4892e0` |

## Technical Stack

- Next.js, React, TypeScript dashboard.
- Node.js and TypeScript runtime.
- SQLite via Node `node:sqlite`.
- Solidity `ServiceEscrow`.
- BOT Chain testnet.
- viem deployment and interaction scripts.
- Vitest and Playwright.

## Safe Claim

> Clear402 for BOT Chain demonstrates how an AI agent payment can be checked by
> a local x402 guard pipeline and then bound to BOT Chain testnet escrow
> evidence.

## Do Not Claim

- mainnet readiness;
- production custody;
- ERC-20 escrow custody;
- unrestricted agent spending;
- universal x402 settlement;
- live BOT Chain evidence before the tx hashes are recorded.
