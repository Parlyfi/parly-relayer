# Compatibility

Parly supports OpenUSD (OUSD) on qualified routes. This operator release retains
its two-asset interface and does not add V4 or OpenUSD execution.

- Relayer release `16.9.9-operator.0` is compatible with Parly core `16.9.9`
- Registry API compatibility: `relayer-registry/v1`
- Waku payload shape compatibility: Parly `16.9.9` encrypted bundle schema
- settlement domain: Tempo `4217`
- asset lanes: USDC.e and USDT0
- payout execution remains disabled unless explicitly configured and approved
