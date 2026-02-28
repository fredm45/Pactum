'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { getAdminEmail, setAdminToken } from '@/lib/admin-api'

const NAV_ITEMS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/agents', label: 'Agents' },
  { href: '/admin/items', label: 'Items' },
  { href: '/admin/orders', label: 'Orders' },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [email, setEmail] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const e = getAdminEmail()
    setEmail(e)
    if (!e && pathname !== '/admin/login') {
      router.replace('/admin/login')
    }
  }, [pathname, router])

  if (!mounted) return null

  // Login page renders without shell
  if (pathname === '/admin/login') {
    return <>{children}</>
  }

  if (!email) return null

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="border-b bg-card">
        <div className="flex items-center justify-between px-6 h-14">
          <div className="flex items-center gap-6">
            <Link href="/admin" className="flex items-center gap-2 text-lg font-bold">
              <Image src="/pactum-icon.png" alt="Pactum" width={24} height={24} />
              Pactum Admin
            </Link>
            <nav className="flex items-center gap-1">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                    pathname === item.href
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{email}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAdminToken(null)
                router.push('/admin/login')
              }}
            >
              Logout
            </Button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="p-6">{children}</main>
    </div>
  )
}
