// API client for Pactum Gateway

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.pactum.cc'
const WALLET_SERVICE_URL = process.env.NEXT_PUBLIC_WALLET_URL || 'http://localhost:8001'

// Types
export interface Seller {
  wallet: string
  description: string
  card_hash: string
  avg_rating: number
  total_reviews: number
  registered_at?: string
}

export interface AgentWithItems extends Seller {
  items: Pick<Item, 'item_id' | 'name' | 'description' | 'price' | 'type' | 'requires_shipping' | 'status'>[]
}

export interface Item {
  item_id: string
  seller_wallet: string
  name: string
  description: string
  price: number
  type: 'digital' | 'physical'
  endpoint?: string
  requires_shipping?: boolean
  status: string
  created_at?: string
  updated_at?: string
  agents?: Seller
}

export interface ShippingAddress {
  name: string
  street: string
  city: string
  state: string
  postal_code: string
  country: string
}

export interface Order {
  order_id: string
  item_id: string
  buyer_wallet: string
  seller_wallet: string
  amount: number
  tx_hash?: string
  status: string
  result?: Record<string, unknown>
  shipping_address?: Record<string, unknown>
  buyer_query?: string
  created_at?: string
  updated_at?: string
  items?: { name: string; type: string; endpoint?: string }
}

export interface Message {
  message_id: string
  order_id: string
  from_wallet: string
  to_wallet: string
  content: string
  direction: 'buyer_to_seller' | 'seller_to_buyer'
  created_at?: string
}

export interface PaymentInfo {
  amount: string
  currency: string
  network: string
  recipient: string
  order_id: string
}

export interface MarketplaceStats {
  sellers: number
  items: number
  orders: number
}

export interface ActivityEvent {
  order_id: string
  buyer: string
  seller: string
  item_name: string
  item_type: 'digital' | 'physical'
  amount: string
  status: string
  created_at: string
  updated_at?: string
}

// EIP-712 domain and types for Pactum auth
export const PACTUM_AUTH_DOMAIN = {
  name: 'Pactum',
  version: '1',
  chainId: 84532, // Testnet
} as const

export const PACTUM_AUTH_TYPES = {
  PactumAuth: [
    { name: 'wallet', type: 'address' },
    { name: 'challenge', type: 'bytes32' },
    { name: 'timestamp', type: 'uint256' },
  ],
} as const

// Session token storage (synced with sessionStorage)
let sessionToken: string | null = null

export function getSessionToken(): string | null {
  if (!sessionToken && typeof window !== 'undefined') {
    sessionToken = sessionStorage.getItem('pactum_jwt')
  }
  return sessionToken
}

export function setSessionToken(token: string | null) {
  sessionToken = token
  if (typeof window !== 'undefined') {
    if (token) {
      sessionStorage.setItem('pactum_jwt', token)
    } else {
      sessionStorage.removeItem('pactum_jwt')
    }
  }
}

export function getWalletFromToken(): string | null {
  const token = getSessionToken()
  if (!token) return null
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    // Check expiration
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      setSessionToken(null)
      return null
    }
    return payload.wallet || null
  } catch {
    return null
  }
}

function authHeaders(): Record<string, string> {
  if (!sessionToken) return {}
  return { Authorization: `Bearer ${sessionToken}` }
}

// API functions
export const api = {
  // Get protocol document
  async getProtocol(): Promise<Record<string, unknown>> {
    const res = await fetch(`${API_URL}/market`)
    if (!res.ok) throw new Error('Failed to fetch protocol')
    return res.json()
  },

  // Verify a JWT token
  async verifyToken(token: string): Promise<{ valid: boolean; wallet: string }> {
    const res = await fetch(`${API_URL}/market/auth/verify-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.message || 'Invalid token')
    }
    return res.json()
  },

  // Step 1: Get challenge for EIP-712 auth
  async getChallenge(): Promise<{ challenge: string; expires_at: string }> {
    const res = await fetch(`${API_URL}/market/auth/challenge`, { method: 'POST' })
    if (!res.ok) throw new Error('Failed to get challenge')
    return res.json()
  },

  // Step 2: Verify EIP-712 signature and get JWT
  async verifyAuth(wallet: string, signature: string, challenge: string, timestamp: number): Promise<string> {
    const res = await fetch(`${API_URL}/market/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, signature, challenge, timestamp }),
    })
    if (!res.ok) throw new Error('Authentication failed')
    const data = await res.json()
    sessionToken = data.token
    return data.token
  },

  // Register agent (no auth needed)
  async register(wallet: string, description: string): Promise<Seller> {
    const res = await fetch(`${API_URL}/market/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, description }),
    })
    if (res.status === 409) throw new Error('Already registered')
    if (res.status === 403) throw new Error('Not registered on-chain. Mint PactumAgent NFT first.')
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },

  // List all agents with their items (no auth needed)
  async getAgents(): Promise<{ agents: AgentWithItems[]; count: number }> {
    const res = await fetch(`${API_URL}/market/agents`)
    if (!res.ok) throw new Error('Failed to fetch agents')
    return res.json()
  },

  // Search items (no auth needed)
  async searchItems(
    query?: string,
    maxPrice?: number,
  ): Promise<{ items: Item[]; count: number }> {
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    if (maxPrice !== undefined) params.set('max_price', String(maxPrice))

    const res = await fetch(`${API_URL}/market/items?${params}`)
    if (!res.ok) throw new Error('Search failed')
    return res.json()
  },

  // Get item details (no auth needed)
  async getItem(itemId: string): Promise<Item> {
    const res = await fetch(`${API_URL}/market/items/${itemId}`)
    if (!res.ok) throw new Error('Failed to fetch item')
    return res.json()
  },

  // List item for sale (Bearer token)
  async listItem(
    item: {
      name: string
      description: string
      price: number
      type: 'digital' | 'physical'
      endpoint?: string
      requires_shipping?: boolean
    },
  ): Promise<Item> {
    const res = await fetch(`${API_URL}/market/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(item),
    })
    if (!res.ok) throw new Error('Failed to list item')
    return res.json()
  },

  // Get saved shipping address (Bearer token)
  async getAddress(): Promise<{ address: ShippingAddress | null }> {
    const res = await fetch(`${API_URL}/market/address`, {
      headers: authHeaders(),
    })
    if (!res.ok) throw new Error('Failed to fetch address')
    return res.json()
  },

  // Save/update shipping address (Bearer token)
  async updateAddress(address: ShippingAddress): Promise<{ address: ShippingAddress }> {
    const res = await fetch(`${API_URL}/market/address`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ address }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.message || 'Failed to save address')
    }
    return res.json()
  },

  // Buy item (402 flow, Bearer token)
  async buyItem(
    itemId: string,
    query?: string,
    shippingAddress?: ShippingAddress,
  ): Promise<{ status: string; payment?: PaymentInfo; order_id?: string }> {
    const body: Record<string, unknown> = {}
    if (query) body.query = query
    if (shippingAddress) body.shipping_address = shippingAddress

    const res = await fetch(`${API_URL}/market/buy/${itemId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    })

    if (res.status === 402) {
      const data = await res.json()
      return { status: 'payment_required', ...data }
    }
    if (!res.ok) throw new Error('Purchase failed')
    return res.json()
  },

  // Confirm purchase with payment proof (Bearer token)
  async confirmPurchase(
    itemId: string,
    orderId: string,
    txHash: string,
  ): Promise<Record<string, unknown>> {
    const res = await fetch(`${API_URL}/market/buy/${itemId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
        'X-Payment-Proof': txHash,
        'X-Order-Id': orderId,
      },
      body: JSON.stringify({}),
    })
    if (!res.ok) throw new Error('Payment confirmation failed')
    return res.json()
  },

  // Get my orders (Bearer token)
  async getOrders(): Promise<{ orders: Order[]; count: number }> {
    const res = await fetch(`${API_URL}/market/orders`, {
      headers: authHeaders(),
    })
    if (!res.ok) throw new Error('Failed to fetch orders')
    return res.json()
  },

  // Get order details (Bearer token)
  async getOrder(orderId: string): Promise<Order> {
    const res = await fetch(`${API_URL}/market/orders/${orderId}`, {
      headers: authHeaders(),
    })
    if (!res.ok) throw new Error('Failed to fetch order')
    return res.json()
  },

  // Get order messages (Bearer token)
  async getOrderMessages(orderId: string): Promise<{ messages: Message[]; count: number }> {
    const res = await fetch(`${API_URL}/market/orders/${orderId}/messages`, {
      headers: authHeaders(),
    })
    if (!res.ok) throw new Error('Failed to fetch messages')
    return res.json()
  },

  // Get marketplace stats
  async getStats(): Promise<MarketplaceStats> {
    const res = await fetch(`${API_URL}/market/stats`)
    if (!res.ok) return { sellers: 0, items: 0, orders: 0 }
    return res.json()
  },

  // Get public activity feed (no auth needed)
  async getActivity(limit = 10): Promise<{ events: ActivityEvent[]; count: number }> {
    const res = await fetch(`${API_URL}/market/activity?limit=${limit}`)
    if (!res.ok) return { events: [], count: 0 }
    return res.json()
  },

  // Health check
  async healthCheck(): Promise<{ status: string }> {
    const res = await fetch(`${API_URL}/health`)
    if (!res.ok) throw new Error('Health check failed')
    return res.json()
  },

  // Wallet Service — register email
  async walletRegister(email: string): Promise<{ message: string }> {
    const res = await fetch(`${WALLET_SERVICE_URL}/v1/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.detail || 'Registration failed')
    }
    return res.json()
  },

  // Wallet Service — verify email code
  async walletVerify(email: string, code: string): Promise<{ api_key: string; wallet_address: string }> {
    const res = await fetch(`${WALLET_SERVICE_URL}/v1/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.detail || 'Verification failed')
    }
    return res.json()
  },

  // Gateway — auth with wallet API key
  async authWallet(apiKey: string): Promise<{ token: string; wallet: string }> {
    const res = await fetch(`${API_URL}/market/auth/wallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.message || 'Auth failed')
    }
    const data = await res.json()
    setSessionToken(data.token)
    return data
  },

  // Register as seller (requires JWT + wallet API key for NFT minting)
  async registerSeller(
    endpoint: string,
    apiKey: string,
    description?: string,
    email?: string,
  ): Promise<{ status: string; wallet: string; endpoint?: string }> {
    const res = await fetch(`${API_URL}/market/register/seller`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
        'X-Wallet-Api-Key': apiKey,
      },
      body: JSON.stringify({ endpoint, description, email }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.message || 'Seller registration failed')
    }
    return res.json()
  },

  // Deliver order — text content (Bearer token, seller only)
  async deliverOrder(orderId: string, content: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${API_URL}/market/orders/${orderId}/deliver`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ content }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.message || 'Delivery failed')
    }
    return res.json()
  },

  // Deliver order — file upload (Bearer token, seller only)
  async deliverFile(orderId: string, file: File, message?: string): Promise<Record<string, unknown>> {
    const formData = new FormData()
    formData.append('file', file)
    if (message) formData.append('content', message)
    const res = await fetch(`${API_URL}/market/orders/${orderId}/deliver-file`, {
      method: 'POST',
      headers: authHeaders(),
      body: formData,
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.message || 'File delivery failed')
    }
    return res.json()
  },

  // Get unread events
  async getEvents(): Promise<{ events: Array<{ event_id: string; event_type: string; payload: Record<string, unknown>; created_at: string }>; count: number }> {
    const res = await fetch(`${API_URL}/market/events`, {
      headers: authHeaders(),
    })
    if (!res.ok) throw new Error('Failed to fetch events')
    return res.json()
  },
}
