// Admin API client

const ADMIN_KEY = 'pactum_admin_jwt'

export function getAdminToken(): string | null {
  if (typeof window === 'undefined') return null
  return sessionStorage.getItem(ADMIN_KEY)
}

export function setAdminToken(token: string | null) {
  if (typeof window === 'undefined') return
  if (token) {
    sessionStorage.setItem(ADMIN_KEY, token)
  } else {
    sessionStorage.removeItem(ADMIN_KEY)
  }
}

export function getAdminEmail(): string | null {
  const token = getAdminToken()
  if (!token) return null
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      setAdminToken(null)
      return null
    }
    if (!payload.admin) return null
    return payload.email || null
  } catch {
    return null
  }
}

function adminHeaders(): Record<string, string> {
  const token = getAdminToken()
  if (!token) return {}
  return { Authorization: `Bearer ${token}` }
}

async function adminFetch(path: string, init?: RequestInit) {
  const res = await fetch(`/admin/api${path}`, {
    ...init,
    headers: { ...adminHeaders(), ...init?.headers },
  })
  if (res.status === 401) {
    setAdminToken(null)
    throw new Error('Unauthorized')
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || data.error || `Request failed: ${res.status}`)
  }
  return res.json()
}

export const adminApi = {
  async sendCode(email: string) {
    return adminFetch('/auth/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
  },

  async login(email: string, code: string, password: string) {
    const data = await adminFetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, password }),
    })
    setAdminToken(data.token)
    return data
  },

  async getOverview() {
    return adminFetch('/overview')
  },

  async getAgents() {
    return adminFetch('/agents')
  },

  async getItems(status?: string) {
    const params = status ? `?status=${status}` : ''
    return adminFetch(`/items${params}`)
  },

  async getOrders(status?: string) {
    const params = status ? `?status=${status}` : ''
    return adminFetch(`/orders${params}`)
  },

  async getOrderDetail(orderId: string) {
    return adminFetch(`/orders/${orderId}`)
  },
}
