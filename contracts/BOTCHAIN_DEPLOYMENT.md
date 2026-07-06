# ServiceEscrow BOT Chain Deployment

This repository is the BOT Chain challenge version of Clear402. `ServiceEscrow`
is the minimal EVM settlement contract used to prove that a guarded x402-style
agent payment can be bound to BOT Chain testnet evidence.

## Network

| Field | Value |
|---|---|
| Network | BOT Chain testnet |
| Chain ID | `968` |
| RPC | `https://rpc.bohr.life` |
| Explorer | `https://scan.bohr.life` |

## Contract

- Source: `contracts/ServiceEscrow.sol`
- ABI: `contracts/abi/ServiceEscrow.json`
- Runtime calldata helper: `services/runtime/src/escrow/service_escrow_onchain.ts`

## Current Evidence Status

| Evidence | Status |
|---|---|
| Deployment tx hash | `0xcbf383441001307dd9bf843281038899715d8f2788ccfb3e725ddc8559dcb8aa` |
| Contract address | `0x67c8fbf5adc3ba683a7b3667e6a1a5e4374ba3b8` |
| `fund(...)` tx hash | `0xf5e4ae4447ed8dd4a97ec8f8526a46e5ba862e0db06539e2112ffa1eb3b4daf1` |
| `deliver(...)` tx hash | `0x746f4dea40d4a6f249e5e834fd13db0ba7e89c2891c95c74d202af53ff4892e0` |
| PaymentContext hash | `0x252740b13a1c550438476ba3951577a8f80f8ad7f108fea9c6b6cc5a3535da51` |
| Explorer links | deploy: `https://scan.bohr.life/tx/0xcbf383441001307dd9bf843281038899715d8f2788ccfb3e725ddc8559dcb8aa`; fund: `https://scan.bohr.life/tx/0xf5e4ae4447ed8dd4a97ec8f8526a46e5ba862e0db06539e2112ffa1eb3b4daf1`; deliver: `https://scan.bohr.life/tx/0x746f4dea40d4a6f249e5e834fd13db0ba7e89c2891c95c74d202af53ff4892e0` |

Do not claim live BOT Chain settlement until the deployment and at least one
interaction transaction are recorded with explorer links.

## Local Commands

Compile the contract:

```bash
pnpm contracts:compile
```

Export deploy-only environment variables:

```bash
export BOTCHAIN_RPC_URL="https://rpc.bohr.life"
export BOTCHAIN_CHAIN_ID="968"
export BOTCHAIN_EXPLORER_BASE_URL="https://scan.bohr.life"
export BOTCHAIN_DEPLOYER_PRIVATE_KEY="0x..."
```

Deploy:

```bash
pnpm botchain:deploy:escrow
```

After deployment, export the contract address and run a tiny escrow interaction:

```bash
export BOTCHAIN_SERVICE_ESCROW_ADDRESS="0x..."
export BOTCHAIN_PAYMENT_CONTEXT_HASH="0x..."
export BOTCHAIN_PROVIDER_ADDRESS="0x..."
export BOTCHAIN_ESCROW_AMOUNT_BOT="0.000001"
pnpm botchain:escrow fund
pnpm botchain:escrow deliver
```

## Safe Claim

Once the evidence is filled in, the safe claim is:

> Clear402 for BOT Chain records a live BOT Chain testnet `ServiceEscrow`
> deployment and a tiny escrow interaction bound to a Clear402
> `paymentContextHash`.

This remains testnet evidence. It is not mainnet, not production custody, not
an ERC-20 escrow, and not a claim that every x402 payment has been settled on
BOT Chain.
