import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/ratelimiter'

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
  const rl = rateLimit(`ai-context:${ip}`, 30, 60_000)  // 30 req/min per IP
  if (!rl.allowed) {
    return NextResponse.json({ context: null, error: 'Rate limit exceeded' }, { status: 429 })
  }

  try {
    const body = await request.json()
    const headline  = typeof body.headline  === 'string' ? body.headline.slice(0, 300)  : ''
    const summary   = typeof body.summary   === 'string' ? body.summary.slice(0, 500)   : ''
    const watchlist = Array.isArray(body.watchlist)
      ? (body.watchlist as unknown[]).filter((s): s is string => typeof s === 'string').slice(0, 20)
      : []

    const prompt = `You are a concise trading analyst. Given this financial news headline and the trader's watchlist, explain in ONE sentence (max 20 words) what this means for their positions. Be direct and specific.

Headline: ${headline}
Summary: ${summary?.slice(0, 200) || ''}
Trader's watchlist: ${watchlist?.join(', ') || 'SPY, QQQ'}

Respond with ONLY the one-sentence insight. No preamble.`

    // Try Groq first
    if (process.env.GROQ_API_KEY) try {
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama3-8b-8192',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 60,
          temperature: 0.3,
        }),
      })

      if (groqRes.ok) {
        const data = await groqRes.json()
        const context = data.choices?.[0]?.message?.content?.trim()
        if (context) return NextResponse.json({ context })
      }
    } catch {}

    // Fallback: Gemini
    if (process.env.GEMINI_API_KEY) try {
      const gemRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 60, temperature: 0.3 },
          }),
        }
      )
      if (gemRes.ok) {
        const data = await gemRes.json()
        const context = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
        if (context) return NextResponse.json({ context })
      }
    } catch {}

    // Both failed — return null silently
    return NextResponse.json({ context: null })
  } catch {
    return NextResponse.json({ context: null })
  }
}

export async function GET() {
  return NextResponse.json({ message: 'Use POST' })
}