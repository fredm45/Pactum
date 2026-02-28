'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { adminApi } from '@/lib/admin-api'

interface Agent {
  wallet: string
  description: string | null
  avg_rating: number
  total_reviews: number
  telegram_user_id: string | null
  registered_at: string | null
}

function shortWallet(w: string) {
  return `${w.slice(0, 6)}...${w.slice(-4)}`
}

export default function AdminAgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    adminApi.getAgents()
      .then((d) => setAgents(d.agents))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <p className="text-muted-foreground">Loading...</p>

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Agents</h1>
        <span className="text-muted-foreground text-sm">{agents.length} total</span>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="p-3">Wallet</th>
                  <th className="p-3">Description</th>
                  <th className="p-3">Rating</th>
                  <th className="p-3">Reviews</th>
                  <th className="p-3">Telegram</th>
                  <th className="p-3">Registered</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.wallet} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="p-3 font-mono text-xs">{shortWallet(a.wallet)}</td>
                    <td className="p-3 max-w-[200px] truncate">{a.description || '-'}</td>
                    <td className="p-3">{a.avg_rating}</td>
                    <td className="p-3">{a.total_reviews}</td>
                    <td className="p-3">{a.telegram_user_id || '-'}</td>
                    <td className="p-3 text-xs">
                      {a.registered_at ? new Date(a.registered_at).toLocaleDateString() : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
