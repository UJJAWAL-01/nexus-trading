'use client'
// src/components/panels/CorrelationPanel.tsx
// Redesigned for immediate visual impact — heatmap tiles as default view

import { useEffect, useState, useRef, useCallback } from 'react'

interface Correlation {
  symbol: string; name: string; relationship: string
  direction: 'upstream'|'downstream'|'competitor'|'macro'|'etf'|'peer'
  logic: string; confidence: 'high'|'medium'|'low'
  pearson: number; spearman: number; beta: number; partialCorr: number
  dccRecent: number; dccTrend: 'increasing'|'decreasing'|'stable'
  leadLagDays: number; leadDirection: 'leads'|'follows'|'concurrent'
  regimeShift: boolean; regimeNote: string
  rolling30: number; rolling60: number; rolling90: number
}
interface CorrelData {
  target: string; targetName: string; sector: string; industry: string
  description: string; keyRisks: string[]
  correlations: Correlation[]
  totalAnalyzed: number; regimeShifts: number
  aiProvider: string; poweredBy: string; period: string
}

const DIR = {
  upstream:   { label:'Upstream Supplier',   color:'#f97316', bg:'rgba(249,115,22,0.1)',  icon:'⬆' },
  downstream: { label:'Downstream Customer', color:'#00c97a', bg:'rgba(0,201,122,0.1)',   icon:'⬇' },
  competitor: { label:'Direct Competitor',   color:'#ef4444', bg:'rgba(239,68,68,0.1)',   icon:'⚔' },
  macro:      { label:'Macro Factor',        color:'#a78bfa', bg:'rgba(167,139,250,0.1)', icon:'🌐' },
  etf:        { label:'ETF / Index',         color:'#38bdf8', bg:'rgba(56,189,248,0.1)',  icon:'📦' },
  peer:       { label:'Sector Peer',         color:'#f0a500', bg:'rgba(240,165,0,0.1)',   icon:'≈' },
}

const QUICK = {
  'US Tech':    ['AAPL','NVDA','MSFT','GOOGL','TSLA','META'],
  'US Finance': ['JPM','GS','BAC','MS','BRK-B'],
  'India NSE':  ['RELIANCE.NS','TCS.NS','HDFCBANK.NS','INFY.NS','ICICIBANK.NS'],
  'Commodity':  ['CL=F','GC=F','HG=F','NG=F'],
}

function cColor(v:number) {
  const a=Math.abs(v)
  if(a>=0.7) return v>0?'#00c97a':'#ef4444'
  if(a>=0.4) return v>0?'#86efac':'#fca5a5'
  if(a>=0.2) return v>0?'#d1fae5':'#fee2e2'
  return '#4a6070'
}
function cLabel(v:number) {
  const a=Math.abs(v)
  if(a>=0.75) return v>0?'STRONG +'    :'STRONG −'
  if(a>=0.50) return v>0?'MODERATE +'  :'MODERATE −'
  if(a>=0.30) return v>0?'WEAK +'      :'WEAK −'
  return 'NEAR ZERO'
}

type View='heatmap'|'chain'|'table'

export default function CorrelationPanel() {
  const [sym,     setSym]     = useState('AAPL')
  const [input,   setInput]   = useState('AAPL')
  const [data,    setData]    = useState<CorrelData|null>(null)
  const [loading, setLoading] = useState(false)
  const [view,    setView]    = useState<View>('heatmap')
  const [hover,   setHover]   = useState<string|null>(null)
  const [picks,   setPicks]   = useState(false)

  const load = useCallback(async(s:string)=>{
    setLoading(true)
    try {
      const r = await fetch(`/api/correlation?symbol=${encodeURIComponent(s)}`)
      const j = await r.json()
      if(j.correlations?.length) { setData(j); setView('heatmap') }
    } catch{}
    setLoading(false)
  },[])

  useEffect(()=>{ load('AAPL') },[load])

  const submit = () => {
    const s = input.trim().toUpperCase()
    if(s){ setSym(s); load(s) }
    setPicks(false)
  }

  const sorted   = data ? [...data.correlations].sort((a,b)=>Math.abs(b.pearson)-Math.abs(a.pearson)) : []
  const hovItem  = hover ? data?.correlations.find(c=>c.symbol===hover) : null

  const groups = data ? (['upstream','downstream','macro','competitor','etf','peer'] as const)
    .map(d=>({ dir:d, items: data.correlations.filter(c=>c.direction===d).sort((a,b)=>Math.abs(b.pearson)-Math.abs(a.pearson)) }))
    .filter(g=>g.items.length>0) : []

  return (
    <div className="panel" style={{height:'100%',display:'flex',flexDirection:'column'}}>

      {/* HEADER */}
      <div className="panel-header" style={{flexShrink:0,justifyContent:'space-between',flexWrap:'wrap',gap:'5px'}}>
        <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
          <div className="dot" style={{background:'#a78bfa',flexShrink:0}}/>
          <span style={{fontSize:'10px',letterSpacing:'0.12em',fontWeight:700,fontFamily:'JetBrains Mono,monospace'}}>
            SUPPLY CHAIN CORRELATION
          </span>
          {(data?.regimeShifts??0)>0 && (
            <span style={{
              fontSize:'7px',padding:'2px 6px',borderRadius:'2px',
              background:'rgba(239,68,68,0.15)',color:'#ef4444',
              border:'1px solid rgba(239,68,68,0.3)',fontFamily:'JetBrains Mono,monospace',fontWeight:700
            }}>⚡ {data!.regimeShifts} REGIME SHIFT{data!.regimeShifts>1?'S':''}</span>
          )}
        </div>
        <div style={{display:'flex',gap:'3px'}}>
          {(['heatmap','chain','table'] as View[]).map(v=>(
            <button key={v} onClick={()=>setView(v)} style={{
              padding:'2px 8px',borderRadius:'3px',cursor:'pointer',fontSize:'9px',
              fontFamily:'JetBrains Mono,monospace',letterSpacing:'0.06em',textTransform:'uppercase',
              border:`1px solid ${view===v?'#a78bfa':'var(--border)'}`,
              background:view===v?'rgba(167,139,250,0.12)':'transparent',
              color:view===v?'#a78bfa':'var(--text-muted)',
            }}>{v==='heatmap'?'▦ MAP':v==='chain'?'🔗 CHAIN':'≡ TABLE'}</button>
          ))}
        </div>
      </div>

      {/* SEARCH */}
      <div style={{display:'flex',gap:'6px',padding:'8px 12px',borderBottom:'1px solid var(--border)',flexShrink:0,position:'relative'}}>
        <div style={{flex:1,position:'relative'}}>
          <input
            value={input}
            onChange={e=>setInput(e.target.value.toUpperCase())}
            onFocus={()=>setPicks(true)}
            onBlur={()=>setTimeout(()=>setPicks(false),200)}
            onKeyDown={e=>e.key==='Enter'&&submit()}
            placeholder="Any symbol: AAPL · RELIANCE.NS · CL=F · JPM..."
            style={{
              width:'100%',background:'var(--bg-secondary)',border:'1px solid var(--border)',
              borderRadius:'4px',padding:'6px 10px',color:'#fff',
              fontSize:'11px',fontFamily:'JetBrains Mono,monospace',outline:'none',boxSizing:'border-box',
            }}
          />
          {picks && (
            <div style={{
              position:'absolute',top:'100%',left:0,right:0,zIndex:99,marginTop:'3px',
              background:'#0d1821',border:'1px solid var(--border)',borderRadius:'6px',padding:'8px',
            }}>
              {Object.entries(QUICK).map(([cat,syms])=>(
                <div key={cat} style={{marginBottom:'8px'}}>
                  <div style={{fontSize:'7px',color:'var(--text-muted)',letterSpacing:'0.12em',marginBottom:'4px',fontFamily:'JetBrains Mono,monospace'}}>{cat}</div>
                  <div style={{display:'flex',gap:'4px',flexWrap:'wrap'}}>
                    {syms.map(s=>(
                      <button key={s} onMouseDown={()=>{setInput(s);setSym(s);load(s);setPicks(false)}} style={{
                        padding:'3px 10px',borderRadius:'3px',cursor:'pointer',fontFamily:'JetBrains Mono,monospace',
                        border:'1px solid var(--border)',background:'var(--bg-secondary)',color:'#fff',fontSize:'10px',
                      }}>{s.replace('.NS','')}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <button onClick={submit} disabled={loading} style={{
          padding:'6px 18px',borderRadius:'4px',cursor:'pointer',flexShrink:0,
          border:'1px solid #a78bfa',background:loading?'transparent':'rgba(167,139,250,0.15)',
          color:'#a78bfa',fontSize:'10px',fontFamily:'JetBrains Mono,monospace',letterSpacing:'0.08em',
        }}>{loading?'···':'ANALYZE'}</button>
      </div>

      {/* TARGET STRIP */}
      {data&&!loading&&(
        <div style={{
          padding:'8px 14px',borderBottom:'1px solid var(--border)',flexShrink:0,
          display:'flex',alignItems:'center',justifyContent:'space-between',gap:'12px',
        }}>
          <div style={{minWidth:0}}>
            <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'2px',flexWrap:'wrap'}}>
              <span style={{fontSize:'15px',fontWeight:900,color:'#fff',fontFamily:'Syne,sans-serif'}}>{data.target.replace('.NS','').replace('.BO','')}</span>
              <span style={{fontSize:'9px',color:'#a78bfa',padding:'1px 7px',border:'1px solid rgba(167,139,250,0.3)',borderRadius:'2px',fontFamily:'JetBrains Mono,monospace'}}>{data.sector}</span>
              <span style={{fontSize:'7px',color:'var(--text-muted)',padding:'1px 5px',border:'1px solid var(--border)',borderRadius:'2px',fontFamily:'JetBrains Mono,monospace'}}>via {data.aiProvider?.toUpperCase()}</span>
            </div>
            <div style={{fontSize:'9px',color:'var(--text-muted)',lineHeight:1.5,fontFamily:'JetBrains Mono,monospace',maxWidth:'480px'}}>
              {data.description||data.industry}
            </div>
          </div>
          <div style={{display:'flex',gap:'12px',flexShrink:0}}>
            {[
              {l:'PEERS',     v:data.correlations.length},
              {l:'STRONG ≥.5',v:data.correlations.filter(c=>Math.abs(c.pearson)>=0.5).length},
              {l:'⚡ SHIFTS',  v:data.regimeShifts, hot:data.regimeShifts>0},
            ].map(s=>(
              <div key={s.l} style={{textAlign:'center'}}>
                <div style={{fontSize:'20px',fontWeight:900,fontFamily:'Syne,sans-serif',color:s.hot?'#ef4444':'#fff',lineHeight:1}}>{s.v}</div>
                <div style={{fontSize:'7px',color:'var(--text-muted)',fontFamily:'JetBrains Mono,monospace',letterSpacing:'0.07em'}}>{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* LOADING */}
      {loading&&(
        <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:'16px'}}>
          <div style={{fontSize:'11px',color:'var(--text-muted)',letterSpacing:'0.12em',fontFamily:'JetBrains Mono,monospace'}}>MAPPING SUPPLY CHAIN UNIVERSE…</div>
          <div style={{display:'flex',gap:'5px',flexWrap:'wrap',justifyContent:'center'}}>
            {['AI MAPPING PEERS','FETCHING 180D PRICES','DCC-GARCH COMPUTE','REGIME DETECTION'].map(s=>(
              <div key={s} style={{fontSize:'8px',color:'#a78bfa',padding:'3px 10px',border:'1px solid rgba(167,139,250,0.2)',borderRadius:'2px',fontFamily:'JetBrains Mono,monospace'}}>{s}</div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ HEATMAP VIEW ════════════════════════════════════════════════════ */}
      {!loading&&data&&view==='heatmap'&&(
        <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column'}}>

          {/* Legend */}
          <div style={{padding:'5px 12px',borderBottom:'1px solid var(--border)',display:'flex',gap:'14px',alignItems:'center',flexShrink:0,flexWrap:'wrap'}}>
            <span style={{fontSize:'7px',color:'var(--text-muted)',letterSpacing:'0.1em',fontFamily:'JetBrains Mono,monospace'}}>PEARSON →</span>
            {[['≥.75 STRONG +','#00c97a'],['≥.50 MOD +','#86efac'],['≥.30 WEAK +','#d1fae5'],['~0 NEUTRAL','#4a6070'],['≥.30 WEAK −','#fee2e2'],['≥.50 MOD −','#fca5a5'],['≥.75 STRONG −','#ef4444']].map(([l,c])=>(
              <div key={l} style={{display:'flex',alignItems:'center',gap:'3px'}}>
                <div style={{width:'9px',height:'9px',borderRadius:'2px',background:c,opacity:0.9}}/>
                <span style={{fontSize:'7px',color:'var(--text-muted)',fontFamily:'JetBrains Mono,monospace'}}>{l}</span>
              </div>
            ))}
          </div>

          {/* Tile grid */}
          <div style={{padding:'10px 12px',display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(155px,1fr))',gap:'6px'}}>
            {sorted.map(c=>{
              const dm=DIR[c.direction]
              const isH=hover===c.symbol
              return (
                <div key={c.symbol}
                  onMouseEnter={()=>setHover(c.symbol)}
                  onMouseLeave={()=>setHover(null)}
                  style={{
                    padding:'9px 10px',borderRadius:'5px',cursor:'default',
                    border:`1px solid ${c.regimeShift?'rgba(239,68,68,0.4)':isH?'rgba(167,139,250,0.4)':'var(--border)'}`,
                    background:isH?'rgba(167,139,250,0.05)':'var(--bg-secondary)',
                    transition:'all 0.12s',position:'relative',overflow:'hidden',
                  }}
                >
                  {/* Color bar */}
                  <div style={{
                    position:'absolute',left:0,top:0,bottom:0,width:'4px',
                    background:cColor(c.pearson),opacity:Math.max(Math.abs(c.pearson),0.25),
                  }}/>
                  {/* Regime badge */}
                  {c.regimeShift&&<div style={{
                    position:'absolute',top:'4px',right:'4px',
                    fontSize:'7px',padding:'1px 4px',borderRadius:'2px',
                    background:'rgba(239,68,68,0.15)',color:'#ef4444',
                    border:'1px solid rgba(239,68,68,0.3)',fontFamily:'JetBrains Mono,monospace',
                  }}>⚡SHIFT</div>}

                  <div style={{paddingLeft:'6px'}}>
                    <div style={{fontSize:'11px',fontWeight:700,color:'#fff',fontFamily:'Syne,sans-serif'}}>
                      {c.symbol.replace('.NS','').replace('.BO','')}
                    </div>
                    <div style={{fontSize:'8px',color:'var(--text-muted)',marginBottom:'5px',lineHeight:1.3,fontFamily:'JetBrains Mono,monospace'}}>
                      {c.name.length>20?c.name.slice(0,20)+'…':c.name}
                    </div>

                    {/* BIG number — the whole point */}
                    <div style={{fontSize:'28px',fontWeight:900,lineHeight:1,color:cColor(c.pearson),fontFamily:'Syne,sans-serif',marginBottom:'2px'}}>
                      {c.pearson>0?'+':''}{c.pearson.toFixed(2)}
                    </div>
                    <div style={{fontSize:'7px',color:cColor(c.pearson),letterSpacing:'0.1em',marginBottom:'6px',fontFamily:'JetBrains Mono,monospace'}}>
                      {cLabel(c.pearson)}
                    </div>

                    {/* Rolling sparkline 30/60/90 */}
                    <div style={{display:'flex',gap:'3px',marginBottom:'6px'}}>
                      {[{d:'30D',v:c.rolling30},{d:'60D',v:c.rolling60},{d:'90D',v:c.rolling90}].map(({d,v})=>(
                        <div key={d} style={{textAlign:'center',flex:1,padding:'2px',background:'rgba(255,255,255,0.04)',borderRadius:'2px'}}>
                          <div style={{fontSize:'9px',fontWeight:700,color:cColor(v),fontFamily:'Syne,sans-serif'}}>{v>0?'+':''}{v.toFixed(2)}</div>
                          <div style={{fontSize:'6px',color:'var(--text-muted)',fontFamily:'JetBrains Mono,monospace'}}>{d}</div>
                        </div>
                      ))}
                    </div>

                    {/* Direction badge */}
                    <div style={{display:'flex',gap:'3px',flexWrap:'wrap'}}>
                      <span style={{fontSize:'7px',padding:'1px 5px',borderRadius:'2px',background:dm.bg,color:dm.color,border:`1px solid ${dm.color}30`,fontFamily:'JetBrains Mono,monospace'}}>
                        {dm.icon} {c.direction.toUpperCase()}
                      </span>
                      {c.dccTrend!=='stable'&&(
                        <span style={{fontSize:'7px',padding:'1px 5px',borderRadius:'2px',fontFamily:'JetBrains Mono,monospace',
                          background:c.dccTrend==='increasing'?'rgba(0,201,122,0.1)':'rgba(239,68,68,0.1)',
                          color:c.dccTrend==='increasing'?'#00c97a':'#ef4444',
                          border:`1px solid ${c.dccTrend==='increasing'?'rgba(0,201,122,0.25)':'rgba(239,68,68,0.25)'}`,
                        }}>DCC {c.dccTrend==='increasing'?'↑':'↓'}</span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Hover detail */}
          {hovItem&&(
            <div style={{
              margin:'0 12px 12px',padding:'12px 14px',borderRadius:'6px',flexShrink:0,
              border:'1px solid rgba(167,139,250,0.3)',background:'rgba(167,139,250,0.04)',
            }}>
              <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:'8px',marginBottom:'10px'}}>
                <div>
                  <div style={{fontSize:'13px',fontWeight:700,color:'#fff',fontFamily:'Syne,sans-serif',marginBottom:'3px'}}>
                    {hovItem.name} <span style={{color:'#a78bfa',fontSize:'11px'}}>({hovItem.symbol})</span>
                  </div>
                  <div style={{fontSize:'9px',color:'var(--text-muted)',lineHeight:1.6,fontFamily:'JetBrains Mono,monospace'}}>
                    {hovItem.logic}
                  </div>
                  {hovItem.leadDirection!=='concurrent'&&hovItem.leadLagDays>0&&(
                    <div style={{marginTop:'5px',fontSize:'8px',color:'#f0a500',fontFamily:'JetBrains Mono,monospace'}}>
                      📈 {hovItem.symbol.replace('.NS','')} {hovItem.leadDirection==='leads'?'LEADS':'FOLLOWS'} {data.target} by ~{hovItem.leadLagDays} day{hovItem.leadLagDays>1?'s':''}
                    </div>
                  )}
                </div>
                <div style={{textAlign:'right',flexShrink:0}}>
                  <div style={{fontSize:'32px',fontWeight:900,color:cColor(hovItem.pearson),fontFamily:'Syne,sans-serif',lineHeight:1}}>
                    {hovItem.pearson>0?'+':''}{hovItem.pearson.toFixed(2)}
                  </div>
                  <div style={{fontSize:'7px',color:'var(--text-muted)',fontFamily:'JetBrains Mono,monospace'}}>{cLabel(hovItem.pearson)}</div>
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'5px'}}>
                {[
                  {l:'SPEARMAN', v:hovItem.spearman},
                  {l:'BETA',     v:hovItem.beta},
                  {l:'PARTIAL',  v:hovItem.partialCorr},
                  {l:'DCC LIVE', v:hovItem.dccRecent},
                  {l:'30D ROLL', v:hovItem.rolling30},
                ].map(({l,v})=>(
                  <div key={l} style={{textAlign:'center',padding:'5px',borderRadius:'3px',background:'var(--bg-secondary)',border:'1px solid var(--border)'}}>
                    <div style={{fontSize:'13px',fontWeight:700,color:cColor(v),fontFamily:'Syne,sans-serif'}}>{v>0?'+':''}{v.toFixed(2)}</div>
                    <div style={{fontSize:'6px',color:'var(--text-muted)',fontFamily:'JetBrains Mono,monospace',letterSpacing:'0.08em',marginTop:'1px'}}>{l}</div>
                  </div>
                ))}
              </div>
              {hovItem.regimeShift&&(
                <div style={{marginTop:'8px',padding:'6px 10px',borderRadius:'3px',background:'rgba(239,68,68,0.08)',border:'1px solid rgba(239,68,68,0.25)',fontSize:'9px',color:'#ef4444',fontFamily:'JetBrains Mono,monospace'}}>
                  ⚡ {hovItem.regimeNote}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══ SUPPLY CHAIN VIEW ═══════════════════════════════════════════════ */}
      {!loading&&data&&view==='chain'&&(
        <div style={{flex:1,overflowY:'auto',padding:'10px 12px',display:'flex',flexDirection:'column',gap:'8px'}}>
          {/* Center node */}
          <div style={{textAlign:'center',padding:'8px 0 4px'}}>
            <div style={{display:'inline-block',padding:'8px 28px',borderRadius:'6px',border:'2px solid #a78bfa',background:'rgba(167,139,250,0.1)'}}>
              <div style={{fontSize:'18px',fontWeight:900,color:'#fff',fontFamily:'Syne,sans-serif'}}>{data.target.replace('.NS','').replace('.BO','')}</div>
              <div style={{fontSize:'9px',color:'#a78bfa',fontFamily:'JetBrains Mono,monospace'}}>{data.targetName} · {data.sector}</div>
            </div>
          </div>

          {groups.map(({dir,items})=>{
            const dm=DIR[dir]
            return (
              <div key={dir} style={{border:`1px solid ${dm.color}22`,borderRadius:'6px',overflow:'hidden'}}>
                <div style={{padding:'6px 12px',background:dm.bg,display:'flex',alignItems:'center',gap:'8px'}}>
                  <span style={{fontSize:'13px'}}>{dm.icon}</span>
                  <span style={{fontSize:'9px',color:dm.color,fontWeight:700,letterSpacing:'0.1em',fontFamily:'JetBrains Mono,monospace'}}>{dm.label.toUpperCase()} ({items.length})</span>
                </div>
                <div style={{display:'flex',flexWrap:'wrap',gap:'6px',padding:'8px 10px'}}>
                  {items.map(c=>(
                    <div key={c.symbol}
                      onMouseEnter={()=>setHover(c.symbol)}
                      onMouseLeave={()=>setHover(null)}
                      style={{
                        padding:'7px 10px',borderRadius:'4px',cursor:'default',minWidth:'120px',maxWidth:'220px',
                        border:`1px solid ${hover===c.symbol?dm.color:dm.color+'25'}`,
                        background:hover===c.symbol?dm.bg:'var(--bg-secondary)',transition:'all 0.12s',
                      }}
                    >
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'4px'}}>
                        <div>
                          <div style={{fontSize:'11px',fontWeight:700,color:'#fff',fontFamily:'Syne,sans-serif'}}>
                            {c.symbol.replace('.NS','').replace('.BO','')}
                          </div>
                          <div style={{fontSize:'8px',color:'var(--text-muted)',fontFamily:'JetBrains Mono,monospace'}}>
                            {c.name.length>16?c.name.slice(0,16)+'…':c.name}
                          </div>
                        </div>
                        <div style={{textAlign:'right',flexShrink:0}}>
                          <div style={{fontSize:'18px',fontWeight:900,color:cColor(c.pearson),fontFamily:'Syne,sans-serif',lineHeight:1}}>
                            {c.pearson>0?'+':''}{c.pearson.toFixed(2)}
                          </div>
                          {c.regimeShift&&<div style={{fontSize:'7px',color:'#ef4444',fontFamily:'JetBrains Mono,monospace'}}>⚡shift</div>}
                        </div>
                      </div>
                      <div style={{fontSize:'8px',color:'var(--text-muted)',lineHeight:1.4,fontFamily:'JetBrains Mono,monospace'}}>
                        {c.logic}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ═══ TABLE VIEW ══════════════════════════════════════════════════════ */}
      {!loading&&data&&view==='table'&&(
        <div style={{flex:1,overflowY:'auto'}}>
          <div style={{
            display:'grid',gridTemplateColumns:'80px 1fr 52px 52px 52px 52px 75px',
            padding:'4px 12px',borderBottom:'1px solid var(--border)',
            fontSize:'7px',color:'var(--text-muted)',letterSpacing:'0.1em',fontFamily:'JetBrains Mono,monospace',
            position:'sticky',top:0,background:'var(--bg-primary)',
          }}>
            {['SYMBOL','RELATIONSHIP','PEARSON','SPEARMAN','BETA','PARTIAL','DIRECTION'].map(h=>(
              <div key={h} style={{textAlign:['SYMBOL','RELATIONSHIP','DIRECTION'].includes(h)?'left':'center'}}>{h}</div>
            ))}
          </div>
          {sorted.map((c,i)=>{
            const dm=DIR[c.direction]
            return (
              <div key={c.symbol}
                onMouseEnter={()=>setHover(c.symbol)}
                onMouseLeave={()=>setHover(null)}
                style={{
                  display:'grid',gridTemplateColumns:'80px 1fr 52px 52px 52px 52px 75px',
                  padding:'7px 12px',borderBottom:'1px solid var(--border)',alignItems:'center',
                  background:hover===c.symbol?'rgba(255,255,255,0.025)':i%2===0?'transparent':'rgba(255,255,255,0.01)',
                }}
              >
                <div>
                  <div style={{fontSize:'10px',fontWeight:700,color:'#fff',fontFamily:'Syne,sans-serif'}}>{c.symbol.replace('.NS','')}</div>
                  {c.regimeShift&&<div style={{fontSize:'7px',color:'#ef4444',fontFamily:'JetBrains Mono,monospace'}}>⚡ shift</div>}
                </div>
                <div style={{paddingRight:'8px'}}>
                  <div style={{fontSize:'9px',color:'#fff',fontFamily:'JetBrains Mono,monospace'}}>{c.relationship}</div>
                  <div style={{fontSize:'8px',color:'var(--text-muted)',marginTop:'1px',fontFamily:'JetBrains Mono,monospace'}}>{c.logic.slice(0,55)}{c.logic.length>55?'…':''}</div>
                </div>
                {[c.pearson,c.spearman,c.beta,c.partialCorr].map((v,j)=>(
                  <div key={j} style={{textAlign:'center',fontSize:'12px',fontWeight:700,color:cColor(v),fontFamily:'Syne,sans-serif'}}>
                    {v>0?'+':''}{v.toFixed(2)}
                  </div>
                ))}
                <span style={{fontSize:'7px',padding:'2px 6px',borderRadius:'2px',background:dm.bg,color:dm.color,border:`1px solid ${dm.color}30`,fontFamily:'JetBrains Mono,monospace'}}>
                  {dm.icon} {c.direction}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* FOOTER */}
      {data&&!loading&&(
        <div style={{
          padding:'4px 12px',borderTop:'1px solid var(--border)',flexShrink:0,
          fontSize:'7px',color:'var(--text-muted)',fontFamily:'JetBrains Mono,monospace',
          display:'flex',justifyContent:'space-between',
        }}>
          <span>{data.poweredBy}</span>
          <span>4h cache · {data.period}</span>
        </div>
      )}
    </div>
  )
}