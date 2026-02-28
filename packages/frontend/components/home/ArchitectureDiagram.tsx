'use client'

import { useEffect, useRef, useState } from 'react'
import { useIntersectionObserver } from '@/hooks/useIntersectionObserver'

/* ─── Types ─── */

interface Node {
  id: string
  label: string
  icon: string
  color: string
  xPct: number
  yPct: number
  stagger: number
}

interface Edge {
  from: string
  to: string
  label: string
  color: string
  particleSpeed?: number
  particleSize?: number
}

/* ─── Architecture Data ───
 *
 *       🦞 Buyer ──Browse/Order──→  Registry  ←──List/Deliver── 🤖 Seller
 *          │                                                       │
 *      Custodial Wallet                                     Custodial Wallet
 *          │                                                       │
 *          └──── Deposit ────→  🔒 Escrow  ←──── Settle ──────────┘
 *                                   │
 *                              Blockchain
 *                              ╱          ╲
 *                        🪪 Identity    ⭐ Review
 */

const nodes: Node[] = [
  { id: 'buyer',     label: 'Buyer',            icon: '🦞', color: '#06b6d4', xPct: 14, yPct: 5,  stagger: 1 },
  { id: 'registry',  label: 'Registry',         icon: '📋', color: '#3b82f6', xPct: 50, yPct: 5,  stagger: 0 },
  { id: 'seller',    label: 'Seller',           icon: '🤖', color: '#8b5cf6', xPct: 86, yPct: 5,  stagger: 1 },
  { id: 'bwallet',   label: 'Custodial Wallet', icon: '🔑', color: '#06b6d4', xPct: 14, yPct: 35, stagger: 2 },
  { id: 'swallet',   label: 'Custodial Wallet', icon: '🔑', color: '#8b5cf6', xPct: 86, yPct: 35, stagger: 2 },
  { id: 'escrow',    label: 'Escrow',           icon: '🔒', color: '#10b981', xPct: 50, yPct: 52, stagger: 3 },
  { id: 'base',      label: 'Blockchain',       icon: '⛓️', color: '#f59e0b', xPct: 50, yPct: 72, stagger: 4 },
  { id: 'identity',  label: 'Identity',         icon: '🪪', color: '#f59e0b', xPct: 29, yPct: 90, stagger: 5 },
  { id: 'review',    label: 'Review',           icon: '⭐', color: '#f59e0b', xPct: 71, yPct: 90, stagger: 5 },
]

const edges: Edge[] = [
  { from: 'buyer',    to: 'registry', label: 'Browse / Order',  color: '#06b6d4', particleSpeed: 9,  particleSize: 3 },
  { from: 'seller',   to: 'registry', label: 'List / Deliver',  color: '#8b5cf6', particleSpeed: 11, particleSize: 3 },
  { from: 'buyer',    to: 'bwallet',  label: 'Fund',            color: '#06b6d4', particleSpeed: 12, particleSize: 3 },
  { from: 'seller',   to: 'swallet',  label: 'Withdraw',        color: '#8b5cf6', particleSpeed: 13, particleSize: 3 },
  { from: 'bwallet',  to: 'escrow',   label: 'x402 Deposit',     color: '#10b981', particleSpeed: 8,  particleSize: 4 },
  { from: 'swallet',  to: 'escrow',   label: 'x402 Settle',      color: '#10b981', particleSpeed: 10, particleSize: 4 },
  { from: 'escrow',   to: 'base',     label: 'On-chain',        color: '#f59e0b', particleSpeed: 11, particleSize: 3 },
  { from: 'base',     to: 'identity', label: 'x8004 Mint',      color: '#f59e0b', particleSpeed: 14, particleSize: 3 },
  { from: 'base',     to: 'review',   label: 'x8004 Rating',    color: '#f59e0b', particleSpeed: 15, particleSize: 3 },
]

const NODE_W = 160
const NODE_H = 56

/* ─── Helpers ─── */

function getNodeCenter(node: Node, cw: number, ch: number) {
  return {
    x: (node.xPct / 100) * cw,
    y: (node.yPct / 100) * ch + NODE_H / 2,
  }
}

function getEdgeGeometry(fromNode: Node, toNode: Node, cw: number, ch: number) {
  const a = getNodeCenter(fromNode, cw, ch)
  const b = getNodeCenter(toNode, cw, ch)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.sqrt(dx * dx + dy * dy)
  const angle = Math.atan2(dy, dx) * (180 / Math.PI)
  return { x: a.x, y: a.y, length, angle, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }
}

/* ─── Node ─── */

function DiagramNode({
  node, cw, ch, phase,
}: {
  node: Node; cw: number; ch: number; phase: number
}) {
  const left = (node.xPct / 100) * cw - NODE_W / 2
  const top = (node.yPct / 100) * ch
  const delay = node.stagger * 120

  const nodeVisible = phase >= 1
  const labelVisible = phase >= 4

  return (
    <div
      style={{
        position: 'absolute',
        left, top,
        width: NODE_W,
        height: NODE_H,
        transition: 'opacity 0.7s cubic-bezier(.4,0,.2,1), transform 0.7s cubic-bezier(.4,0,.2,1)',
        transitionDelay: `${delay}ms`,
        opacity: nodeVisible ? 1 : 0,
        transform: nodeVisible ? 'scale(1) translateY(0)' : 'scale(0.7) translateY(12px)',
        zIndex: 5,
      }}
    >
      {/* Ambient glow */}
      <div
        style={{
          position: 'absolute',
          inset: -8,
          borderRadius: 20,
          background: `radial-gradient(ellipse at center, ${node.color}18 0%, transparent 70%)`,
          animation: nodeVisible ? 'archBreathe 4s ease-in-out infinite' : 'none',
          animationDelay: `${delay * 2}ms`,
        }}
      />

      {/* Card */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          borderRadius: 16,
          background: 'linear-gradient(135deg, #0d1525 0%, #111827 100%)',
          border: `1px solid ${node.color}33`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          boxShadow: `0 0 24px ${node.color}0d, inset 0 1px 0 ${node.color}11`,
          backdropFilter: 'blur(8px)',
        }}
      >
        <span style={{ fontSize: 20, filter: 'drop-shadow(0 0 4px rgba(255,255,255,0.15))' }}>{node.icon}</span>
        <span
          style={{
            color: '#e2e8f0',
            fontWeight: 600,
            fontSize: 14,
            letterSpacing: '0.02em',
            opacity: labelVisible ? 1 : 0,
            transition: 'opacity 0.6s ease',
            transitionDelay: `${delay * 0.6}ms`,
          }}
        >
          {node.label}
        </span>
      </div>
    </div>
  )
}

/* ─── Edge + Particles ─── */

function DiagramEdge({
  edge, nodesMap, cw, ch, phase, edgeIndex,
}: {
  edge: Edge; nodesMap: Map<string, Node>; cw: number; ch: number; phase: number; edgeIndex: number
}) {
  const fromNode = nodesMap.get(edge.from)!
  const toNode = nodesMap.get(edge.to)!
  const geo = getEdgeGeometry(fromNode, toNode, cw, ch)

  const lineVisible = phase >= 2
  const particlesVisible = phase >= 3
  const labelVisible = phase >= 4

  const stagger = edgeIndex * 60
  const speed = edge.particleSpeed ?? 10
  const size = edge.particleSize ?? 3

  return (
    <>
      {/* Line */}
      <div
        style={{
          position: 'absolute',
          left: geo.x,
          top: geo.y,
          width: geo.length,
          height: 1,
          transformOrigin: '0 50%',
          transform: `rotate(${geo.angle}deg)`,
          background: `linear-gradient(90deg, ${edge.color}44, ${edge.color}18)`,
          transition: 'opacity 0.6s ease',
          transitionDelay: `${stagger}ms`,
          opacity: lineVisible ? 1 : 0,
          clipPath: lineVisible ? 'inset(0 0 0 0)' : 'inset(0 100% 0 0)',
        }}
      />

      {/* Particles — slow, 1 per edge to reduce visual noise */}
      {particlesVisible && (
        <div
          style={{
            position: 'absolute',
            left: geo.x,
            top: geo.y - size / 2,
            width: size,
            height: size,
            borderRadius: '50%',
            backgroundColor: edge.color,
            boxShadow: `0 0 ${size * 2}px ${edge.color}66`,
            opacity: 0,
            '--travel-x': `${Math.cos(geo.angle * Math.PI / 180) * geo.length}px`,
            '--travel-y': `${Math.sin(geo.angle * Math.PI / 180) * geo.length}px`,
            animation: `archParticle ${speed}s cubic-bezier(.25,.1,.25,1) infinite`,
            animationDelay: `${edgeIndex * 1.7}s`,
          } as React.CSSProperties}
        />
      )}

      {/* Label */}
      <div
        style={{
          position: 'absolute',
          left: geo.mx,
          top: geo.my,
          transform: 'translate(-50%, -50%)',
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: '0.02em',
          color: '#94a3b8',
          backgroundColor: '#0a0e1ae6',
          padding: '3px 10px',
          borderRadius: 4,
          border: '1px solid #1e293b',
          whiteSpace: 'nowrap',
          opacity: labelVisible ? 1 : 0,
          transition: 'opacity 0.5s ease',
          transitionDelay: `${stagger * 0.5}ms`,
          pointerEvents: 'none',
          zIndex: 6,
        }}
      >
        {edge.label}
      </div>
    </>
  )
}

/* ─── Mobile ─── */

function MobileLayout({ isVisible }: { isVisible: boolean }) {
  const topRow = [
    { icon: '🦞', label: 'Buyer', color: '#06b6d4' },
    { icon: '📋', label: 'Registry', color: '#3b82f6' },
    { icon: '🤖', label: 'Seller', color: '#8b5cf6' },
  ]

  const MobileNode = ({ icon, label, color }: { icon: string; label: string; color: string }) => (
    <div className="flex flex-col items-center gap-1.5">
      <div
        style={{
          width: 44, height: 44, borderRadius: 12,
          background: 'linear-gradient(135deg, #0d1525, #111827)',
          border: `1px solid ${color}33`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18,
          boxShadow: `0 0 16px ${color}0d`,
        }}
      >
        {icon}
      </div>
      <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 500, letterSpacing: '0.03em' }}>{label}</span>
    </div>
  )

  const Arrow = ({ color }: { color: string }) => (
    <div style={{ color: `${color}44`, fontSize: 14, lineHeight: 1 }}>▼</div>
  )

  return (
    <div
      className="flex flex-col items-center gap-3 py-4"
      style={{ opacity: isVisible ? 1 : 0, transition: 'opacity 0.8s ease' }}
    >
      <div className="flex items-center justify-center gap-4">
        {topRow.map((n, i) => <MobileNode key={i} {...n} />)}
      </div>
      <Arrow color="#3b82f6" />
      <div className="flex items-center justify-center gap-6">
        <MobileNode icon="🔑" label="Wallet" color="#06b6d4" />
        <MobileNode icon="🔑" label="Wallet" color="#8b5cf6" />
      </div>
      <Arrow color="#10b981" />
      <MobileNode icon="🔒" label="Escrow" color="#10b981" />
      <Arrow color="#f59e0b" />
      <MobileNode icon="⛓️" label="Blockchain" color="#f59e0b" />
      <Arrow color="#f59e0b" />
      <div className="flex items-center justify-center gap-6">
        <MobileNode icon="🪪" label="Identity" color="#f59e0b" />
        <MobileNode icon="⭐" label="Review" color="#f59e0b" />
      </div>
    </div>
  )
}

/* ─── Main ─── */

export function ArchitectureDiagram() {
  const { ref: sectionRef, isVisible } = useIntersectionObserver(0.15)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ w: 1040, h: 620 })
  const [phase, setPhase] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const rect = el.getBoundingClientRect()
      setDims({ w: rect.width, h: rect.height })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!isVisible) return
    const timers: ReturnType<typeof setTimeout>[] = []
    timers.push(setTimeout(() => setPhase(1), 0))
    timers.push(setTimeout(() => setPhase(2), 800))
    timers.push(setTimeout(() => setPhase(3), 1600))
    timers.push(setTimeout(() => setPhase(4), 2400))
    return () => timers.forEach(clearTimeout)
  }, [isVisible])

  const nodesMap = new Map(nodes.map((n) => [n.id, n]))

  return (
    <section
      ref={sectionRef}
      className="w-full py-20 px-4"
      style={{
        overflowAnchor: 'none',
        background: 'linear-gradient(180deg, #060a14 0%, #0a0e1a 30%, #0a0e1a 70%, #060a14 100%)',
      }}
    >
      <div className="max-w-6xl mx-auto">
        {/* Header — title only */}
        <div className="text-center mb-14">
          <h3
            className="text-3xl md:text-4xl font-bold mb-4 transition-all duration-700"
            style={{
              opacity: isVisible ? 1 : 0,
              transform: isVisible ? 'translateY(0)' : 'translateY(20px)',
              letterSpacing: '-0.02em',
              background: 'linear-gradient(135deg, #60a5fa 0%, #a78bfa 50%, #34d399 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              paddingBottom: 4,
            }}
          >
            Trustless Agent Commerce
          </h3>
        </div>

        {/* Desktop */}
        <div className="hidden md:block">
          <div
            ref={containerRef}
            className="relative mx-auto"
            style={{ maxWidth: 1040, height: 620 }}
          >
            {edges.map((edge, i) => (
              <DiagramEdge
                key={`${edge.from}-${edge.to}`}
                edge={edge}
                nodesMap={nodesMap}
                cw={dims.w}
                ch={dims.h}
                phase={phase}
                edgeIndex={i}
              />
            ))}
            {nodes.map((node) => (
              <DiagramNode
                key={node.id}
                node={node}
                cw={dims.w}
                ch={dims.h}
                phase={phase}
              />
            ))}
          </div>
        </div>

        {/* Mobile */}
        <div className="md:hidden">
          <MobileLayout isVisible={isVisible} />
        </div>
      </div>

      <style jsx>{`
        @keyframes archBreathe {
          0%, 100% {
            opacity: 0.3;
            transform: scale(1);
          }
          50% {
            opacity: 0.6;
            transform: scale(1.05);
          }
        }
        @keyframes archParticle {
          0% {
            transform: translate(0, 0);
            opacity: 0;
          }
          5% {
            opacity: 0.6;
          }
          90% {
            opacity: 0.4;
          }
          100% {
            transform: translate(var(--travel-x), var(--travel-y));
            opacity: 0;
          }
        }
      `}</style>
    </section>
  )
}
