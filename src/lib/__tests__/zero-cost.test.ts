// ZERO-COST GUARD
// NEXUS must never be able to spend money on API usage or AI tokens. These
// tests fail the build if a pay-per-use provider is introduced anywhere in the
// application or its scripts. If one of them fails, do not "fix" the test:
// remove the provider.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { isAllowedHost } from '@/lib/providers/http'
import { callAI } from '@/lib/ai-provider'

const ROOT = path.resolve(__dirname, '../../..')

// Hosts of providers that bill per request / per token, or require a payment method.
const BILLABLE_HOSTS = [
  'api.anthropic.com',
  'api.openai.com',
  'api.x.ai',
  'generativelanguage.googleapis.com',
  'aiplatform.googleapis.com',
  'api.mistral.ai',
  'api.cohere.ai', 'api.cohere.com',
  'api.perplexity.ai',
  'api.together.xyz',
  'openrouter.ai',
  'api.deepseek.com',
  'api.replicate.com',
  'bedrock-runtime',
  'api.polygon.io',
  'api.twelvedata.com',
  'www.googleapis.com/youtube',
]

// Environment variables that would hold a paid provider's key.
const BILLABLE_ENV = [
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GROK_API_KEY', 'XAI_API_KEY',
  'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'MISTRAL_API_KEY', 'COHERE_API_KEY',
  'OPENROUTER_API_KEY', 'DEEPSEEK_API_KEY', 'POLYGON_API_KEY', 'YOUTUBE_API_KEY',
]

// Paid SDKs that must not be dependencies.
const BILLABLE_PACKAGES = [
  '@anthropic-ai/sdk', 'openai', '@google/generative-ai', '@google/genai',
  '@mistralai/mistralai', 'cohere-ai', 'replicate', '@aws-sdk/client-bedrock-runtime',
  'stripe',
]

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '__tests__') continue
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(p, out)
    else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) out.push(p)
  }
  return out
}

const files = [
  ...sourceFiles(path.join(ROOT, 'src')),
  ...sourceFiles(path.join(ROOT, 'scripts')),
  ...sourceFiles(path.join(ROOT, 'db')),
]
const rel = (p: string) => path.relative(ROOT, p).replace(/\\/g, '/')

describe('zero-cost guard', () => {
  it('scans a meaningful number of source files', () => {
    expect(files.length).toBeGreaterThan(80)
  })

  it('no source file references a billable provider host', () => {
    const hits: string[] = []
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8')
      for (const host of BILLABLE_HOSTS) if (text.includes(host)) hits.push(`${rel(file)} → ${host}`)
    }
    expect(hits).toEqual([])
  })

  it('no source file reads a billable provider key', () => {
    const hits: string[] = []
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8')
      for (const name of BILLABLE_ENV) if (text.includes(name)) hits.push(`${rel(file)} → ${name}`)
    }
    expect(hits).toEqual([])
  })

  it('the upstream host allowlist rejects every billable host', () => {
    for (const host of BILLABLE_HOSTS) expect(isAllowedHost(host.split('/')[0]), host).toBe(false)
  })

  it('package.json has no paid SDK and no database driver', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    for (const name of BILLABLE_PACKAGES) expect(deps, name).not.toContain(name)
  })

  it('.env.example offers no billable key', () => {
    const env = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8')
    for (const name of BILLABLE_ENV) expect(env.includes(name), name).toBe(false)
  })

  it('AI is optional: with no key it reports "none" and makes no request', async () => {
    const saved = process.env.GROQ_API_KEY
    delete process.env.GROQ_API_KEY
    const realFetch = globalThis.fetch
    let called = 0
    globalThis.fetch = (async () => { called++; throw new Error('network must not be used') }) as typeof fetch
    try {
      const r = await callAI([{ role: 'user', content: 'hi' }], 10)
      expect(r.provider).toBe('none')
      expect(r.text).toBe('')
      expect(called).toBe(0)
    } finally {
      globalThis.fetch = realFetch
      if (saved) process.env.GROQ_API_KEY = saved
    }
  })
})
