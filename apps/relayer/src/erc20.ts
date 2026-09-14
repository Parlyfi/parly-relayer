import type { Abi, PublicClient, WalletClient } from "viem"
import { parseAbi } from "viem"

const ERC20_ABI = parseAbi([
  "function approve(address,uint256) external returns (bool)",
  "function allowance(address,address) external view returns (uint256)"
])

export async function safeApproveExactRelayer(args: {
  token: `0x${string}`
  spender: `0x${string}`
  amount: bigint
  owner: `0x${string}`
  publicClient: PublicClient
  walletClient: WalletClient
}) {
  const currentAllowance = (await args.publicClient.readContract({
    address: args.token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [args.owner, args.spender]
  })) as bigint

  if (currentAllowance === args.amount) return

  if (currentAllowance !== 0n && args.amount !== 0n) {
    const hash0 = await args.walletClient.writeContract({
      address: args.token,
      abi: ERC20_ABI as Abi,
      functionName: "approve",
      args: [args.spender, 0n]
    } as any)
    await args.publicClient.waitForTransactionReceipt({ hash: hash0 })
  }

  const hash1 = await args.walletClient.writeContract({
    address: args.token,
    abi: ERC20_ABI as Abi,
    functionName: "approve",
    args: [args.spender, args.amount]
  } as any)
  await args.publicClient.waitForTransactionReceipt({ hash: hash1 })
}
