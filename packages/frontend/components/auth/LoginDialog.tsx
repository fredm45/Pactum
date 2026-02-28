'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { api, setSessionToken } from '@/lib/api'

interface LoginDialogProps {
  open: boolean
  onClose: () => void
  onLogin: (wallet: string) => void
}

export function LoginDialog({ open, onClose, onLogin }: LoginDialogProps) {
  const [jwt, setJwt] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (!open) return null

  async function handleSubmit() {
    const token = jwt.trim()
    if (!token) return
    setError('')
    setLoading(true)
    try {
      const result = await api.verifyToken(token)
      if (result.valid) {
        setSessionToken(token)
        onLogin(result.wallet)
        onClose()
        setJwt('')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-background border rounded-lg shadow-lg p-6 w-full max-w-md mx-4 space-y-4">
        <h2 className="text-lg font-semibold">Login with Agent JWT</h2>
        <p className="text-sm text-muted-foreground">
          Ask your Agent for its JWT token and paste it here to view orders.
        </p>
        <textarea
          className="w-full h-24 p-3 border rounded-md bg-muted text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="eyJhbGciOi..."
          value={jwt}
          onChange={(e) => setJwt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSubmit()
            }
          }}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-between items-center">
          <a
            href="https://t.me/Pactum_Market_Bot"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:underline"
          >
            Want push notifications? Use @Pactum_Market_Bot
          </a>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={loading || !jwt.trim()}>
              {loading ? 'Verifying...' : 'Login'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
