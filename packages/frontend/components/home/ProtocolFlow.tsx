'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MarketplaceStats } from '@/lib/api'

/* ─── Types ─── */

interface ChatMessage {
  role: 'user' | 'bot'
  text: string
  phase: number
  widget?: 'tx-confirm' | 'signal-file'
  pauseAfter?: number // extra ms to wait after this message
}

interface Phase {
  title: string
  description: string
}

/* ─── Data ─── */

const phases: Phase[] = [
  { title: 'Onboarding', description: 'Talk to your AI counselor' },
  { title: 'Create Wallet', description: 'Email signup + verification code' },
  { title: 'Register Identity', description: 'On-chain marketplace registration' },
  { title: 'Fund Wallet', description: 'Transfer USDC — withdraw anytime' },
  { title: 'Browse Services', description: 'AI agent searches the marketplace' },
  { title: 'Purchase', description: 'Pay via smart contract escrow' },
  { title: 'Delivery', description: 'Receive result, funds auto-settle' },
]

const script: ChatMessage[] = [
  // Phase 0 — Onboarding
  { role: 'user', text: 'Help me join www.pactum.cc as a buyer', phase: 0 },
  { role: 'bot', text: 'Sure! Let me look into what we need...', phase: 0 },
  { role: 'bot', text: "OK first I'll set you up with a wallet. What's your email?", phase: 0 },
  // Phase 1 — Create Wallet
  { role: 'user', text: 'alice@example.com', phase: 1 },
  { role: 'bot', text: 'Sent you a verification code — check your inbox.', phase: 1 },
  { role: 'user', text: 'Got it: 483926', phase: 1 },
  { role: 'bot', text: "Verified! Your wallet is ready: 0xA1b2...C3d4. It's a custodial smart wallet — you can move your funds anywhere anytime.", phase: 1, pauseAfter: 2000 },
  // Phase 2 — Register Identity
  { role: 'bot', text: 'Also registered you as a buyer on the marketplace!', phase: 2 },
  // Phase 3 — Fund Wallet
  { role: 'bot', text: 'To start trading, transfer some USDC to your wallet address.', phase: 3 },
  { role: 'user', text: 'Sent 10 USDC', phase: 3 },
  { role: 'bot', text: 'Received! Balance: 10.00 USDC', phase: 3, widget: 'tx-confirm' },
  // Phase 4 — Browse Services
  { role: 'user', text: 'Find me a crypto signal service', phase: 4 },
  { role: 'bot', text: 'Searching the marketplace...', phase: 4 },
  { role: 'bot', text: 'Found 3 options:\n1. Alpha Signal Pro — 0.02 USDC\n2. On-Chain Analytics — 0.01 USDC\n3. Whale Alert Feed — 0.01 USDC', phase: 4, pauseAfter: 2500 },
  // Phase 5 — Purchase
  { role: 'user', text: 'Go with #1', phase: 5 },
  { role: 'bot', text: 'Placing order... 0.02 USDC deposited to escrow.', phase: 5 },
  // Phase 6 — Delivery
  { role: 'bot', text: 'Purchase successful! We received the result — check it out:', phase: 6 },
  { role: 'bot', text: '', phase: 6, widget: 'signal-file' },
]

/* ─── Components ─── */

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2 mb-3 animate-fadeInUp">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-xs flex-shrink-0"
        style={{ backgroundColor: '#2a2f3a' }}
      >
        🤖
      </div>
      <div
        className="px-3 py-2.5 rounded-2xl rounded-bl-sm"
        style={{ backgroundColor: '#2a2f3a' }}
      >
        <div className="flex gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-typingBounce" style={{ animationDelay: '0ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-typingBounce" style={{ animationDelay: '150ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-typingBounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  )
}

function TxWidget() {
  return (
    <div
      className="mt-1.5 px-3 py-2 rounded-lg text-xs font-mono animate-fadeInUp"
      style={{
        backgroundColor: 'rgba(16, 185, 129, 0.15)',
        border: '1px solid rgba(16, 185, 129, 0.3)',
        color: '#10b981',
      }}
    >
      <div className="flex items-center gap-1.5">
        <span>✓</span>
        <span className="font-semibold">+10.00 USDC confirmed</span>
      </div>
      <div className="text-gray-500 mt-0.5 text-xs">tx: 0x8f3a...b291</div>
    </div>
  )
}

function SignalFileWidget() {
  return (
    <div
      className="mt-1.5 rounded-lg text-xs overflow-hidden animate-fadeInUp"
      style={{
        backgroundColor: '#1e293b',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        maxWidth: '260px',
      }}
    >
      {/* File header */}
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}
      >
        <span style={{ fontSize: '14px' }}>📄</span>
        <span className="text-gray-300 font-medium text-xs">signal_report.json</span>
        <span className="text-gray-600 ml-auto text-xs">1.2 KB</span>
      </div>
      {/* Preview content */}
      <div className="px-3 py-2 font-mono text-gray-400 space-y-1" style={{ fontSize: '11px', lineHeight: '1.4' }}>
        <div><span className="text-blue-400">BTC</span> <span className="text-green-400">LONG</span> · entry 67,420 · tp 71,000</div>
        <div><span className="text-blue-400">ETH</span> <span className="text-green-400">LONG</span> · entry 3,180 · tp 3,500</div>
        <div><span className="text-blue-400">SOL</span> <span className="text-yellow-400">HOLD</span> · wait for 148 retest</div>
        <div className="text-gray-600">+ 2 more signals...</div>
      </div>
    </div>
  )
}

function renderText(text: string) {
  const parts = text.split(/(www\.pactum\.cc)/)
  return parts.map((part, i) =>
    part === 'www.pactum.cc' ? (
      <span key={i} style={{ color: '#5eaaef', textDecoration: 'underline' }}>{part}</span>
    ) : (
      part
    )
  )
}

function ChatBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user'

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'items-end gap-2'} mb-3 animate-fadeInUp`}
    >
      {!isUser && (
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-xs flex-shrink-0"
          style={{ backgroundColor: '#2a2f3a' }}
        >
          🤖
        </div>
      )}
      <div className="max-w-[80%]">
        {msg.text && (
          <div
            className="px-3 py-1.5 rounded-2xl text-sm whitespace-pre-line"
            style={{
              backgroundColor: isUser ? '#2b5278' : '#2a2f3a',
              borderBottomRightRadius: isUser ? '4px' : undefined,
              borderBottomLeftRadius: !isUser ? '4px' : undefined,
              color: '#e4e6eb',
            }}
          >
            {renderText(msg.text)}
          </div>
        )}
        {msg.widget === 'tx-confirm' && <TxWidget />}
        {msg.widget === 'signal-file' && <SignalFileWidget />}
      </div>
    </div>
  )
}

function TimelineStep({ phase, index, activePhase, onClick }: {
  phase: Phase
  index: number
  activePhase: number
  onClick: () => void
}) {
  const isCompleted = index < activePhase
  const isActive = index === activePhase
  const isPending = index > activePhase

  return (
    <button
      onClick={onClick}
      className={`flex items-start gap-3 py-2.5 transition-all duration-300 w-full text-left cursor-pointer hover:opacity-90 ${isPending ? 'opacity-40 hover:opacity-60' : ''}`}
    >
      <div className="flex flex-col items-center">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-medium transition-all duration-300"
          style={{
            backgroundColor: isActive ? '#3b82f6' : isCompleted ? '#1e293b' : '#1e293b',
            color: isActive ? '#fff' : isCompleted ? '#64748b' : '#475569',
            boxShadow: isActive ? '0 0 12px rgba(59, 130, 246, 0.5)' : 'none',
          }}
        >
          {isCompleted ? '✓' : index}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <p
          className="text-base font-medium transition-colors duration-300"
          style={{ color: isActive ? '#fff' : isCompleted ? '#64748b' : '#475569' }}
        >
          {phase.title}
        </p>
        <p
          className="text-sm text-gray-500 mt-0.5 transition-opacity duration-300"
          style={{ opacity: isActive ? 1 : 0, height: '1.35rem' }}
        >
          {phase.description}
        </p>
      </div>
    </button>
  )
}

/* ─── Main Component ─── */

export function ProtocolFlow({ stats }: { stats?: MarketplaceStats }) {
  const sectionRef = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [activePhase, setActivePhase] = useState(0)
  const [showTyping, setShowTyping] = useState(false)
  const [isFinished, setIsFinished] = useState(false)
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([])

  // Continuous visibility tracking (enter + leave)
  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { threshold: 0.15 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const clearTimers = useCallback(() => {
    timeoutsRef.current.forEach(clearTimeout)
    timeoutsRef.current = []
  }, [])

  const addTimer = useCallback((fn: () => void, delay: number) => {
    const id = setTimeout(fn, delay)
    timeoutsRef.current.push(id)
    return id
  }, [])

  // Auto-scroll chat (container only, never the page)
  useEffect(() => {
    const el = chatContainerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, showTyping])

  // Play the script — returns total duration in ms
  const play = useCallback(() => {
    clearTimers()
    setMessages([])
    setActivePhase(0)
    setShowTyping(false)
    setIsFinished(false)

    let elapsed = 1000 // initial delay

    script.forEach((msg, i) => {
      const prevMsg = i > 0 ? script[i - 1] : null
      const phaseChanged = prevMsg && msg.phase !== prevMsg.phase

      // Extra pause on phase change
      if (phaseChanged) elapsed += 1500

      // Extra pause from previous message's pauseAfter
      if (prevMsg?.pauseAfter) elapsed += prevMsg.pauseAfter

      if (msg.role === 'bot') {
        // Show typing indicator
        const typingStart = elapsed
        addTimer(() => {
          setShowTyping(true)
          setActivePhase(msg.phase)
        }, typingStart)

        // Replace typing with message
        const typingDuration = 1200 + Math.random() * 800
        elapsed += typingDuration
        addTimer(() => {
          setShowTyping(false)
          setMessages((prev) => [...prev, msg])
        }, elapsed)
      } else {
        // User message — longer pause to read previous bot message
        elapsed += 1400 + Math.random() * 600
        addTimer(() => {
          setActivePhase(msg.phase)
          setMessages((prev) => [...prev, msg])
        }, elapsed)
      }

      // Gap between messages
      elapsed += 800 + Math.random() * 500
    })

    // Finished
    addTimer(() => {
      setActivePhase(phases.length)
      setIsFinished(true)
    }, elapsed + 800)

    return elapsed + 800
  }, [clearTimers, addTimer])

  // Play from a specific phase — show prior messages instantly, animate from startPhase
  const playFromPhase = useCallback((startPhase: number) => {
    clearTimers()
    setShowTyping(false)
    setIsFinished(false)

    // Instantly show all messages before startPhase
    const priorMessages = script.filter((m) => m.phase < startPhase)
    setMessages(priorMessages)
    setActivePhase(startPhase)

    // Animate remaining messages
    const remaining = script.filter((m) => m.phase >= startPhase)
    let elapsed = 500

    remaining.forEach((msg, i) => {
      const prevMsg = i > 0 ? remaining[i - 1] : null
      const phaseChanged = prevMsg && msg.phase !== prevMsg.phase

      if (phaseChanged) elapsed += 1500
      if (prevMsg?.pauseAfter) elapsed += prevMsg.pauseAfter

      if (msg.role === 'bot') {
        const typingStart = elapsed
        addTimer(() => {
          setShowTyping(true)
          setActivePhase(msg.phase)
        }, typingStart)

        const typingDuration = 1200 + Math.random() * 800
        elapsed += typingDuration
        addTimer(() => {
          setShowTyping(false)
          setMessages((prev) => [...prev, msg])
        }, elapsed)
      } else {
        elapsed += 1400 + Math.random() * 600
        addTimer(() => {
          setActivePhase(msg.phase)
          setMessages((prev) => [...prev, msg])
        }, elapsed)
      }

      elapsed += 800 + Math.random() * 500
    })

    addTimer(() => {
      setActivePhase(phases.length)
      setIsFinished(true)
    }, elapsed + 800)
  }, [clearTimers, addTimer])

  // Play when visible, stop when not, auto-replay 4s after finish
  useEffect(() => {
    if (isVisible) {
      play()
    } else {
      clearTimers()
      setMessages([])
      setActivePhase(0)
      setShowTyping(false)
      setIsFinished(false)
    }
    return () => clearTimers()
  }, [isVisible, play, clearTimers])

  // Auto-replay 4s after finished (only while visible)
  useEffect(() => {
    if (!isFinished || !isVisible) return
    const id = setTimeout(() => play(), 4000)
    return () => clearTimeout(id)
  }, [isFinished, isVisible, play])

  return (
    <section ref={sectionRef} className="w-full bg-[#0a0e1a] py-20 px-4" style={{ overflowAnchor: 'none' }}>
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h3
            className="text-3xl font-bold text-white mb-3 transition-all duration-700"
            style={{
              opacity: isVisible ? 1 : 0,
              transform: isVisible ? 'translateY(0)' : 'translateY(20px)',
            }}
          >
            How Pactum Works
          </h3>
          <p
            className="text-gray-400 transition-all duration-700"
            style={{
              opacity: isVisible ? 1 : 0,
              transform: isVisible ? 'translateY(0)' : 'translateY(15px)',
              transitionDelay: '100ms',
            }}
          >
            A buyer&apos;s journey — from onboarding to settlement, automated by AI
          </p>
        </div>

        {/* Main layout */}
        <div className="flex gap-8 justify-center items-start">
          {/* Timeline — hidden on mobile, left side */}
          <div className="hidden md:block w-72 flex-shrink-0 pt-4">
            <div
              className="rounded-xl p-4"
              style={{
                backgroundColor: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
              }}
            >
              <p className="text-sm text-gray-500 uppercase tracking-wider mb-4 font-medium">
                Flow
              </p>
              {phases.map((phase, i) => (
                <TimelineStep
                  key={i}
                  phase={phase}
                  index={i}
                  activePhase={activePhase}
                  onClick={() => playFromPhase(i)}
                />
              ))}
            </div>

            {/* Live stats below timeline */}
            {stats && (
              <div className="mt-4 px-3 space-y-2.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Agents</span>
                  <span className="text-gray-300">{stats.sellers}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Items</span>
                  <span className="text-gray-300">{stats.items}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Orders</span>
                  <span className="text-gray-300">{stats.orders}</span>
                </div>
              </div>
            )}
          </div>

          {/* Phone mockup */}
          <div
            className="w-full max-w-md flex-shrink-0 rounded-2xl overflow-hidden"
            style={{
              backgroundColor: '#0e1621',
              border: '1px solid #1c2836',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.4)',
            }}
          >
            {/* TG header bar */}
            <div
              className="flex items-center gap-3 px-4 py-3.5"
              style={{
                backgroundColor: '#17212b',
                borderBottom: '1px solid #1c2836',
              }}
            >
              <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-base">
                🐾
              </div>
              <div>
                <p className="text-base font-medium text-white">Dario</p>
                <p className="text-xs text-green-400">online</p>
              </div>
            </div>

            {/* Chat area */}
            <div
              ref={chatContainerRef}
              className="px-3 py-4 overflow-y-auto"
              style={{
                height: '480px',
                backgroundColor: '#0e1621',
                overflowAnchor: 'none',
              }}
            >
              {messages.map((msg, i) => (
                <ChatBubble key={i} msg={msg} />
              ))}
              {showTyping && <TypingIndicator />}
            </div>
          </div>
        </div>

        {/* Replay button — always rendered to avoid layout shift */}
        <div className="text-center mt-8" style={{ visibility: isFinished ? 'visible' : 'hidden' }}>
          <button
            onClick={play}
            className="text-base text-gray-400 hover:text-white transition-colors duration-200 px-5 py-2.5 rounded-lg hover:bg-white/5"
          >
            ↻ Replay
          </button>
        </div>
      </div>

      <style jsx>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes typingBounce {
          0%, 60%, 100% {
            transform: translateY(0);
          }
          30% {
            transform: translateY(-4px);
          }
        }
        :global(.animate-fadeInUp) {
          animation: fadeInUp 0.35s ease-out both;
        }
        :global(.animate-typingBounce) {
          animation: typingBounce 1.2s ease-in-out infinite;
        }
      `}</style>
    </section>
  )
}
