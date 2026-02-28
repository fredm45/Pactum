'use client'

import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AddressForm } from '@/components/address/AddressForm'
import Link from 'next/link'
import { use, useState, useEffect } from 'react'
import { api, getSessionToken, getWalletFromToken } from '@/lib/api'
import type { Item, ShippingAddress } from '@/lib/api'

export default function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [item, setItem] = useState<Item | null>(null)
  const [loading, setLoading] = useState(true)
  const [purchasing, setPurchasing] = useState(false)
  const [savedAddress, setSavedAddress] = useState<ShippingAddress | null>(null)
  const [showAddressForm, setShowAddressForm] = useState(false)
  const [addressLoading, setAddressLoading] = useState(false)
  const [error, setError] = useState('')
  const [purchaseResult, setPurchaseResult] = useState<Record<string, unknown> | null>(null)

  const wallet = getWalletFromToken()
  const isLoggedIn = !!getSessionToken() && !!wallet

  // Load item details
  useEffect(() => {
    api.getItem(id)
      .then(setItem)
      .catch(() => setError('Failed to load item'))
      .finally(() => setLoading(false))
  }, [id])

  // Load saved address if logged in and item requires shipping
  useEffect(() => {
    if (isLoggedIn && item?.requires_shipping) {
      setAddressLoading(true)
      api.getAddress()
        .then((res) => setSavedAddress(res.address))
        .catch(() => {})
        .finally(() => setAddressLoading(false))
    }
  }, [isLoggedIn, item?.requires_shipping])

  const handleBuy = async () => {
    if (!isLoggedIn) {
      setError('Please connect wallet and authenticate first.')
      return
    }

    // Check address for shipping-required items
    if (item?.requires_shipping && !savedAddress) {
      setShowAddressForm(true)
      return
    }

    setPurchasing(true)
    setError('')
    try {
      const result = await api.buyItem(
        id,
        undefined,
        item?.requires_shipping && savedAddress ? savedAddress : undefined,
      )
      setPurchaseResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Purchase failed')
    } finally {
      setPurchasing(false)
    }
  }

  const handleAddressSaved = (address: ShippingAddress) => {
    setSavedAddress(address)
    setShowAddressForm(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-4xl mx-auto">
            <Card className="animate-pulse">
              <CardHeader><div className="h-8 bg-muted rounded w-1/2" /></CardHeader>
              <CardContent><div className="h-24 bg-muted rounded" /></CardContent>
            </Card>
          </div>
        </main>
      </div>
    )
  }

  if (!item) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-4xl mx-auto text-center">
            <p className="text-muted-foreground">Item not found.</p>
            <Link href="/marketplace"><Button variant="outline" className="mt-4">Back to Marketplace</Button></Link>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Item info */}
          <Card>
            <CardHeader>
              <div className="flex justify-between items-start">
                <CardTitle className="text-3xl">{item.name}</CardTitle>
                <div className="flex gap-2">
                  <Badge variant="secondary">{item.type}</Badge>
                  {item.requires_shipping && (
                    <Badge variant="outline">Requires Shipping Address</Badge>
                  )}
                </div>
              </div>
              <CardDescription>
                Seller: {item.seller_wallet.slice(0, 6)}...{item.seller_wallet.slice(-4)}
                {item.agents && ` · ${item.agents.avg_rating?.toFixed(1) ?? '0.0'} rating`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">{item.description}</p>
              <p className="text-2xl font-bold">${item.price} USDC</p>
            </CardContent>
          </Card>

          {/* Address section (only for requires_shipping) */}
          {item.requires_shipping && isLoggedIn && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Shipping Address</CardTitle>
                <CardDescription>
                  This item requires a shipping address for delivery.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {addressLoading ? (
                  <p className="text-sm text-muted-foreground">Loading address...</p>
                ) : showAddressForm ? (
                  <AddressForm
                    initialAddress={savedAddress}
                    onSave={handleAddressSaved}
                    onCancel={() => setShowAddressForm(false)}
                  />
                ) : savedAddress ? (
                  <div className="space-y-2">
                    <div className="bg-muted p-3 rounded text-sm">
                      <p className="font-medium">{savedAddress.name}</p>
                      <p>{savedAddress.street}</p>
                      <p>{savedAddress.city}, {savedAddress.state} {savedAddress.postal_code}</p>
                      <p>{savedAddress.country}</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setShowAddressForm(true)}>
                      Edit Address
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      No shipping address on file. You need to add one before purchasing.
                    </p>
                    <Button variant="outline" size="sm" onClick={() => setShowAddressForm(true)}>
                      Add Address
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Purchase section */}
          <Card>
            <CardHeader>
              <CardTitle>Purchase</CardTitle>
              <CardDescription>
                The marketplace uses a 402 payment flow: you'll receive payment instructions, send USDC via escrow, then confirm.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {purchaseResult ? (
                <div className="bg-green-500/10 border border-green-500 text-green-700 dark:text-green-400 px-4 py-3 rounded">
                  <p className="font-medium">Order created!</p>
                  <pre className="mt-2 text-xs overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(purchaseResult, null, 2)}
                  </pre>
                </div>
              ) : (
                <>
                  {error && (
                    <div className="bg-destructive/10 border border-destructive text-destructive px-4 py-3 rounded text-sm">
                      {error}
                    </div>
                  )}
                  <Button
                    onClick={handleBuy}
                    disabled={purchasing || (item.requires_shipping && !savedAddress && !showAddressForm)}
                    className="w-full"
                  >
                    {purchasing
                      ? 'Processing...'
                      : item.requires_shipping && !savedAddress
                        ? 'Add Address to Purchase'
                        : `Buy for $${item.price} USDC`}
                  </Button>
                  {!isLoggedIn && (
                    <p className="text-sm text-muted-foreground text-center">
                      Connect wallet and authenticate to purchase.
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <div className="flex gap-4">
            <Link href="/marketplace">
              <Button variant="outline">Back to Marketplace</Button>
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
