'use client'

import { useState } from 'react'
import { useLayoutStore, PRESETS, PresetName } from '@/store/layout'

import ChartPanel              from '@/components/panels/ChartPanel'
import WatchlistPanel          from '@/components/panels/WatchlistPanel'
import NewsFeedPanel           from '@/components/panels/NewsFeedPanel'
import GlobalIndicesPanel      from '@/components/panels/GlobalIndicesPanel'
import SentimentPanel          from '@/components/panels/SentimentPanel'
import EconomicCalendarPanel   from '@/components/panels/EconomicCalendarPanel'
import SectorHeatmapPanel      from '@/components/panels/SectorHeatmapPanel'
import AlternativeSignalsPanel from '@/components/panels/AlternativeSignalsPanel'

const PANEL_COMPONENTS: Record<string, React.ReactNode> = {
  chart:      <ChartPanel />,
  indices:    <GlobalIndicesPanel />,
  watchlist:  <WatchlistPanel />,
  news:       <NewsFeedPanel />,
  sentiment:  <SentimentPanel />,
  calendar:   <EconomicCalendarPanel />,
  heatmap:    <SectorHeatmapPanel />,
  altsignals: <AlternativeSignalsPanel />,
}

export default function GridLayout() {
  const { activePreset, setPreset } = useLayoutStore()
  const [showPicker, setShowPicker] = useState(false)
  const preset = PRESETS[activePreset]

  return (
    <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: '0' }}>

      {/* ── Layout toolbar ── */}
      <div style={{
        display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
        gap: '6px', padding: '0 0 6px 0', position: 'relative',
      }}>

        {/* Current preset indicator */}
        <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginRight: '4px' }}>
          {PRESETS[activePreset].icon} {PRESETS[activePreset].label}
        </span>

        {/* Customize button */}
        <button
          onClick={() => setShowPicker(v => !v)}
          style={{
            padding: '3px 12px', borderRadius: '3px', cursor: 'pointer',
            fontFamily: 'JetBrains Mono, monospace', fontSize: '10px',
            letterSpacing: '0.08em', textTransform: 'uppercase',
            border: `1px solid ${showPicker ? 'var(--amber)' : 'var(--border)'}`,
            background: showPicker ? 'rgba(240,165,0,0.1)' : 'transparent',
            color: showPicker ? 'var(--amber)' : 'var(--text-muted)',
            transition: 'all 0.15s',
          }}
        >
          ⊞ LAYOUT
        </button>

        {/* Preset picker dropdown */}
        {showPicker && (
          <div style={{
            position: 'absolute', top: '100%', right: 0,
            background: '#0d1117',
            border: '1px solid var(--border-br)',
            borderRadius: '6px', padding: '10px',
            zIndex: 1000,
            boxShadow: '0 16px 48px rgba(0,0,0,0.8)',
            width: '340px',
            display: 'flex', flexDirection: 'column', gap: '6px',
          }}>
            <div style={{
              fontSize: '9px', color: 'var(--text-muted)',
              fontFamily: 'JetBrains Mono, monospace',
              letterSpacing: '0.12em', textTransform: 'uppercase',
              marginBottom: '4px', paddingBottom: '8px',
              borderBottom: '1px solid var(--border)',
            }}>
              SELECT LAYOUT PRESET
            </div>

            {(Object.values(PRESETS) as typeof PRESETS[PresetName][]).map(p => (
              <button
                key={p.name}
                onClick={() => { setPreset(p.name); setShowPicker(false) }}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: '12px',
                  padding: '10px 12px', borderRadius: '5px', cursor: 'pointer',
                  textAlign: 'left', width: '100%',
                  background: activePreset === p.name ? 'rgba(240,165,0,0.08)' : 'transparent',
                  border: `1px solid ${activePreset === p.name ? 'rgba(240,165,0,0.35)' : 'var(--border)'}`,
                  transition: 'all 0.12s',
                }}
                onMouseEnter={e => { if (activePreset !== p.name) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)' }}
                onMouseLeave={e => { if (activePreset !== p.name) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <span style={{ fontSize: '20px', lineHeight: 1, marginTop: '1px' }}>{p.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontFamily: 'Syne, sans-serif', fontWeight: 700,
                    fontSize: '13px',
                    color: activePreset === p.name ? 'var(--amber)' : '#fff',
                    display: 'flex', alignItems: 'center', gap: '8px',
                  }}>
                    {p.label}
                    {activePreset === p.name && (
                      <span style={{
                        fontSize: '8px', padding: '1px 6px', borderRadius: '2px',
                        background: 'rgba(240,165,0,0.2)', color: 'var(--amber)',
                        fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em',
                      }}>ACTIVE</span>
                    )}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginTop: '3px', lineHeight: 1.4 }}>
                    {p.description}
                  </div>
                </div>
              </button>
            ))}

            <div style={{
              marginTop: '4px', paddingTop: '8px',
              borderTop: '1px solid var(--border)',
              fontSize: '9px', color: 'var(--text-muted)',
              fontFamily: 'JetBrains Mono, monospace',
              textAlign: 'center', lineHeight: 1.5,
            }}>
              Your layout is saved automatically · persists across sessions
            </div>
          </div>
        )}
      </div>

      {/* ── Render active preset rows ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {preset.rows.map((row, rowIdx) => (
          <div
            key={rowIdx}
            style={{
              display: 'grid',
              gridTemplateColumns: row.columns,
              gap: '8px',
              height: row.height,
            }}
          >
            {row.panels.map(panelKey => {
              const component = PANEL_COMPONENTS[panelKey]
              if (!component) return null
              return (
                <div key={panelKey} style={{ overflow: 'hidden', minWidth: 0, minHeight: 0 }}>
                  {component}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Close picker on outside click */}
      {showPicker && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 999 }}
          onClick={() => setShowPicker(false)}
        />
      )}
    </div>
  )
}