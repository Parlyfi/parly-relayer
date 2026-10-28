export const RECEIVING_V4_ARTIFACTS = {
  enrollment: { nPublic: 9, wasm: "6b2b16379a1d6f934e90b372a45c6b120892689f873277cb8995c90ce94e9b79", zkey: "75e20b0c6d52b4565764da8de7c30448564432c7e29697e7fccaea1462be7643" },
  "shield-admission": { nPublic: 14, wasm: "03d81137c3fdf30243798eb7a7824986393bdb8452f9a168fc5b46f7b2181278", zkey: "f8dbf2463c3efa199ed5a90fe6bd487aebbdf1104b225def525030d995c30eea" },
  "publication-admission": { nPublic: 14, wasm: "7d67869ecc403631a2a2109adbe82660b760832b63d32ec97557b23e68f34a8d", zkey: "c4905006f19bb20169c898df3bc5e25cb84c7af4f43859d29544a7edd96874ea" },
  membership: { nPublic: 10, wasm: "6c5021c57549fbb923efa65cdd2038090e06c6bbad0d697fa4f97f3ab443bdd8", zkey: "39fab85a42f1b336f09e80cbda3be9beb4cfd689af5469da64e544e4814577ef" },
  spend: { nPublic: 60, wasm: "bd2d2b0f94bf37278f384091d151b90db4bae919fe1cd87373910df14bacd41c", zkey: "83f815a9ef54f76355ed37ef2e98a03ead7e7ba932c73a15ed1b462624e05697" }
} as const
export function receivingArtifactNameV4(role: keyof typeof RECEIVING_V4_ARTIFACTS, kind: "wasm" | "zkey") {
  return `receiving_v4_${role}_${RECEIVING_V4_ARTIFACTS[role][kind]}.${kind}`
}
