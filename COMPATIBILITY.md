# Compatibility

The current relayer export includes V4 receiving and private-send execution,
V7 cross-chain payouts, and OpenUSD (OUSD).

- Relayer release `16.9.9-operator.0` is compatible with Parly core `16.9.9`
- Registry API compatibility: `relayer-registry/v1`
- Waku payload shape compatibility: Parly `16.9.9` encrypted bundle schema
- settlement domain: Tempo `4217`
- Tempo assets: USDC.e (`1`), USDT0 (`2`) and OpenUSD (`3`)
- V4 and V7 routes use the configured deployment, code and proof pins
- Cross-chain assets and destinations follow active provider-route admission
- Enable receiving, payout and reconciliation duties for the routes you operate
