import { createPublicClient, http } from 'viem'
import { baseSepolia as testnet } from 'viem/chains'

// PactumAgent contract address (ERC-8004)
export const PACTUM_AGENT_CONTRACT = (process.env.NEXT_PUBLIC_PACTUM_AGENT_CONTRACT || '0x13eCc706f216Be424baa81FB392A0cE158c8E0E8') as `0x${string}`

// Public client for read-only contract calls
export const publicClient = createPublicClient({
  chain: testnet,
  transport: http()
})

// PactumAgent ABI (read functions only)
export const PACTUM_AGENT_ABI = [
  {
    "inputs": [{"name": "wallet", "type": "address"}],
    "name": "isRegistered",
    "outputs": [{"name": "", "type": "bool"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"name": "tokenId", "type": "uint256"}],
    "name": "getAgentStats",
    "outputs": [
      {"name": "avgRating", "type": "uint256"},
      {"name": "reviewCount", "type": "uint256"}
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"name": "", "type": "address"}],
    "name": "walletToToken",
    "outputs": [{"name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  }
] as const

// Check if a wallet is registered on-chain
export async function isRegisteredOnChain(wallet: string): Promise<boolean> {
  try {
    return await publicClient.readContract({
      address: PACTUM_AGENT_CONTRACT,
      abi: PACTUM_AGENT_ABI,
      functionName: 'isRegistered',
      args: [wallet as `0x${string}`]
    })
  } catch {
    return false
  }
}

// Get agent stats from on-chain
export async function getAgentStats(wallet: string) {
  try {
    const tokenId = await publicClient.readContract({
      address: PACTUM_AGENT_CONTRACT,
      abi: PACTUM_AGENT_ABI,
      functionName: 'walletToToken',
      args: [wallet as `0x${string}`]
    })

    const stats = await publicClient.readContract({
      address: PACTUM_AGENT_CONTRACT,
      abi: PACTUM_AGENT_ABI,
      functionName: 'getAgentStats',
      args: [tokenId]
    })

    return {
      avgRating: Number(stats[0]) / 100,
      reviewCount: Number(stats[1]),
    }
  } catch {
    return { avgRating: 0, reviewCount: 0 }
  }
}
