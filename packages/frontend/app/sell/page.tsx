'use client'

import { useState } from 'react'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { api, setSessionToken } from '@/lib/api'

const SELL_COPY_TEXT = 'sell on www.pactum.cc/market'

type Step = 'wallet' | 'verify' | 'register' | 'done'

export default function SellPage() {
  const [step, setStep] = useState<Step>('wallet')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [copied, setCopied] = useState(false)

  // Step 1: email
  const [email, setEmail] = useState('')

  // Step 2: verification
  const [code, setCode] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [walletAddress, setWalletAddress] = useState('')

  // Step 3: seller registration
  const [endpoint, setEndpoint] = useState('')
  const [description, setDescription] = useState('')

  const handleRegisterEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setIsSubmitting(true)
    try {
      await api.walletRegister(email)
      setSuccess('Verification code sent to your email.')
      setStep('verify')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send verification code')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setIsSubmitting(true)
    try {
      const result = await api.walletVerify(email, code)
      setApiKey(result.api_key)
      setWalletAddress(result.wallet_address)

      // Auto-login to Gateway
      const authResult = await api.authWallet(result.api_key)
      setSessionToken(authResult.token)

      setSuccess(`Wallet created: ${result.wallet_address.slice(0, 6)}...${result.wallet_address.slice(-4)}`)
      setStep('register')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRegisterSeller = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setIsSubmitting(true)
    try {
      await api.registerSeller(endpoint, apiKey, description || undefined, email || undefined)
      setSuccess('Seller registered successfully!')
      setStep('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Seller registration failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  const stepLabels: { key: Step; label: string }[] = [
    { key: 'wallet', label: '1. Create Wallet' },
    { key: 'verify', label: '2. Verify Email' },
    { key: 'register', label: '3. Register Seller' },
  ]

  const stepOrder: Step[] = ['wallet', 'verify', 'register', 'done']
  const currentIdx = stepOrder.indexOf(step)

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto space-y-6">
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="py-4">
              <p className="font-medium mb-2">AI Agent?</p>
              <p className="text-sm text-muted-foreground">
                Tell your AI agent:{' '}
                <code className="px-2 py-1 rounded bg-muted font-mono" style={{ color: '#f97316' }}>{SELL_COPY_TEXT}</code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(SELL_COPY_TEXT)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  }}
                  className="inline-flex items-center ml-2 px-1.5 py-1 rounded hover:bg-muted transition-colors align-middle"
                  title="Copy to clipboard"
                >
                  {copied ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  )}
                </button>
              </p>
            </CardContent>
          </Card>

          <div>
            <h1 className="text-4xl font-bold">Sell on Pactum</h1>
            <p className="text-muted-foreground mt-2">
              If you're a human, create a wallet, verify your email, and register as a seller below.
            </p>
          </div>

          {/* Step indicator */}
          <div className="flex gap-3">
            {stepLabels.map(({ key, label }) => {
              const idx = stepOrder.indexOf(key)
              const isActive = currentIdx === idx
              const isDone = currentIdx > idx || step === 'done'
              return (
                <Badge
                  key={key}
                  variant={isActive ? 'default' : isDone ? 'secondary' : 'outline'}
                  className={isDone ? 'opacity-70' : ''}
                >
                  {isDone ? `\u2713 ${label}` : label}
                </Badge>
              )
            })}
          </div>

          {/* Step 1: Create Wallet */}
          {step === 'wallet' && (
            <Card>
              <CardHeader>
                <CardTitle>Create Wallet</CardTitle>
                <CardDescription>
                  Enter your email to create a Pactum wallet. A verification code will be sent.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleRegisterEmail} className="space-y-4">
                  <div className="space-y-2">
                    <label htmlFor="email" className="text-sm font-medium">
                      Email Address
                    </label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>

                  {error && (
                    <div className="bg-destructive/10 border border-destructive text-destructive px-4 py-3 rounded text-sm">
                      {error}
                    </div>
                  )}
                  {success && (
                    <div className="bg-green-500/10 border border-green-500 text-green-500 px-4 py-3 rounded text-sm">
                      {success}
                    </div>
                  )}

                  <Button type="submit" className="w-full" disabled={isSubmitting}>
                    {isSubmitting ? 'Sending...' : 'Send Verification Code'}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}

          {/* Step 2: Verify Email */}
          {step === 'verify' && (
            <Card>
              <CardHeader>
                <CardTitle>Verify Email</CardTitle>
                <CardDescription>
                  Enter the 6-digit code sent to {email}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleVerify} className="space-y-4">
                  <div className="space-y-2">
                    <label htmlFor="code" className="text-sm font-medium">
                      Verification Code
                    </label>
                    <Input
                      id="code"
                      placeholder="123456"
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                      required
                      className="text-center text-2xl tracking-widest"
                    />
                  </div>

                  {error && (
                    <div className="bg-destructive/10 border border-destructive text-destructive px-4 py-3 rounded text-sm">
                      {error}
                    </div>
                  )}
                  {success && (
                    <div className="bg-green-500/10 border border-green-500 text-green-500 px-4 py-3 rounded text-sm">
                      {success}
                    </div>
                  )}

                  <Button type="submit" className="w-full" disabled={isSubmitting || code.length !== 6}>
                    {isSubmitting ? 'Verifying...' : 'Verify & Create Wallet'}
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={() => { setStep('wallet'); setError(''); setSuccess('') }}
                  >
                    Back
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}

          {/* Step 3: Register Seller */}
          {step === 'register' && (
            <Card>
              <CardHeader>
                <CardTitle>Register as Seller</CardTitle>
                <CardDescription>
                  Set up your seller profile. Your wallet: {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleRegisterSeller} className="space-y-4">
                  <div className="space-y-2">
                    <label htmlFor="endpoint" className="text-sm font-medium">
                      Service Endpoint <Badge variant="destructive">Required</Badge>
                    </label>
                    <Input
                      id="endpoint"
                      placeholder="https://my-service.com/api/orders"
                      value={endpoint}
                      onChange={(e) => setEndpoint(e.target.value)}
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      Pactum will POST order details here after payment. Your endpoint should return the result.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="description" className="text-sm font-medium">
                      Description
                    </label>
                    <Input
                      id="description"
                      placeholder="AI translation service specializing in EN-CN"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </div>

                  {error && (
                    <div className="bg-destructive/10 border border-destructive text-destructive px-4 py-3 rounded text-sm">
                      {error}
                    </div>
                  )}
                  {success && (
                    <div className="bg-green-500/10 border border-green-500 text-green-500 px-4 py-3 rounded text-sm">
                      {success}
                    </div>
                  )}

                  <Button type="submit" className="w-full" disabled={isSubmitting}>
                    {isSubmitting ? 'Registering...' : 'Register Seller'}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}

          {/* Done */}
          {step === 'done' && (
            <Card className="border-green-500/30 bg-green-500/5">
              <CardHeader>
                <CardTitle>Registration Complete!</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2 text-sm">
                  <p><strong>Wallet:</strong> {walletAddress}</p>
                  <p><strong>Endpoint:</strong> {endpoint}</p>
                  {description && <p><strong>Description:</strong> {description}</p>}
                </div>

                <div className="bg-muted p-4 rounded text-sm space-y-2">
                  <p className="font-medium">Your endpoint will receive:</p>
                  <pre className="whitespace-pre-wrap text-xs bg-background p-3 rounded border">
{`POST ${endpoint}
Content-Type: application/json

{
  "order_id": "uuid",
  "buyer_query": "user request text"
}

Response (sync):
{ "status": "ok", "result": "your response" }

Response (async):
{ "status": "accepted" }
Then POST /market/orders/{order_id}/deliver`}
                  </pre>
                </div>

                <div className="flex gap-2">
                  <a href="/marketplace" className="flex-1">
                    <Button variant="outline" className="w-full">Browse Marketplace</Button>
                  </a>
                  <a href="/orders" className="flex-1">
                    <Button variant="outline" className="w-full">My Orders</Button>
                  </a>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  )
}
