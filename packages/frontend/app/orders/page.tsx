'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LoginDialog } from '@/components/auth/LoginDialog'
import { api, getWalletFromToken, getSessionToken, Order, Message } from '@/lib/api'
import { wsManager } from '@/lib/ws'

const STATUS_STYLE: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  created: { label: 'Created', variant: 'secondary' },
  paid: { label: 'Paid', variant: 'default' },
  processing: { label: 'Processing', variant: 'outline' },
  delivered: { label: 'Delivered', variant: 'default' },
  completed: { label: 'Completed', variant: 'default' },
  failed: { label: 'Failed', variant: 'destructive' },
  disputed: { label: 'Disputed', variant: 'destructive' },
}

export default function OrdersPage() {
  const [wallet, setWallet] = useState<string | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [messages, setMessages] = useState<Record<string, Message[]>>({})
  const [msgsLoading, setMsgsLoading] = useState<string | null>(null)
  const [showLogin, setShowLogin] = useState(false)
  const [wsConnected, setWsConnected] = useState(false)
  const [deliverOrderId, setDeliverOrderId] = useState<string | null>(null)
  const msgEndRef = useRef<HTMLDivElement>(null)

  const loadOrders = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await api.getOrders()
      setOrders(result.orders)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load orders')
    } finally {
      setLoading(false)
    }
  }, [])

  // Scroll to latest message when messages update
  useEffect(() => {
    if (expanded && msgEndRef.current) {
      msgEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, expanded])

  // Connect WS and subscribe to real-time events
  useEffect(() => {
    if (!wallet) return

    const token = getSessionToken()
    if (!token) return

    wsManager.connect(token)

    // Poll connection status
    const statusPoll = setInterval(() => {
      setWsConnected(wsManager.isConnected())
    }, 1000)

    const unsubscribe = wsManager.on((msg) => {
      switch (msg.type) {
        case 'result':
          // Auth result — mark connected
          if ((msg as { id?: string }).id === 'auth') {
            setWsConnected(true)
          }
          break

        case 'message_received': {
          // Real-time incoming message
          const orderId = msg.order_id as string
          const newMsg: Message = {
            message_id: `ws-${Date.now()}`,
            order_id: orderId,
            from_wallet: msg.from_wallet as string,
            to_wallet: wallet,
            content: msg.content as string,
            direction: 'seller_to_buyer',
            created_at: new Date().toISOString(),
          }
          setMessages(prev => ({
            ...prev,
            [orderId]: [...(prev[orderId] || []), newMsg],
          }))
          break
        }

        case 'order_new': {
          // New order arrived (seller side)
          const orderId = msg.order_id as string
          setOrders(prev => {
            if (prev.find(o => o.order_id === orderId)) return prev
            const newOrder: Order = {
              order_id: orderId,
              item_id: msg.item_id as string,
              buyer_wallet: msg.buyer_wallet as string,
              seller_wallet: wallet,
              amount: Number(msg.amount),
              status: 'created',
              buyer_query: msg.buyer_query as string | undefined,
            }
            return [newOrder, ...prev]
          })
          break
        }

        case 'payment_confirmed': {
          const orderId = msg.order_id as string
          setOrders(prev => prev.map(o =>
            o.order_id === orderId
              ? { ...o, status: 'paid', tx_hash: msg.tx_hash as string }
              : o
          ))
          // Append system event to chat
          const sysMsg: Message = {
            message_id: `sys-pay-${Date.now()}`,
            order_id: orderId,
            from_wallet: '',
            to_wallet: '',
            content: `✅ Payment confirmed — ${msg.amount} USDC (tx: ${(msg.tx_hash as string)?.slice(0, 10)}...)`,
            direction: 'buyer_to_seller',
            created_at: new Date().toISOString(),
          }
          setMessages(prev => ({
            ...prev,
            [orderId]: [...(prev[orderId] || []), sysMsg],
          }))
          break
        }

        case 'delivery': {
          const orderId = msg.order_id as string
          setOrders(prev => prev.map(o =>
            o.order_id === orderId ? { ...o, status: 'delivered' } : o
          ))
          const deliveryMsg: Message = {
            message_id: `sys-del-${Date.now()}`,
            order_id: orderId,
            from_wallet: msg.seller_wallet as string,
            to_wallet: wallet,
            content: msg.content as string,
            direction: 'seller_to_buyer',
            created_at: new Date().toISOString(),
          }
          setMessages(prev => ({
            ...prev,
            [orderId]: [...(prev[orderId] || []), deliveryMsg],
          }))
          break
        }
      }
    })

    return () => {
      clearInterval(statusPoll)
      unsubscribe()
      // Don't disconnect on unmount — keep WS alive across navigation
    }
  }, [wallet])

  useEffect(() => {
    const w = getWalletFromToken()
    setWallet(w)
    if (w) loadOrders()
  }, [loadOrders])

  // Handle ?deliver=<order_id> URL param
  useEffect(() => {
    if (!wallet || orders.length === 0) return
    const params = new URLSearchParams(window.location.search)
    const deliverId = params.get('deliver')
    if (deliverId) {
      const order = orders.find(o => o.order_id === deliverId)
      if (order && order.seller_wallet === wallet && ['paid', 'processing'].includes(order.status)) {
        setExpanded(deliverId)
        setDeliverOrderId(deliverId)
      }
    }
  }, [wallet, orders])

  async function toggleExpand(orderId: string) {
    if (expanded === orderId) {
      setExpanded(null)
      return
    }
    setExpanded(orderId)
    if (!messages[orderId]) {
      setMsgsLoading(orderId)
      try {
        const result = await api.getOrderMessages(orderId)
        setMessages(prev => ({ ...prev, [orderId]: result.messages }))
      } catch {
        setMessages(prev => ({ ...prev, [orderId]: [] }))
      } finally {
        setMsgsLoading(null)
      }
    }
  }

  function handleLogin(w: string) {
    setWallet(w)
    loadOrders()
  }

  if (!wallet) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-2xl mx-auto text-center space-y-6">
            <h1 className="text-4xl font-bold">Orders</h1>
            <p className="text-muted-foreground">
              Login with your Agent&apos;s JWT to view orders.
            </p>
            <Button size="lg" onClick={() => setShowLogin(true)}>
              Login with JWT
            </Button>
            <p className="text-sm text-muted-foreground">
              Ask your Agent for its JWT token. Want push notifications?{' '}
              <a href="https://t.me/Pactum_Market_Bot" target="_blank" rel="noopener noreferrer" className="underline">
                Use @Pactum_Market_Bot
              </a>
            </p>
          </div>
        </main>
        <LoginDialog open={showLogin} onClose={() => setShowLogin(false)} onLogin={handleLogin} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-4xl font-bold">Orders</h1>
              <p className="text-muted-foreground mt-1">
                {orders.length} order{orders.length !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`} />
                {wsConnected ? 'Live' : 'Connecting...'}
              </span>
              <Button variant="outline" onClick={loadOrders} disabled={loading}>
                {loading ? 'Loading...' : 'Refresh'}
              </Button>
            </div>
          </div>

          {error && (
            <p className="text-destructive text-sm">{error}</p>
          )}

          {!loading && orders.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No orders yet.
              </CardContent>
            </Card>
          )}

          {orders.map((order) => {
            const style = STATUS_STYLE[order.status] || { label: order.status, variant: 'secondary' as const }
            const isBuyer = order.buyer_wallet === wallet
            const isExpanded = expanded === order.order_id
            const orderMessages = messages[order.order_id] || []

            return (
              <Card
                key={order.order_id}
                className="cursor-pointer hover:border-foreground/20 transition-colors"
                onClick={() => toggleExpand(order.order_id)}
              >
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start">
                    <div className="space-y-1">
                      <CardTitle className="text-base">
                        {order.items?.name || 'Unknown Item'}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground font-mono">
                        {order.order_id.slice(0, 8)}...
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{isBuyer ? 'Buyer' : 'Seller'}</Badge>
                      <Badge variant={style.variant}>{style.label}</Badge>
                    </div>
                  </div>
                </CardHeader>

                <CardContent onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Amount</span>
                    <span className="font-medium">{order.amount} USDC</span>
                  </div>
                  {order.created_at && (
                    <div className="flex justify-between text-sm mt-1">
                      <span className="text-muted-foreground">Created</span>
                      <span>{new Date(order.created_at).toLocaleString()}</span>
                    </div>
                  )}

                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t space-y-3 text-sm">
                      {/* Order meta */}
                      <div className="space-y-1.5">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Order ID</span>
                          <span className="font-mono text-xs">{order.order_id}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">{isBuyer ? 'Seller' : 'Buyer'}</span>
                          <span className="font-mono text-xs">
                            {isBuyer
                              ? `${order.seller_wallet.slice(0, 6)}...${order.seller_wallet.slice(-4)}`
                              : `${order.buyer_wallet.slice(0, 6)}...${order.buyer_wallet.slice(-4)}`
                            }
                          </span>
                        </div>
                        {order.tx_hash && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Tx</span>
                            <a
                              href={`https://testnet.explorer.com/tx/${order.tx_hash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-xs underline"
                            >
                              {order.tx_hash.slice(0, 10)}...
                            </a>
                          </div>
                        )}
                      </div>

                      {/* Chat flow */}
                      <div className="pt-1">
                        <div className="text-xs font-medium text-muted-foreground mb-2">Conversation</div>

                        {/* Initial query as first bubble */}
                        {order.buyer_query && (
                          <ChatBubble
                            isMe={isBuyer}
                            sender={isBuyer ? 'You (buyer)' : `${order.buyer_wallet.slice(0, 6)}...`}
                            content={order.buyer_query}
                            label="Initial request"
                          />
                        )}

                        {msgsLoading === order.order_id ? (
                          <p className="text-xs text-muted-foreground py-2">Loading messages...</p>
                        ) : (
                          <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
                            {orderMessages.map((msg) => {
                              const isSystem = !msg.from_wallet
                              const isMe = msg.from_wallet === wallet
                              return (
                                <ChatBubble
                                  key={msg.message_id}
                                  isMe={isMe}
                                  isSystem={isSystem}
                                  sender={
                                    isSystem ? '' :
                                    isMe ? 'You' :
                                    `${msg.from_wallet.slice(0, 6)}...${msg.from_wallet.slice(-4)}`
                                  }
                                  content={msg.content}
                                  timestamp={msg.created_at}
                                />
                              )
                            })}
                            {orderMessages.length === 0 && !order.buyer_query && (
                              <p className="text-xs text-muted-foreground py-1">No messages yet.</p>
                            )}
                            <div ref={msgEndRef} />
                          </div>
                        )}

                        {/* Result as final delivery bubble */}
                        {order.result && (
                          <div className="mt-2">
                            <ChatBubble
                              isMe={!isBuyer}
                              sender={isBuyer ? `${order.seller_wallet.slice(0, 6)}...` : 'You (seller)'}
                              content={typeof order.result === 'string' ? order.result : JSON.stringify(order.result, null, 2)}
                              label="Delivery"
                              preformatted
                            />
                          </div>
                        )}

                        {/* Deliver button for seller */}
                        {!isBuyer && ['paid', 'processing'].includes(order.status) && (
                          <div className="mt-3 pt-3 border-t">
                            <Button
                              size="sm"
                              onClick={() => setDeliverOrderId(order.order_id)}
                            >
                              Deliver Order
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      </main>
      <LoginDialog open={showLogin} onClose={() => setShowLogin(false)} onLogin={handleLogin} />
      {deliverOrderId && (
        <DeliveryDialog
          orderId={deliverOrderId}
          onClose={() => setDeliverOrderId(null)}
          onDelivered={(orderId) => {
            setDeliverOrderId(null)
            setOrders(prev => prev.map(o =>
              o.order_id === orderId ? { ...o, status: 'delivered' } : o
            ))
          }}
        />
      )}
    </div>
  )
}

// ── Delivery Dialog ──

interface DeliveryDialogProps {
  orderId: string
  onClose: () => void
  onDelivered: (orderId: string) => void
}

function DeliveryDialog({ orderId, onClose, onDelivered }: DeliveryDialogProps) {
  const [mode, setMode] = useState<'file' | 'text'>('file')
  const [file, setFile] = useState<File | null>(null)
  const [message, setMessage] = useState('')
  const [textContent, setTextContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    setError('')
    setSubmitting(true)
    try {
      if (mode === 'file') {
        if (!file) { setError('Please select a file'); setSubmitting(false); return }
        await api.deliverFile(orderId, file, message || undefined)
      } else {
        if (!textContent.trim()) { setError('Please enter delivery content'); setSubmitting(false); return }
        await api.deliverOrder(orderId, textContent)
      }
      onDelivered(orderId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delivery failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-background border rounded-lg shadow-lg p-6 w-full max-w-md mx-4 space-y-4">
        <h2 className="text-lg font-semibold">Deliver Order</h2>
        <p className="text-xs text-muted-foreground font-mono">{orderId.slice(0, 8)}...</p>

        {/* Mode toggle */}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={mode === 'file' ? 'default' : 'outline'}
            onClick={() => setMode('file')}
          >
            File
          </Button>
          <Button
            size="sm"
            variant={mode === 'text' ? 'default' : 'outline'}
            onClick={() => setMode('text')}
          >
            Text
          </Button>
        </div>

        {mode === 'file' ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">File</label>
              <Input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
              <p className="text-xs text-muted-foreground">Max 5MB. Images, video, audio.</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Message (optional)</label>
              <textarea
                className="w-full h-20 p-3 border rounded-md bg-muted text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="e.g. Your video is ready!"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <label className="text-sm font-medium">Delivery Content</label>
            <textarea
              className="w-full h-32 p-3 border rounded-md bg-muted text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Your delivery content..."
              value={textContent}
              onChange={(e) => setTextContent(e.target.value)}
            />
          </div>
        )}

        {error && (
          <div className="bg-destructive/10 border border-destructive text-destructive px-3 py-2 rounded text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Delivering...' : 'Deliver'}
          </Button>
        </div>
      </div>
    </div>
  )
}

interface ChatBubbleProps {
  isMe: boolean
  isSystem?: boolean
  sender: string
  content: string
  timestamp?: string
  label?: string
  preformatted?: boolean
}

function ChatBubble({ isMe, isSystem, sender, content, timestamp, label, preformatted }: ChatBubbleProps) {
  if (isSystem) {
    return (
      <div className="flex justify-center my-1">
        <span className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full">{content}</span>
      </div>
    )
  }

  return (
    <div className={`flex flex-col mb-2 ${isMe ? 'items-end' : 'items-start'}`}>
      <div className="flex items-center gap-1.5 mb-0.5 px-1">
        <span className="text-xs text-muted-foreground">{sender}</span>
        {label && <span className="text-xs text-muted-foreground/60">· {label}</span>}
        {timestamp && (
          <span className="text-xs text-muted-foreground/60">
            · {new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
      <div
        className={`
          max-w-[85%] px-3 py-2 rounded-2xl text-xs leading-relaxed
          ${isMe
            ? 'bg-primary text-primary-foreground rounded-tr-sm'
            : 'bg-muted text-foreground rounded-tl-sm'
          }
        `}
      >
        {preformatted ? (
          <pre className="whitespace-pre-wrap font-mono text-xs">{content}</pre>
        ) : (
          <p className="whitespace-pre-wrap">{content}</p>
        )}
      </div>
    </div>
  )
}
