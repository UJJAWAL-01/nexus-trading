import { NextRequest } from 'next/server'
import { getQuote, type Quote } from '@/lib/providers/market'
import { cleanSymbolList } from '@/lib/providers/symbols'
import { clientIp } from '@/lib/api-guard'

// GET /api/stream/quotes?symbols=AAPL,MSFT
//
// Server-Sent Events stream of quotes. The browser holds ONE connection and
// the server pushes a symbol only when its price changes, instead of every
// panel polling every symbol on its own timer.
//
// Provider cost is independent of audience size: quotes come from the shared
// provider cache, so each symbol is fetched upstream at most once per ~10s no
// matter how many viewers are connected. No API key is involved in the stream
// itself and nothing but quote data is ever written to it.
//
// Limits (all enforced here, on top of the global /api guard):
//   • MAX_SYMBOLS per connection
//   • MAX_STREAMS_PER_IP concurrent connections per client
//   • MAX_STREAMS concurrent connections per server process
//   • MAX_LIFETIME_MS per connection (EventSource reconnects automatically)

export const dynamic = 'force-dynamic'

const MAX_SYMBOLS        = 25
const TICK_MS            = 5_000
const MAX_LIFETIME_MS    = 5 * 60_000
const MAX_STREAMS_PER_IP = 4
const MAX_STREAMS        = 400

declare global {
  var __nexusStreams: { total: number; perIp: Map<string, number> } | undefined
}
const streams = (globalThis.__nexusStreams ??= { total: 0, perIp: new Map<string, number>() })

function refuse(status: number, error: string, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  })
}

export async function GET(request: NextRequest) {
  const symbols = cleanSymbolList(new URL(request.url).searchParams.get('symbols'), MAX_SYMBOLS)
  if (!symbols.length) return refuse(400, 'symbols required')

  const ip = clientIp(request.headers)
  const mine = streams.perIp.get(ip) ?? 0
  if (mine >= MAX_STREAMS_PER_IP) return refuse(429, 'Too many open streams', { 'Retry-After': '30' })
  if (streams.total >= MAX_STREAMS) return refuse(503, 'Stream capacity reached', { 'Retry-After': '30' })

  streams.total++
  streams.perIp.set(ip, mine + 1)

  const encoder = new TextEncoder()
  const last    = new Map<string, number | null>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let closed = false

  const release = () => {
    if (closed) return
    closed = true
    if (timer) clearTimeout(timer)
    streams.total = Math.max(0, streams.total - 1)
    const n = (streams.perIp.get(ip) ?? 1) - 1
    if (n <= 0) streams.perIp.delete(ip)
    else streams.perIp.set(ip, n)
  }

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const startedAt = Date.now()
      const send = (event: string, data: unknown) => {
        if (closed) return
        try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) }
        catch { release() }
      }
      const end = () => {
        if (closed) return
        release()
        try { controller.close() } catch { /* already closed */ }
      }

      request.signal.addEventListener('abort', end)

      const tick = async () => {
        if (closed) return
        if (Date.now() - startedAt > MAX_LIFETIME_MS) {
          send('bye', { reason: 'lifetime' })
          return end()
        }
        const quotes  = await Promise.all(symbols.map(s => getQuote(s)))
        const changed: Quote[] = []
        for (const q of quotes) {
          if (!q) continue
          if (last.get(q.symbol) !== q.price) { last.set(q.symbol, q.price); changed.push(q) }
        }
        if (changed.length) send('quotes', changed)
        else if (!closed) {
          // Comment line: keeps proxies from timing out an idle connection.
          try { controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`)) } catch { return release() }
        }
        if (!closed) timer = setTimeout(tick, TICK_MS)
      }

      // Tell the client how to pace reconnects, then start immediately.
      try { controller.enqueue(encoder.encode('retry: 5000\n\n')) } catch { return release() }
      void tick()
    },
    cancel() { release() },
  })

  return new Response(body, {
    headers: {
      'Content-Type':      'text/event-stream; charset=utf-8',
      'Cache-Control':     'no-cache, no-store, no-transform',
      Connection:          'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
