'use client'
// src/components/dashboard/PriceAlertEngine.tsx
// Watches live quotes for every symbol that has an armed price alert and fires
// the alert as an in-app toast plus (if the user allowed it) a desktop
// notification. Renders nothing. Rules live in this browser only.
//
// Cost: reuses the app's single shared quote stream. No new upstream, no key.

import { useEffect, useMemo } from 'react'
import { useAlertQuotes, usePriceAlerts } from '@/store/priceAlerts'
import { useAlerts } from '@/store/alerts'
import { useQuoteStream } from '@/lib/useQuoteStream'
import { describeFired, evaluateRules } from '@/lib/price-alerts'

function notify(title: string, body: string, tag: string) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    new Notification(title, { body, tag })
  } catch { /* some browsers only allow notifications from a service worker */ }
}

export default function PriceAlertEngine() {
  const rules = usePriceAlerts(s => s.rules)

  // One stream for every symbol that has a rule (none = no connection at all).
  const symbols = useMemo(() => Array.from(new Set(rules.map(r => r.symbol))).sort(), [rules])
  const { quotes, status } = useQuoteStream(symbols)

  useEffect(() => { useAlertQuotes.setState({ quotes, status }) }, [quotes, status])

  useEffect(() => {
    const store = usePriceAlerts.getState()
    const result = evaluateRules(store.rules, quotes)
    if (result.rules === store.rules) return
    store.commit(result.rules, result.fired)
    for (const f of result.fired) {
      const { title, body } = describeFired(f)
      useAlerts.getState().push({
        id: `price:${f.ruleId}:${f.at}`, title, body, source: 'PRICE ALERT', symbol: f.symbol,
        level: f.kind === 'above' || f.kind === 'pct-up' ? 'positive' : 'warn',
      })
      notify(`NEXUS · ${title}`, body, `nexus-price-${f.ruleId}`)
    }
  }, [quotes])

  return null
}
