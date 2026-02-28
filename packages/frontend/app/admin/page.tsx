'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { adminApi } from '@/lib/admin-api'

interface Overview {
  agents: number
  items: number
  orders: number
  total_volume: number
  status_counts: Record<string, number>
  recent_orders: Array<{
    order_id: string
    buyer_wallet: string
    seller_wallet: string
    amount: number
    status: string
    created_at: string
    items?: { name: string }
  }>
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  created: 'secondary',
  paid: 'default',
  processing: 'outline',
  delivered: 'default',
  completed: 'default',
  failed: 'destructive',
}

export default function AdminOverviewPage() {
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    adminApi.getOverview()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <p className="text-muted-foreground">Loading...</p>
  if (!data) return <p className="text-destructive">Failed to load overview</p>

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Agents</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{data.agents}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Items</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{data.items}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Orders</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{data.orders}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Volume (USDC)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{data.total_volume}</p>
          </CardContent>
        </Card>
      </div>

      {/* Status distribution */}
      {Object.keys(data.status_counts).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Order Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {Object.entries(data.status_counts).map(([status, count]) => (
                <div key={status} className="flex items-center gap-2">
                  <Badge variant={STATUS_VARIANT[status] || 'secondary'}>{status}</Badge>
                  <span className="text-sm font-medium">{count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent orders */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Orders</CardTitle>
        </CardHeader>
        <CardContent>
          {data.recent_orders.length === 0 ? (
            <p className="text-muted-foreground text-sm">No orders yet</p>
          ) : (
            <div className="space-y-3">
              {data.recent_orders.map((o) => (
                <div key={o.order_id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">{o.items?.name || 'Unknown'}</p>
                    <p className="text-xs text-muted-foreground font-mono">{o.order_id.slice(0, 8)}...</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm">{o.amount} USDC</span>
                    <Badge variant={STATUS_VARIANT[o.status] || 'secondary'}>{o.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
