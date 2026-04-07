// src/app/api/correlation/route.ts
// Uses the AI provider abstraction — Grok free → Claude paid → Gemini free
import { NextRequest, NextResponse } from 'next/server'
import { callAI, parseAIJson } from '@/lib/ai-provider'

// ── Caches ────────────────────────────────────────────────────────────────────
const intelligenceCache = new Map<string, { data: CompanyIntelligence; expires: number }>()
const priceCache        = new Map<string, { closes: number[]; expires: number }>()
const resultCache       = new Map<string, { data: unknown; expires: number }>()

// ── Types ─────────────────────────────────────────────────────────────────────

interface RelatedSymbol {
  symbol:       string
  name:         string
  relationship: string
  direction:    'upstream' | 'downstream' | 'competitor' | 'macro' | 'etf' | 'peer'
  confidence:   'high' | 'medium' | 'low'
  logic:        string
}

interface CompanyIntelligence {
  symbol:         string
  name:           string
  sector:         string
  industry:       string
  description:    string
  relatedSymbols: RelatedSymbol[]
  keyRisks:       string[]
  aiProvider:     string
}

// ── AI: business intelligence ─────────────────────────────────────────────────

async function getCompanyIntelligence(symbol: string): Promise<CompanyIntelligence> {
  const cacheKey = `intel:${symbol}`
  const cached   = intelligenceCache.get(cacheKey)
  if (cached && cached.expires > Date.now()) return cached.data

  const isIndian  = symbol.endsWith('.NS') || symbol.endsWith('.BO') || symbol.startsWith('^N')
  const market    = isIndian ? 'Indian (NSE/BSE)' : 'US'
  const benchmark = isIndian ? '^NSEI' : 'SPY'

  const userPrompt = `Analyze stock "${symbol}" (${market} market). Identify 18-22 related tradeable instruments across:
1. UPSTREAM: raw material suppliers, service providers this company buys from
2. DOWNSTREAM: customers, distributors, OEM partners that buy from this company
3. COMPETITOR: direct market competitors
4. MACRO: commodity prices, FX, yields that drive this company's financials
5. ETF: ETFs holding significant positions
6. PEER: stocks with similar business exposure

Rules:
- Use exact Yahoo Finance tickers (.NS suffix for Indian NSE stocks)
- Commodities: CL=F (crude), GC=F (gold), NG=F (gas), HG=F (copper), ALI=F (aluminum), RB=F (gasoline), ZC=F (corn), KC=F (coffee), SB=F (sugar)
- FX: USDINR=X, EURUSD=X, CNY=X
- Bonds: ^TNX (10Y US), ^FVX (5Y US)
- Always include ${benchmark} as macro
- Be specific about WHY each relationship exists financially

Return ONLY valid JSON:
{
  "name": "Full company name",
  "sector": "sector",
  "industry": "industry",
  "description": "2-sentence company overview",
  "relatedSymbols": [
    {"symbol":"TICKER","name":"Name","relationship":"Brief label","direction":"upstream|downstream|competitor|macro|etf|peer","confidence":"high|medium|low","logic":"Why this matters financially in one sentence"}
  ],
  "keyRisks": ["risk1","risk2","risk3"]
}`

  const { text, provider } = await callAI(
    [{ role: 'user', content: userPrompt }],
    2000
  )

  if (text) {
    const parsed = parseAIJson<any>(text)
    if (parsed?.relatedSymbols?.length) {
      const result: CompanyIntelligence = {
        symbol,
        name:           parsed.name ?? symbol,
        sector:         parsed.sector ?? 'Unknown',
        industry:       parsed.industry ?? 'Unknown',
        description:    parsed.description ?? '',
        relatedSymbols: (parsed.relatedSymbols as RelatedSymbol[])
          .filter(r => r.symbol && r.symbol !== symbol)
          .slice(0, 24),
        keyRisks:       parsed.keyRisks ?? [],
        aiProvider:     provider,
      }
      intelligenceCache.set(cacheKey, { data: result, expires: Date.now() + 24 * 3_600_000 })
      return result
    }
  }

  // Intelligent static fallback
  return buildFallback(symbol, isIndian)
}

function buildFallback(symbol: string, isIndian: boolean): CompanyIntelligence {
  const base: RelatedSymbol[] = isIndian ? [
    { symbol: '^NSEI',    name: 'NIFTY 50',    relationship: 'Market benchmark',   direction: 'macro', confidence: 'high',   logic: 'Systematic market risk embedded in all NSE stocks.' },
    { symbol: '^NSEBANK', name: 'Bank NIFTY',  relationship: 'Banking sector',     direction: 'macro', confidence: 'medium', logic: 'Banking health drives credit costs for Indian corporates.' },
    { symbol: 'USDINR=X', name: 'USD/INR',     relationship: 'Currency exposure',  direction: 'macro', confidence: 'high',   logic: 'FX movement affects import costs and overseas revenue.' },
    { symbol: 'CL=F',     name: 'Crude Oil',   relationship: 'Energy cost factor', direction: 'macro', confidence: 'high',   logic: 'Crude prices affect energy and logistics costs across Indian industry.' },
    { symbol: '^GSPC',    name: 'S&P 500',     relationship: 'FII risk proxy',     direction: 'macro', confidence: 'medium', logic: 'Global risk appetite drives FII flows into Indian equities.' },
  ] : [
    { symbol: 'SPY',   name: 'S&P 500 ETF',   relationship: 'Market benchmark',  direction: 'macro', confidence: 'high',   logic: 'Broad market systematic risk.' },
    { symbol: 'QQQ',   name: 'NASDAQ 100 ETF', relationship: 'Tech sector proxy', direction: 'macro', confidence: 'medium', logic: 'Tech growth sentiment.' },
    { symbol: '^TNX',  name: '10Y Treasury',   relationship: 'Rate sensitivity',  direction: 'macro', confidence: 'medium', logic: 'Risk-free rate affects equity discount.' },
    { symbol: 'GC=F',  name: 'Gold Futures',   relationship: 'Risk-off hedge',    direction: 'macro', confidence: 'low',    logic: 'Flight-to-safety signal.' },
    { symbol: '^VIX',  name: 'VIX',            relationship: 'Volatility regime', direction: 'macro', confidence: 'high',   logic: 'Implied volatility regime shifts correlate with equity drawdowns.' },
  ]

  return {
    symbol, name: symbol, sector: 'Unknown', industry: 'Unknown',
    description: 'Set GROK_API_KEY for full supply chain intelligence analysis.',
    relatedSymbols: base, keyRisks: ['AI key required for full analysis'], aiProvider: 'none',
  }
}

// ── Price fetching ────────────────────────────────────────────────────────────

async function fetchCloses(symbol: string): Promise<number[]> {
  const cacheKey = `price:${symbol}`
  const cached   = priceCache.get(cacheKey)
  if (cached && cached.expires > Date.now()) return cached.closes

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=6mo`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal:  AbortSignal.timeout(8000),
    })
    if (!res.ok) return []
    const json   = await res.json()
    const result = json?.chart?.result?.[0]
    if (!result) return []
    const closes = (result.indicators?.quote?.[0]?.close ?? []) as (number | null)[]
    const valid  = closes.filter((v): v is number => v !== null && v > 0)
    priceCache.set(cacheKey, { closes: valid, expires: Date.now() + 3_600_000 })
    return valid
  } catch { return [] }
}

// ── Statistics ────────────────────────────────────────────────────────────────

function returns(p: number[]) {
  const r: number[] = []
  for (let i = 1; i < p.length; i++) if (p[i-1] > 0) r.push((p[i]-p[i-1])/p[i-1])
  return r
}

function mean(a: number[]) { return a.reduce((s,v)=>s+v,0)/a.length }

function pearson(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length)
  if (n < 10) return 0
  const as = a.slice(-n), bs = b.slice(-n)
  const ma = mean(as), mb = mean(bs)
  let num=0, da=0, db=0
  for (let i=0;i<n;i++) { const ai=as[i]-ma,bi=bs[i]-mb; num+=ai*bi; da+=ai*ai; db+=bi*bi }
  const d = Math.sqrt(da*db)
  return d===0?0:parseFloat((num/d).toFixed(4))
}

function spearman(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length)
  if (n<10) return 0
  const rank = (arr: number[]) => {
    const sorted = [...arr].map((v,i)=>({v,i})).sort((x,y)=>x.v-y.v)
    const r = new Array(arr.length)
    sorted.forEach(({i},rank)=>{r[i]=rank+1})
    return r
  }
  return pearson(rank(a.slice(-n)), rank(b.slice(-n)))
}

function beta(target: number[], peer: number[]) {
  const n = Math.min(target.length, peer.length)
  if (n<10) return 0
  const t=target.slice(-n), p=peer.slice(-n)
  const mt=mean(t), mp=mean(p)
  let cov=0, varP=0
  for (let i=0;i<n;i++) { cov+=(t[i]-mt)*(p[i]-mp); varP+=(p[i]-mp)**2 }
  return varP===0?0:parseFloat((cov/varP).toFixed(4))
}

function partialCorr(x: number[], y: number[], z: number[]) {
  const rxy=pearson(x,y), rxz=pearson(x,z), ryz=pearson(y,z)
  const d=Math.sqrt((1-rxz**2)*(1-ryz**2))
  return d<1e-10?rxy:parseFloat(((rxy-rxz*ryz)/d).toFixed(4))
}

function dcc(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length)
  if (n<30) { const c=pearson(a,b); return {current:c,trend:'stable' as const} }
  const A=a.slice(-n), B=b.slice(-n)
  const ALPHA=0.06, BETA=0.93, LAMBDA=0.97
  const garch = (r: number[]) => {
    const v=new Array(r.length), longRun=r.reduce((s,x)=>s+x*x,0)/r.length
    v[0]=longRun
    for(let i=1;i<r.length;i++) v[i]=(1-ALPHA-BETA)*longRun+ALPHA*r[i-1]**2+BETA*v[i-1]
    return v
  }
  const vA=garch(A), vB=garch(B)
  const sA=A.map((v,i)=>v/Math.sqrt(Math.max(vA[i],1e-10)))
  const sB=B.map((v,i)=>v/Math.sqrt(Math.max(vB[i],1e-10)))

  const series: number[] = []
  for (let end=20;end<=n;end++) {
    const wa=sA.slice(0,end), wb=sB.slice(0,end)
    const wts=new Array(end)
    wts[end-1]=1
    for(let i=end-2;i>=0;i--) wts[i]=wts[i+1]*LAMBDA
    const wSum=wts.reduce((s,v)=>s+v,0)
    const wn=wts.map(w=>w/wSum)
    const mA=wa.reduce((s,v,i)=>s+v*wn[i],0)
    const mB=wb.reduce((s,v,i)=>s+v*wn[i],0)
    let wCov=0,wVA=0,wVB=0
    for(let i=0;i<end;i++){ const a=wa[i]-mA,b_=wb[i]-mB; wCov+=wn[i]*a*b_; wVA+=wn[i]*a*a; wVB+=wn[i]*b_*b_ }
    const d=Math.sqrt(wVA*wVB)
    series.push(d===0?0:parseFloat((wCov/d).toFixed(4)))
  }
  const current=series[series.length-1]
  const diff=mean(series.slice(-15))-mean(series.slice(0,15))
  const trend = diff>0.08?'increasing':diff<-0.08?'decreasing':'stable'
  return {current,trend} as {current:number,trend:'increasing'|'decreasing'|'stable'}
}

function leadLag(target: number[], peer: number[]) {
  const lags=[1,2,3,5]
  let best=0,bestAbs=0,bestDir:'leads'|'follows'|'concurrent'='concurrent'
  lags.forEach(lag=>{
    const n=Math.min(target.length,peer.length)-lag
    if(n<10)return
    const pLeads=pearson(peer.slice(0,n),target.slice(lag,lag+n))
    const tLeads=pearson(target.slice(0,n),peer.slice(lag,lag+n))
    if(Math.abs(pLeads)>bestAbs){bestAbs=Math.abs(pLeads);best=lag;bestDir='leads'}
    if(Math.abs(tLeads)>bestAbs){bestAbs=Math.abs(tLeads);best=lag;bestDir='follows'}
  })
  const concurrent=Math.abs(pearson(target,peer))
  if(bestAbs<concurrent+0.05)return{lagDays:0,direction:'concurrent' as const}
  return{lagDays:best,direction:bestDir}
}

function regimeShift(a: number[], b: number[]) {
  if(a.length<90||b.length<90)return{shifted:false,note:''}
  const recent=pearson(a.slice(-30),b.slice(-30))
  const hist  =pearson(a.slice(-120,-30),b.slice(-120,-30))
  const delta =recent-hist
  if(Math.abs(delta)>0.28){
    const dir=delta>0?'increased':'decreased'
    return{shifted:true,note:`Correlation ${dir} by ${Math.abs(delta).toFixed(2)} vs prior 90d`}
  }
  return{shifted:false,note:''}
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const symbol   = (searchParams.get('symbol')||'AAPL').trim()
  const cacheKey = `result:${symbol}`

  const cached = resultCache.get(cacheKey)
  if (cached && cached.expires > Date.now()) return NextResponse.json(cached.data)

  try {
    const intel       = await getCompanyIntelligence(symbol)
    const targetClose = await fetchCloses(symbol)
    if (targetClose.length < 20) {
      return NextResponse.json({ error: `Insufficient data for ${symbol}`, correlations: [], target: symbol, intelligence: intel })
    }
    const targetRet = returns(targetClose)

    const isIndian   = symbol.endsWith('.NS')||symbol.endsWith('.BO')
    const benchSym   = isIndian?'^NSEI':'SPY'
    const benchClose = await fetchCloses(benchSym)
    const benchRet   = returns(benchClose)

    // Batch fetch peers
    const allSyms = intel.relatedSymbols.map(r=>r.symbol)
    const priceMap = new Map<string,number[]>()
    const BATCH = 5
    for (let i=0;i<allSyms.length;i+=BATCH) {
      const batch = allSyms.slice(i,i+BATCH)
      await Promise.all(batch.map(async s=>{
        const c = await fetchCloses(s)
        if(c.length>=20) priceMap.set(s,c)
      }))
      if(i+BATCH<allSyms.length) await new Promise(r=>setTimeout(r,250))
    }

    const correlations = intel.relatedSymbols
      .filter(r=>priceMap.has(r.symbol))
      .map(r=>{
        const peerClose = priceMap.get(r.symbol)!
        const peerRet   = returns(peerClose)
        if(peerRet.length<10||targetRet.length<10)return null
        const p = pearson(targetRet,peerRet)
        if(Math.abs(p)<0.02)return null
        const sp  = spearman(targetRet,peerRet)
        const b   = beta(targetRet,peerRet)
        const pc  = benchRet.length>=20?partialCorr(targetRet,peerRet,benchRet):p
        const d   = dcc(targetRet,peerRet)
        const ll  = leadLag(targetRet,peerRet)
        const rs  = regimeShift(targetRet,peerRet)
        return {
          symbol:       r.symbol,
          name:         r.name,
          relationship: r.relationship,
          direction:    r.direction,
          logic:        r.logic,
          confidence:   r.confidence,
          pearson:      p, spearman: sp, beta: b, partialCorr: pc,
          grangerDir:   'independent' as const,  // simplified — full Granger is expensive per-pair
          grangerP:     1,
          rolling30:    pearson(targetRet.slice(-30),peerRet.slice(-30)),
          rolling60:    pearson(targetRet.slice(-60),peerRet.slice(-60)),
          rolling90:    pearson(targetRet.slice(-90),peerRet.slice(-90)),
          dccRecent:    d.current, dccTrend: d.trend,
          leadLagDays:  ll.lagDays, leadDirection: ll.direction,
          regimeShift:  rs.shifted, regimeNote: rs.note,
          dataPoints:   Math.min(targetClose.length,peerClose.length),
          abs:          Math.abs(p),
        }
      })
      .filter(Boolean)
      .sort((a,b)=>{
        if(a!.regimeShift&&!b!.regimeShift)return -1
        if(!a!.regimeShift&&b!.regimeShift)return 1
        return b!.abs-a!.abs
      })
      .slice(0,18)

    const response = {
      target:        symbol,
      targetName:    intel.name,
      sector:        intel.sector,
      industry:      intel.industry,
      description:   intel.description,
      keyRisks:      intel.keyRisks,
      dataPoints:    targetClose.length,
      period:        `${targetClose.length} trading days`,
      correlations,
      totalAnalyzed: correlations.length,
      regimeShifts:  correlations.filter(c=>c?.regimeShift).length,
      aiProvider:    intel.aiProvider,
      poweredBy:     `${intel.aiProvider.toUpperCase()} AI + DCC-GARCH + Partial Correlation + Lead-Lag`,
      fetchedAt:     new Date().toISOString(),
    }

    resultCache.set(cacheKey,{data:response,expires:Date.now()+4*3_600_000})
    return NextResponse.json(response)
  } catch(err) {
    console.error('[Correlation]',err)
    return NextResponse.json({error:'Computation failed',correlations:[],target:symbol})
  }
}