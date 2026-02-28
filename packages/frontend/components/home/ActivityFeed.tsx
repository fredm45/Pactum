'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { ActivityEvent } from '@/lib/api'

const statusColors: Record<string, string> = {
  created: '#3b82f6',
  paid: '#10b981',
  processing: '#f59e0b',
  delivered: '#8b5cf6',
  completed: '#06b6d4',
  failed: '#ef4444',
  refunded: '#6b7280',
}

const statusLabels: Record<string, string> = {
  created: 'New Order',
  paid: 'Payment',
  processing: 'Processing',
  delivered: 'Delivered',
  completed: 'Completed',
  failed: 'Failed',
  refunded: 'Refunded',
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function FeedItem({ event, isNew }: { event: ActivityEvent; isNew: boolean }) {
  const color = statusColors[event.status] || '#6b7280'

  return (
    <div
      className="flex items-start gap-3 py-3 px-4 border-b border-gray-800 transition-all duration-500"
      style={{
        borderLeftWidth: '3px',
        borderLeftColor: color,
        opacity: isNew ? 1 : undefined,
        animation: isNew ? 'slideIn 0.4s ease-out' : undefined,
      }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span
            className="text-xs font-medium px-2 py-0.5 rounded-full"
            style={{ backgroundColor: `${color}20`, color }}
          >
            {statusLabels[event.status] || event.status}
          </span>
          <span className="text-xs text-gray-500">{timeAgo(event.created_at)}</span>
        </div>
        <p className="text-sm text-gray-300 truncate">
          <span className="text-gray-500">{event.buyer}</span>
          {' → '}
          <span className="text-white font-medium">{event.item_name}</span>
        </p>
        <p className="text-xs text-gray-500 mt-0.5">
          {event.amount} USDC · {event.item_type}
        </p>
      </div>
    </div>
  )
}

export function ActivityFeed() {
  const [prevIds, setPrevIds] = useState<Set<string>>(new Set())
  const [newIds, setNewIds] = useState<Set<string>>(new Set())
  const initialLoad = useRef(true)

  const { data } = useQuery({
    queryKey: ['activity'],
    queryFn: () => api.getActivity(10),
    refetchInterval: 15000,
  })

  const events = data?.events || []

  useEffect(() => {
    if (!events.length) return

    const currentIds = new Set(events.map((e) => e.order_id))

    if (initialLoad.current) {
      initialLoad.current = false
      setPrevIds(currentIds)
      return
    }

    const fresh = new Set<string>()
    currentIds.forEach((id) => {
      if (!prevIds.has(id)) fresh.add(id)
    })

    if (fresh.size > 0) {
      setNewIds(fresh)
      setPrevIds(currentIds)
      const timer = setTimeout(() => setNewIds(new Set()), 1000)
      return () => clearTimeout(timer)
    }
  }, [events, prevIds])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <h4 className="text-sm font-semibold text-white">Recent Activity</h4>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs text-gray-400">Live</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {events.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-500 text-sm">No activity yet</p>
          </div>
        ) : (
          events.map((event) => (
            <FeedItem
              key={`${event.order_id}-${event.status}`}
              event={event}
              isNew={newIds.has(event.order_id)}
            />
          ))
        )}
      </div>

      <style jsx>{`
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateX(-10px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
      `}</style>
    </div>
  )
}
