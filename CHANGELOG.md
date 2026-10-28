# Changelog

## Unreleased

- Includes the current V4 receiving/private-send and V7 payout runtime in the standalone export.
- Adds OpenUSD (OUSD) alongside USDC.e and USDT0.
- Packages the shared validation helpers required to build outside the monorepo.
- Clarifies self-service relayer registration through `https://parly.fi/relayer`.
- Clarifies ingress and payout duties for operators.
- Updates the registry API example to `https://parly.fi`.

## 16.9.9-operator.0

- publishes the operator relayer runtime
- includes registry heartbeat support
- includes encrypted Waku message handling and pending reconciliation
- includes relayer-owned one-time execution helpers behind explicit broadcast gates
- includes Payout V3 dry-run readiness checks without enabling payout execution
