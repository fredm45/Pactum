// WebSocket manager — persistent connection for real-time order/message updates

const WS_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000')
  .replace(/^http/, 'ws')
  .replace(/^https/, 'wss')

export interface WsMessage {
  type: string
  [key: string]: unknown
}

export type WsEventHandler = (msg: WsMessage) => void

class PactumWsManager {
  private ws: WebSocket | null = null
  private token: string | null = null
  private pingInterval: ReturnType<typeof setInterval> | null = null
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private handlers: Set<WsEventHandler> = new Set()
  private reconnectDelay = 2000
  private stopped = false

  connect(token: string) {
    this.token = token
    this.stopped = false
    this._connect()
  }

  disconnect() {
    this.stopped = true
    this._clearTimers()
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  on(handler: WsEventHandler) {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  isConnected() {
    return this.ws?.readyState === WebSocket.OPEN
  }

  private _connect() {
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
      this.ws = null
    }

    const ws = new WebSocket(`${WS_URL}/ws`)
    this.ws = ws

    ws.onopen = () => {
      this.reconnectDelay = 2000
      // Authenticate immediately
      ws.send(JSON.stringify({ id: 'auth', type: 'auth', token: this.token }))
      // Heartbeat every 30s
      this._clearTimers()
      this.pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ id: 'ping', type: 'ping' }))
        }
      }, 30000)
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WsMessage
        this.handlers.forEach(h => h(msg))
      } catch {
        // ignore parse errors
      }
    }

    ws.onclose = () => {
      this._clearTimers()
      if (!this.stopped) {
        this.reconnectTimeout = setTimeout(() => {
          this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 30000)
          this._connect()
        }, this.reconnectDelay)
      }
    }

    ws.onerror = () => {
      ws.close()
    }
  }

  private _clearTimers() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
  }
}

// Singleton
export const wsManager = new PactumWsManager()
