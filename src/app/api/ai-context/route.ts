import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/ratelimiter'
import { clientIp } from '@/lib/api-guard'
import { groq, hasKey } from '@/lib/providers/keys'
import { GROQ_MODEL } from '@/lib/ai-provider'

// One-line AI context for a news headline.
//
// Optional. Uses only Groq's free tier (no payment method, cannot bill). With
// no GROQ_API_KEY this returns { context: null } and the feed shows no AI line.
// Keys are attached by lib/providers/keys.ts and never appear in a URL.

// Strip anything that could break out of the prompt's data section.
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()

export async function POST(request: NextRequest) {
  const ip = clientIp(request.headers)
  const rl = rateLimit(`ai-context:${ip}`, 30, 60_000)  // 30 req/min per IP
  if (!rl.allowed) {
    return NextResponse.json({ context: null, error: 'Rate limit exceeded' }, { status: 429 })
  }

  try {
    const body = await request.json()
    const headline  = typeof body.headline  === 'string' ? clean(body.headline).slice(0, 300) : ''
    const summary   = typeof body.summary   === 'string' ? clean(body.summary).slice(0, 200)  : ''
    const watchlist = Array.isArray(body.watchlist)
      ? (body.watchlist as unknown[])
          .filter((s): s is string => typeof s === 'string' && /^[A-Za-z0-9^.\-=&]{1,20}$/.test(s))
          .slice(0, 20)
      : []

    if (!headline) return NextResponse.json({ context: null })

    const prompt = `You are a concise trading analyst. Given this financial news headline and the trader's watchlist, explain in ONE sentence (max 20 words) what this means for their positions. Be direct and specific.

Headline: ${headline}
Summary: ${summary}
Trader's watchlist: ${watchlist.join(', ') || 'SPY, QQQ'}

Respond with ONLY the one-sentence insight. No preamble.`

    if (hasKey('groq')) try {
      const res = await groq({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        // Reasoning models spend output tokens thinking before they answer.
        max_tokens: 300,
        temperature: 0.3,
        ...(GROQ_MODEL.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
      })
      if (res.ok) {
        const data = await res.json()
        const context = data.choices?.[0]?.message?.content?.trim()
        if (context) return NextResponse.json({ context: context.slice(0, 240) })
      }
    } catch {}

    // No AI configured or it failed: the feed simply shows no AI line.
    return NextResponse.json({ context: null })
  } catch {
    return NextResponse.json({ context: null })
  }
}

export async function GET() {
  return NextResponse.json({ message: 'Use POST' })
}
