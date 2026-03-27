import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { headline, summary, watchlist } = await request.json()

    const prompt = `You are a concise trading analyst. Given this financial news headline and the trader's watchlist, explain in ONE sentence (max 20 words) what this means for their positions. Be direct and specific.

Headline: ${headline}
Summary: ${summary?.slice(0, 200) || ''}
Trader's watchlist: ${watchlist?.join(', ') || 'SPY, QQQ'}

Respond with ONLY the one-sentence insight. No preamble.`

    // Try Groq first
    try {
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
    try {
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