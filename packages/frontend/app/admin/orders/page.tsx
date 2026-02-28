'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { adminApi } from '@/lib/admin-api'

interface Order {
  order_id: string
  item_id: string
  buyer_wallet: string
  seller_wallet: string
  amount: number
  tx_hash: string | null
  status: string
  buyer_query: string | null
  result: unknown
  created_at: string
  items?: { name: string }
}

interface OrderDetail {
  order: Order
  messages: Array<{
    id: string
    from_wallet: string
    to_wallet: string
    content: string
    direction: string
    created_at: string
  }>
}

const TABS = ['all', 'created', 'paid', 'delivered', 'completed', 'failed']

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  created: 'secondary',
  paid: 'default',
  processing: 'outline',
  delivered: 'default',
  completed: 'default',
  failed: 'destructive',
}

function shortWallet(w: string) {
  return `${w.slice(0, 6)}...${w.slice(-4)}`
}

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [tab, setTab] = useState('all')
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [detail, setDetail] = useState<OrderDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    adminApi.getOrders(tab === 'all' ? undefined : tab)
      .then((d) => setOrders(d.orders))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [tab])

  async function toggleExpand(orderId: string) {
    if (expanded === orderId) {
      setExpanded(null)
      setDetail(null)
      return
    }
    setExpanded(orderId)
    setDetailLoading(true)
    try {
      const d = await adminApi.getOrderDetail(orderId)
      setDetail(d)
    } catch {
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Orders</h1>
        <span className="text-muted-foreground text-sm">{orders.length} shown</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-md text-sm capitalize transition-colors ${
              tab === t
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : (
        <div className="space-y-3">
          {orders.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">No orders</CardContent>
            </Card>
          )}

          {orders.map((o) => (
            <Card
              key={o.order_id}
              className="cursor-pointer hover:border-foreground/20 transition-colors"
              onClick={() => toggleExpand(o.order_id)}
            >
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">{o.items?.name || 'Unknown'}</p>
                    <p className="text-xs text-muted-foreground font-mono">{o.order_id.slice(0, 8)}...</p>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">{shortWallet(o.buyer_wallet)}</span>
                    <span>→</span>
                    <span className="text-muted-foreground">{shortWallet(o.seller_wallet)}</span>
                    <span className="font-medium ml-2">{o.amount} USDC</span>
                    <Badge variant={STATUS_VARIANT[o.status] || 'secondary'}>{o.status}</Badge>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {new Date(o.created_at).toLocaleString()}
                </div>

                {/* Expanded detail */}
                {expanded === o.order_id && (
                  <div className="mt-4 pt-4 border-t space-y-3 text-sm" onClick={(e) => e.stopPropagation()}>
                    {detailLoading ? (
                      <p className="text-muted-foreground">Loading details...</p>
                    ) : detail ? (
                      <>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-muted-foreground">Order ID: </span>
                            <span className="font-mono">{detail.order.order_id}</span>
                          </div>
                          {detail.order.tx_hash && (
                            <div>
                              <span className="text-muted-foreground">Tx: </span>
                              <a
                                href={`https://testnet.explorer.com/tx/${detail.order.tx_hash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono underline"
                              >
                                {detail.order.tx_hash.slice(0, 12)}...
                              </a>
                            </div>
                          )}
                        </div>

                        {detail.order.buyer_query && (
                          <div>
                            <p className="text-muted-foreground text-xs mb-1">Buyer Query</p>
                            <p className="bg-muted p-2 rounded text-xs">{detail.order.buyer_query}</p>
                          </div>
                        )}

                        {detail.order.result && (
                          <div>
                            <p className="text-muted-foreground text-xs mb-1">Result</p>
                            <pre className="bg-muted p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap">
                              {typeof detail.order.result === 'string'
                                ? detail.order.result
                                : JSON.stringify(detail.order.result, null, 2)}
                            </pre>
                          </div>
                        )}

                        {detail.messages.length > 0 && (
                          <div>
                            <p className="text-muted-foreground text-xs mb-1">Messages ({detail.messages.length})</p>
                            <div className="space-y-2">
                              {detail.messages.map((m, i) => (
                                <div key={i} className="bg-muted p-2 rounded text-xs">
                                  <div className="flex justify-between text-muted-foreground mb-1">
                                    <span className="font-mono">{shortWallet(m.from_wallet)} → {shortWallet(m.to_wallet)}</span>
                                    <span>{new Date(m.created_at).toLocaleString()}</span>
                                  </div>
                                  <p>{m.content}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-destructive text-xs">Failed to load details</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
