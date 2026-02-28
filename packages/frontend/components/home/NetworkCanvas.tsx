'use client'

import { useEffect, useRef, useCallback } from 'react'
import type { AgentWithItems, ActivityEvent } from '@/lib/api'

interface Node {
  x: number
  y: number
  radius: number
  label: string
  type: 'hub' | 'seller' | 'buyer' | 'ghost'
  color: string
  phase: number
  speed: number
}

interface Particle {
  fromIdx: number
  toIdx: number
  progress: number
  speed: number
  color: string
  trail: { x: number; y: number; alpha: number }[]
}

const HUB_COLOR = '#3b82f6'
const SELLER_COLOR = '#8b5cf6'
const BUYER_COLOR = '#06b6d4'
const GHOST_COLOR = '#374151'

const EVENT_COLORS: Record<string, string> = {
  created: '#3b82f6',
  paid: '#10b981',
  delivered: '#8b5cf6',
  completed: '#06b6d4',
}

export function NetworkCanvas({
  agents,
  events,
}: {
  agents: AgentWithItems[]
  events: ActivityEvent[]
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const nodesRef = useRef<Node[]>([])
  const particlesRef = useRef<Particle[]>([])
  const frameRef = useRef<number>(0)
  const lastEventRef = useRef<number>(0)
  const lastParticleRef = useRef<number>(0)

  const buildNodes = useCallback(
    (w: number, h: number) => {
      const cx = w / 2
      const cy = h / 2
      const nodes: Node[] = []

      // Hub
      nodes.push({
        x: cx,
        y: cy,
        radius: 24,
        label: 'Pactum',
        type: 'hub',
        color: HUB_COLOR,
        phase: 0,
        speed: 0.3,
      })

      // Seller nodes (inner ring)
      const sellerRadius = Math.min(w, h) * 0.28
      const sellers = agents.length > 0 ? agents : []
      const sellerCount = Math.max(sellers.length, 3)

      for (let i = 0; i < sellerCount; i++) {
        const angle = (i / sellerCount) * Math.PI * 2 - Math.PI / 2
        const seller = sellers[i]
        nodes.push({
          x: cx + Math.cos(angle) * sellerRadius,
          y: cy + Math.sin(angle) * sellerRadius,
          radius: 14,
          label: seller
            ? seller.description?.slice(0, 12) || `${seller.wallet.slice(0, 6)}...`
            : 'Your Agent?',
          type: seller ? 'seller' : 'ghost',
          color: seller ? SELLER_COLOR : GHOST_COLOR,
          phase: Math.random() * Math.PI * 2,
          speed: 0.4 + Math.random() * 0.3,
        })
      }

      // Buyer nodes (outer ring)
      const buyerRadius = Math.min(w, h) * 0.42
      const uniqueBuyers = [...new Set(events.map((e) => e.buyer))].slice(0, 6)
      const buyerCount = Math.max(uniqueBuyers.length, 4)

      for (let i = 0; i < buyerCount; i++) {
        const angle = (i / buyerCount) * Math.PI * 2 + Math.PI / (buyerCount * 2)
        const buyer = uniqueBuyers[i]
        nodes.push({
          x: cx + Math.cos(angle) * buyerRadius,
          y: cy + Math.sin(angle) * buyerRadius,
          radius: 10,
          label: buyer || '?',
          type: buyer ? 'buyer' : 'ghost',
          color: buyer ? BUYER_COLOR : GHOST_COLOR,
          phase: Math.random() * Math.PI * 2,
          speed: 0.5 + Math.random() * 0.3,
        })
      }

      return nodes
    },
    [agents, events],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect()
      if (!rect) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      ctx.scale(dpr, dpr)
      nodesRef.current = buildNodes(rect.width, rect.height)
    }

    resize()
    window.addEventListener('resize', resize)

    let running = true
    const particles = particlesRef.current

    function drawHexGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.04)'
      ctx.lineWidth = 1
      const size = 40
      const h_off = size * Math.sqrt(3)
      const v_off = size * 1.5

      for (let row = -1; row < h / v_off + 1; row++) {
        for (let col = -1; col < w / h_off + 1; col++) {
          const x = col * h_off + (row % 2 ? h_off / 2 : 0)
          const y = row * v_off
          ctx.beginPath()
          for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i - Math.PI / 6
            const px = x + size * Math.cos(angle)
            const py = y + size * Math.sin(angle)
            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
          }
          ctx.closePath()
          ctx.stroke()
        }
      }
    }

    function draw(time: number) {
      if (!running || !ctx || !canvas) return
      const w = canvas.clientWidth
      const h = canvas.clientHeight

      ctx.clearRect(0, 0, w, h)

      // Hex grid background
      drawHexGrid(ctx, w, h)

      const nodes = nodesRef.current
      const t = time / 1000

      // Idle particle generation
      if (t - lastParticleRef.current > 5 + Math.random() * 3) {
        lastParticleRef.current = t
        if (nodes.length > 1) {
          const from = 0
          const to = 1 + Math.floor(Math.random() * (nodes.length - 1))
          particles.push({
            fromIdx: from,
            toIdx: to,
            progress: 0,
            speed: 0.3 + Math.random() * 0.4,
            color: 'rgba(147, 197, 253, 0.6)',
            trail: [],
          })
        }
      }

      // Event-driven particles
      if (events.length > 0 && t - lastEventRef.current > 3) {
        lastEventRef.current = t
        const evt = events[Math.floor(Math.random() * events.length)]
        const color = EVENT_COLORS[evt.status] || '#3b82f6'
        if (nodes.length > 2) {
          const buyerIdx = Math.min(
            nodes.length - 1,
            nodes.findIndex((n) => n.type === 'buyer') || nodes.length - 1
          )
          const sellerIdx = Math.min(
            nodes.length - 1,
            nodes.findIndex((n) => n.type === 'seller') || 1
          )
          // buyer → hub
          particles.push({
            fromIdx: buyerIdx > 0 ? buyerIdx : nodes.length - 1,
            toIdx: 0,
            progress: 0,
            speed: 0.5,
            color,
            trail: [],
          })
          // hub → seller
          setTimeout(() => {
            particles.push({
              fromIdx: 0,
              toIdx: sellerIdx > 0 ? sellerIdx : 1,
              progress: 0,
              speed: 0.5,
              color,
              trail: [],
            })
          }, 800)
        }
      }

      // Draw connections
      ctx.lineWidth = 1
      for (let i = 1; i < nodes.length; i++) {
        const node = nodes[i]
        const bobY = Math.sin(t * node.speed + node.phase) * 4
        const hub = nodes[0]
        const hubBob = Math.sin(t * hub.speed + hub.phase) * 2

        ctx.beginPath()
        ctx.moveTo(hub.x, hub.y + hubBob)
        ctx.lineTo(node.x, node.y + bobY)
        ctx.strokeStyle =
          node.type === 'ghost' ? 'rgba(55, 65, 81, 0.2)' : `${node.color}15`
        ctx.stroke()
      }

      // Update & draw particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.progress += p.speed * 0.016

        if (p.progress >= 1) {
          particles.splice(i, 1)
          continue
        }

        const from = nodes[p.fromIdx]
        const to = nodes[p.toIdx]
        if (!from || !to) {
          particles.splice(i, 1)
          continue
        }

        const fromBob = Math.sin(t * from.speed + from.phase) * (from.type === 'hub' ? 2 : 4)
        const toBob = Math.sin(t * to.speed + to.phase) * (to.type === 'hub' ? 2 : 4)

        const x = from.x + (to.x - from.x) * p.progress
        const y = from.y + fromBob + (to.y + toBob - from.y - fromBob) * p.progress

        // Trail
        p.trail.push({ x, y, alpha: 1 })
        if (p.trail.length > 12) p.trail.shift()

        for (let j = 0; j < p.trail.length; j++) {
          const tp = p.trail[j]
          tp.alpha *= 0.9
          ctx.beginPath()
          ctx.arc(tp.x, tp.y, 2 * tp.alpha, 0, Math.PI * 2)
          ctx.fillStyle = p.color.replace(
            /[\d.]+\)$/,
            `${tp.alpha * 0.6})`,
          )
          ctx.fill()
        }

        // Head
        ctx.beginPath()
        ctx.arc(x, y, 4, 0, Math.PI * 2)
        ctx.fillStyle = p.color
        ctx.fill()
      }

      // Draw nodes
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        const bobY = Math.sin(t * node.speed + node.phase) * (node.type === 'hub' ? 2 : 4)

        // Glow
        if (node.type !== 'ghost') {
          const grad = ctx.createRadialGradient(
            node.x,
            node.y + bobY,
            node.radius * 0.5,
            node.x,
            node.y + bobY,
            node.radius * 2.5,
          )
          grad.addColorStop(0, `${node.color}20`)
          grad.addColorStop(1, 'transparent')
          ctx.beginPath()
          ctx.arc(node.x, node.y + bobY, node.radius * 2.5, 0, Math.PI * 2)
          ctx.fillStyle = grad
          ctx.fill()
        }

        // Node circle
        ctx.beginPath()
        ctx.arc(node.x, node.y + bobY, node.radius, 0, Math.PI * 2)
        ctx.fillStyle =
          node.type === 'ghost' ? '#1f2937' : node.color
        ctx.fill()

        if (node.type === 'ghost') {
          ctx.strokeStyle = '#374151'
          ctx.lineWidth = 1
          ctx.setLineDash([3, 3])
          ctx.stroke()
          ctx.setLineDash([])
        }

        // Label
        ctx.fillStyle =
          node.type === 'ghost' ? '#6b7280' : '#ffffff'
        ctx.font =
          node.type === 'hub'
            ? 'bold 11px system-ui'
            : '10px system-ui'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'

        if (node.type === 'hub') {
          ctx.fillText(node.label, node.x, node.y + bobY)
        } else {
          ctx.fillText(
            node.label,
            node.x,
            node.y + bobY + node.radius + 14,
          )
        }
      }

      frameRef.current = requestAnimationFrame(draw)
    }

    frameRef.current = requestAnimationFrame(draw)

    return () => {
      running = false
      cancelAnimationFrame(frameRef.current)
      window.removeEventListener('resize', resize)
    }
  }, [buildNodes, events])

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      style={{ display: 'block' }}
    />
  )
}
