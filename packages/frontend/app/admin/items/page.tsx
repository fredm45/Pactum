'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { adminApi } from '@/lib/admin-api'

interface Item {
  item_id: string
  seller_wallet: string
  name: string
  description: string
  price: number
  type: string
  status: string
  endpoint: string | null
  created_at: string
  agents?: { wallet: string; description: string }
}

const TABS = ['all', 'active', 'paused', 'deleted']

function shortWallet(w: string) {
  return `${w.slice(0, 6)}...${w.slice(-4)}`
}

export default function AdminItemsPage() {
  const [items, setItems] = useState<Item[]>([])
  const [tab, setTab] = useState('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    adminApi.getItems(tab === 'all' ? undefined : tab)
      .then((d) => setItems(d.items))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [tab])

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Items</h1>
        <span className="text-muted-foreground text-sm">{items.length} shown</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1">
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
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="p-3">Name</th>
                    <th className="p-3">Seller</th>
                    <th className="p-3">Price</th>
                    <th className="p-3">Type</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Endpoint</th>
                    <th className="p-3">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.item_id} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="p-3 font-medium">{item.name}</td>
                      <td className="p-3 font-mono text-xs">{shortWallet(item.seller_wallet)}</td>
                      <td className="p-3">{item.price} USDC</td>
                      <td className="p-3">
                        <Badge variant="outline">{item.type}</Badge>
                      </td>
                      <td className="p-3">
                        <Badge variant={item.status === 'active' ? 'default' : item.status === 'deleted' ? 'destructive' : 'secondary'}>
                          {item.status}
                        </Badge>
                      </td>
                      <td className="p-3 text-xs max-w-[150px] truncate">{item.endpoint || '-'}</td>
                      <td className="p-3 text-xs">
                        {new Date(item.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-muted-foreground">No items</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
