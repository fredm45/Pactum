'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { LoginDialog } from '@/components/auth/LoginDialog'
import { getWalletFromToken, setSessionToken } from '@/lib/api'

export function Header() {
  const [wallet, setWallet] = useState<string | null>(null)
  const [showLogin, setShowLogin] = useState(false)

  useEffect(() => {
    setWallet(getWalletFromToken())
  }, [])

  function handleLogout() {
    setSessionToken(null)
    setWallet(null)
  }

  return (
    <>
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/pactum-icon.png" alt="Pactum" width={32} height={32} />
            <h1 className="text-2xl font-bold">Pactum</h1>
          </Link>
          <nav className="flex gap-4 items-center">
            <Link href="/marketplace">
              <Button variant="ghost">Marketplace</Button>
            </Link>
            <Link href="/sell">
              <Button variant="ghost">Sell</Button>
            </Link>
            <Link href="/orders">
              <Button variant="ghost">Orders</Button>
            </Link>
            {wallet ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground font-mono">
                  {wallet.slice(0, 6)}...{wallet.slice(-4)}
                </span>
                <Button variant="outline" size="sm" onClick={handleLogout}>
                  Logout
                </Button>
              </div>
            ) : (
              <Button variant="default" size="sm" onClick={() => setShowLogin(true)}>
                Login
              </Button>
            )}
          </nav>
        </div>
      </header>
      <LoginDialog
        open={showLogin}
        onClose={() => setShowLogin(false)}
        onLogin={(w) => setWallet(w)}
      />
    </>
  )
}
