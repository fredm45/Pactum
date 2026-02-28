'use client'

import { useState, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import type { ShippingAddress } from '@/lib/api'

const COUNTRIES = [
  { code: 'US', name: 'United States' },
  { code: 'CN', name: 'China' },
  { code: 'JP', name: 'Japan' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'AU', name: 'Australia' },
  { code: 'KR', name: 'South Korea' },
  { code: 'SG', name: 'Singapore' },
]

const POSTAL_PATTERNS: Record<string, RegExp> = {
  US: /^\d{5}(-\d{4})?$/,
  CN: /^\d{6}$/,
  JP: /^\d{3}-?\d{4}$/,
  CA: /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/,
  GB: /^(GIR\s?0AA|[A-Za-z]{1,2}\d[A-Za-z\d]?\s?\d[A-Za-z]{2})$/,
}

function validatePostalCode(code: string, country: string): string | null {
  if (!code.trim()) return 'Postal code is required'
  const pattern = POSTAL_PATTERNS[country]
  if (pattern && !pattern.test(code.trim())) {
    return `Invalid postal code format for ${country}`
  }
  return null
}

interface AddressFormProps {
  initialAddress?: ShippingAddress | null
  onSave: (address: ShippingAddress) => void
  onCancel?: () => void
  loading?: boolean
}

export function AddressForm({ initialAddress, onSave, onCancel, loading }: AddressFormProps) {
  const [form, setForm] = useState<ShippingAddress>({
    name: '',
    street: '',
    city: '',
    state: '',
    postal_code: '',
    country: 'US',
  })
  const [error, setError] = useState('')
  const [postalError, setPostalError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (initialAddress) {
      setForm(initialAddress)
    }
  }, [initialAddress])

  const handlePostalChange = (value: string) => {
    setForm({ ...form, postal_code: value })
    if (value.trim()) {
      const err = validatePostalCode(value, form.country)
      setPostalError(err || '')
    } else {
      setPostalError('')
    }
  }

  const handleCountryChange = (country: string) => {
    setForm({ ...form, country })
    if (form.postal_code.trim()) {
      const err = validatePostalCode(form.postal_code, country)
      setPostalError(err || '')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Validate all fields
    for (const [key, val] of Object.entries(form)) {
      if (!val.trim()) {
        setError(`${key.replace('_', ' ')} is required`)
        return
      }
    }

    const postalErr = validatePostalCode(form.postal_code, form.country)
    if (postalErr) {
      setPostalError(postalErr)
      return
    }

    setSaving(true)
    try {
      await api.updateAddress(form)
      onSave(form)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save address')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-1">
        <label className="text-sm font-medium">Recipient Name</label>
        <Input
          placeholder="John Doe"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium">Street Address</label>
        <Input
          placeholder="123 Main St, Apt 4B"
          value={form.street}
          onChange={(e) => setForm({ ...form, street: e.target.value })}
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-sm font-medium">City</label>
          <Input
            placeholder="New York"
            value={form.city}
            onChange={(e) => setForm({ ...form, city: e.target.value })}
            required
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">State / Province</label>
          <Input
            placeholder="NY"
            value={form.state}
            onChange={(e) => setForm({ ...form, state: e.target.value })}
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-sm font-medium">Postal Code</label>
          <Input
            placeholder="10001"
            value={form.postal_code}
            onChange={(e) => handlePostalChange(e.target.value)}
            className={postalError ? 'border-destructive' : ''}
            required
          />
          {postalError && (
            <p className="text-xs text-destructive">{postalError}</p>
          )}
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Country</label>
          <select
            value={form.country}
            onChange={(e) => handleCountryChange(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive text-destructive px-3 py-2 rounded text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={saving || loading || !!postalError}>
          {saving ? 'Saving...' : 'Save Address'}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}
