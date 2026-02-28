'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { adminApi } from '@/lib/admin-api'

export default function AdminLoginPage() {
  const router = useRouter()
  const [step, setStep] = useState<'email' | 'verify'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSendCode() {
    setError('')
    setLoading(true)
    try {
      await adminApi.sendCode(email)
      setStep('verify')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send code')
    } finally {
      setLoading(false)
    }
  }

  async function handleLogin() {
    setError('')
    setLoading(true)
    try {
      await adminApi.login(email, code, password)
      router.push('/admin')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl text-center">Pactum Admin</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 'email' ? (
            <>
              <Input
                type="email"
                placeholder="Admin email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && email && handleSendCode()}
              />
              <Button
                className="w-full"
                onClick={handleSendCode}
                disabled={!email || loading}
              >
                {loading ? 'Sending...' : 'Send Verification Code'}
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground text-center">
                Code sent to <strong>{email}</strong>
              </p>
              <Input
                type="text"
                placeholder="6-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={6}
              />
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && code && password && handleLogin()}
              />
              <Button
                className="w-full"
                onClick={handleLogin}
                disabled={!code || !password || loading}
              >
                {loading ? 'Logging in...' : 'Login'}
              </Button>
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => { setStep('email'); setCode(''); setPassword('') }}
              >
                Back
              </Button>
            </>
          )}
          {error && <p className="text-destructive text-sm text-center">{error}</p>}
        </CardContent>
      </Card>
    </div>
  )
}
