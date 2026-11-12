// src/lib/ai-provider.ts
/*
  AI PROVIDER — ZERO COST BY CONSTRUCTION
  =======================================
  NEXUS must never spend money on AI. The rules:

    1. AI is OPTIONAL. Every feature that can use AI has a deterministic,
       rule-based result that is produced when no AI is available. The app is
       fully functional with no AI key at all.
    2. The only AI provider is Groq's free tier (GROQ_API_KEY), which requires
       no payment method and stops serving at its limits instead of billing.
    3. Pay-per-use providers (Anthropic, OpenAI, xAI, Google Gemini…) are not
       supported and must not be added. A CI test (zero-cost.test.ts) fails if
       one appears in the key vault or the host allowlist.

  callAI() returns { provider: 'none' } when Groq is not configured or fails;
  callers must treat that as the normal case and fall back to their rules.
*/

import { groq, hasKey } from './providers/keys'
import { redact } from './providers/http'

export interface AIMessage {
  role:    'user' | 'assistant' | 'system'
  content: string
}

export interface AIResponse {
  text:     string
  provider: 'groq' | 'none'
  model:    string
}

// Groq retires models regularly; override with GROQ_MODEL without a code change.
export const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b'

/** Extra tokens so reasoning models can think before they answer. */
const REASONING_HEADROOM = 400

export async function callAI(messages: AIMessage[], maxTokens: number = 1500): Promise<AIResponse> {
  if (!hasKey('groq')) return { text: '', provider: 'none', model: 'none' }

  const reasoning = GROQ_MODEL.startsWith('openai/gpt-oss')
  try {
    const res = await groq({
      model:       GROQ_MODEL,
      messages,
      max_tokens:  maxTokens + (reasoning ? REASONING_HEADROOM : 0),
      temperature: 0.2,
      ...(reasoning ? { reasoning_effort: 'low' } : {}),
    }, { timeoutMs: 25_000 })

    if (!res.ok) {
      console.error(`[AI] Groq ${res.status}:`, redact((await res.text()).slice(0, 200)))
      return { text: '', provider: 'none', model: 'none' }
    }
    const data = await res.json()
    const text = data.choices?.[0]?.message?.content?.trim() ?? ''
    return text ? { text, provider: 'groq', model: GROQ_MODEL } : { text: '', provider: 'none', model: 'none' }
  } catch (err) {
    console.error('[AI] Groq error:', redact(err))
    return { text: '', provider: 'none', model: 'none' }
  }
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
