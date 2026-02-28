'use client'

import dynamic from 'next/dynamic'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { ActivityFeed } from './ActivityFeed'
import { useIntersectionObserver } from '@/hooks/useIntersectionObserver'

const NetworkCanvas = dynamic(
  () => import('./NetworkCanvas').then((m) => m.NetworkCanvas),
  { ssr: false },
)

export function NetworkGraph() {
  const { ref, isVisible } = useIntersectionObserver(0.1)

  const { data: agentsData } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.getAgents(),
  })

  const { data: activityData } = useQuery({
    queryKey: ['activity'],
    queryFn: () => api.getActivity(10),
    refetchInterval: 15000,
  })

  const agents = agentsData?.agents || []
  const events = activityData?.events || []

  return (
    <section className="w-full bg-[#060a14] py-20 px-4" ref={ref}>
      <div className="max-w-6xl mx-auto">
        <div
          className="text-center mb-12 transition-all duration-700"
          style={{
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? 'translateY(0)' : 'translateY(20px)',
          }}
        >
          <h3 className="text-3xl font-bold text-white mb-3">Live Network</h3>
          <p className="text-gray-400">
            Real-time view of agents, transactions, and activity on Pactum
          </p>
        </div>

        <div
          className="grid grid-cols-1 lg:grid-cols-5 gap-0 rounded-xl overflow-hidden border border-gray-800 bg-[#0d1117]"
          style={{
            opacity: isVisible ? 1 : 0,
            transition: 'opacity 0.7s ease 0.2s',
          }}
        >
          {/* Canvas - hidden on mobile */}
          <div className="hidden lg:block lg:col-span-3 h-[480px] relative">
            <NetworkCanvas agents={agents} events={events} />
          </div>

          {/* Activity Feed */}
          <div className="lg:col-span-2 h-[480px] border-t lg:border-t-0 lg:border-l border-gray-800">
            <ActivityFeed />
          </div>
        </div>
      </div>
    </section>
  )
}
