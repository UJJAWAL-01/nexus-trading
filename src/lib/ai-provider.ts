// src/lib/ai-provider.ts
/*
  AI PROVIDER ABSTRACTION
  ========================
  Priority 1: Grok (xAI) — FREE tier at api.x.ai, OpenAI-compatible
  Priority 2: Claude (Anthropic) — paid, best quality, easy swap when funded
  Priority 3: Gemini Flash — Google free tier fallback

  HOW TO GET YOUR FREE GROK KEY:
  1. Go to console.x.ai
  2. Sign in with X (Twitter) account
  3. Create API key → copy to GROK_API_KEY in .env.local
  Free tier: ~$25/month of credits monthly, resets each month (as of 2025)

  TO UPGRADE TO CLAUDE LATER:
  - Add ANTHROPIC_API_KEY to .env.local
  - The system automatically upgrades — no code changes needed

  ENV VARS:
  GROK_API_KEY=xai-...          ← primary (free)
  ANTHROPIC_API_KEY=sk-ant-...  ← future paid upgrade
  GEMINI_API_KEY=AIza...        ← tertiary fallback
*/

export interface AIMessage {
  role:    'user' | 'assistant' | 'system'
  content: string
}

export interface AIResponse {
  text:     string
  provider: 'grok' | 'claude' | 'gemini' | 'none'
  model:    string
}

// ── Grok (xAI) ────────────────────────────────────────────────────────────────
// OpenAI-compatible API, free tier available at console.x.ai
async function callGrok(messages: AIMessage[], maxTokens = 1500): Promise<string | null> {
  if (!process.env.GROK_API_KEY) return null

  try {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.GROK_API_KEY}`,
      },
      body: JSON.stringify({
        model:       'grok-3-mini',   // fastest, cheapest, free tier
        messages,
        max_tokens:  maxTokens,
        temperature: 0.2,             // low temp for factual analysis
      }),
      signal: AbortSignal.timeout(25_000),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error(`[AI] Grok ${res.status}:`, err.slice(0, 200))
      return null
    }

    const data = await res.json()
    return data.choices?.[0]?.message?.content?.trim() ?? null
  } catch (err) {
    console.error('[AI] Grok error:', err)
    return null
  }
}

// ── Claude (Anthropic) ────────────────────────────────────────────────────────
// Paid — best quality. Auto-activates when ANTHROPIC_API_KEY is set.
async function callClaude(messages: AIMessage[], maxTokens = 1500): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null

  // Convert messages to Claude format (system messages go to system param)
  const systemMsg = messages.find(m => m.role === 'system')?.content
  const chatMsgs  = messages.filter(m => m.role !== 'system')

  try {
    const body: Record<string, unknown> = {
      model:      'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      messages:   chatMsgs,
    }
    if (systemMsg) body.system = systemMsg

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(30_000),
    })

    if (!res.ok) {
      console.error(`[AI] Claude ${res.status}`)
      return null
    }

    const data = await res.json()
    return data.content?.[0]?.text?.trim() ?? null
  } catch (err) {
    console.error('[AI] Claude error:', err)
    return null
  }
}

// ── Gemini Flash (Google) ─────────────────────────────────────────────────────
// Free tier: 15 RPM, 1M tokens/day (generous)
// Get key: aistudio.google.com
async function callGemini(messages: AIMessage[], maxTokens = 1500): Promise<string | null> {
  if (!process.env.GEMINI_API_KEY) return null

  try {
    // Convert to Gemini format
    const contents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role:  m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }))

    const systemInstruction = messages.find(m => m.role === 'system')?.content

    const body: Record<string, unknown> = {
      contents,
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2 },
    }
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] }
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        signal:  AbortSignal.timeout(20_000),
      }
    )

    if (!res.ok) {
      console.error(`[AI] Gemini ${res.status}`)
      return null
    }

    const data = await res.json()
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null
  } catch (err) {
    console.error('[AI] Gemini error:', err)
    return null
  }
}

// ── Main exported function ────────────────────────────────────────────────────
// Tries providers in priority order. Returns first successful response.
export async function callAI(
  messages:  AIMessage[],
  maxTokens: number = 1500,
): Promise<AIResponse> {
  // Priority 1: Grok (free)
  const grokText = await callGrok(messages, maxTokens)
  if (grokText) {
    return { text: grokText, provider: 'grok', model: 'grok-3-mini' }
  }

  // Priority 2: Claude (paid, upgrade when funded)
  const claudeText = await callClaude(messages, maxTokens)
  if (claudeText) {
    return { text: claudeText, provider: 'claude', model: 'claude-sonnet-4-20250514' }
  }

  // Priority 3: Gemini Flash (free tier)
  const geminiText = await callGemini(messages, maxTokens)
  if (geminiText) {
    return { text: geminiText, provider: 'gemini', model: 'gemini-2.0-flash' }
  }

  return { text: '', provider: 'none', model: 'none' }
}

// Convenience: parse JSON from AI response (strips markdown fences)
export function parseAIJson<T>(text: string): T | null {
  try {
    const clean = text
      .replace(/^```json\s*/im, '')
      .replace(/^```\s*/im, '')
      .replace(/```\s*$/im, '')
      .trim()
    return JSON.parse(clean) as T
  } catch {
    // Try to extract JSON object/array from messy response
    const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[0]) as T } catch {}
    }
    return null
  }
}