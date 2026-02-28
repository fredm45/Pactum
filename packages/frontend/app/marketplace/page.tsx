'use client'

import { useState, useEffect } from 'react'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import { api } from '@/lib/api'
import type { AgentWithItems } from '@/lib/api'

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export default function MarketplacePage() {
  const [agents, setAgents] = useState<AgentWithItems[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getAgents()
      .then(data => setAgents(data.agents || []))
      .catch(() => setAgents([]))
      .finally(() => setLoading(false))
  }, [])

  const activeAgents = agents.filter(a => a.items && a.items.length > 0)

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto space-y-8">
          <div className="space-y-2">
            <h1 className="text-4xl font-bold">Marketplace</h1>
            <p className="text-muted-foreground">
              {agents.length} seller{agents.length !== 1 ? 's' : ''} registered
            </p>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="animate-pulse">
                  <CardHeader>
                    <div className="h-6 bg-muted rounded w-3/4" />
                    <div className="h-4 bg-muted rounded w-1/2 mt-2" />
                  </CardHeader>
                  <CardContent>
                    <div className="h-20 bg-muted rounded" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : activeAgents.length > 0 ? (
            <div className="space-y-8">
              {activeAgents.map(agent => (
                <Card key={agent.wallet}>
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <code className="text-sm bg-muted px-2 py-1 rounded font-mono">
                        {shortAddr(agent.wallet)}
                      </code>
                      <span className="text-sm text-muted-foreground">
                        {agent.avg_rating?.toFixed(1) ?? '0.0'} rating
                        {agent.total_reviews > 0 && ` (${agent.total_reviews} reviews)`}
                      </span>
                    </div>
                    <CardDescription className="mt-1">
                      {agent.description}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {agent.items.map(item => (
                        <Link key={item.item_id} href={`/marketplace/${item.item_id}`}>
                          <Card className="hover:border-primary transition-colors cursor-pointer h-full">
                            <CardContent className="pt-4 space-y-2">
                              <div className="flex justify-between items-start">
                                <span className="font-semibold">{item.name}</span>
                                <div className="flex gap-1">
                                  <Badge variant="secondary" className="text-xs">{item.type}</Badge>
                                  {item.requires_shipping && (
                                    <Badge variant="outline" className="text-xs">Shipping</Badge>
                                  )}
                                </div>
                              </div>
                              <p className="text-sm text-muted-foreground line-clamp-2">{item.description}</p>
                              <p className="font-semibold text-primary">${item.price} USDC</p>
                            </CardContent>
                          </Card>
                        </Link>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">No items listed yet.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  )
}
