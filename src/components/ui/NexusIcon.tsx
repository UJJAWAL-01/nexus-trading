import type { CSSProperties } from 'react'

export type NexusIconName =
  | 'market-pulse' | 'news-signal' | 'research-lens' | 'india-grid' | 'options-curve'
  | 'candle' | 'bars' | 'line-chart' | 'area-chart' | 'point-figure'
  | 'search' | 'close' | 'chevron-down' | 'indicators' | 'compare' | 'layouts'
  | 'timeframe' | 'reset' | 'capture' | 'expand' | 'collapse' | 'analysis' | 'alert'
  | 'trash'
  | 'pan' | 'select' | 'trendline' | 'ray' | 'horizontal' | 'vertical' | 'rectangle'
  | 'measure' | 'fibonacci' | 'long' | 'short'
  | 'oil' | 'gas' | 'fuel' | 'gold' | 'silver' | 'copper' | 'aluminum' | 'platinum'
  | 'wheat' | 'corn' | 'soy' | 'sugar' | 'coffee' | 'cotton' | 'bitcoin' | 'ethereum'
  | 'inflation' | 'growth' | 'employment' | 'central-bank' | 'trade' | 'manufacturing' | 'consumer' | 'event'
  | 'risk-shield' | 'calendar' | 'correlation' | 'prop-firm' | 'settings' | 'balance'

export interface NexusIconProps {
  name: NexusIconName
  size?: number
  strokeWidth?: number
  className?: string
  style?: CSSProperties
  title?: string
}

type Path = string
type IconShape = { paths?: Path[]; circles?: Array<[number, number, number]>; rects?: Array<[number, number, number, number, number?]>; lines?: Array<[number, number, number, number]> }

const ICONS: Record<NexusIconName, IconShape> = {
  'market-pulse': { paths: ['M3 16h3l2.2-7 3.1 11L14 6l2.2 6H21', 'M3 5h5M16 19h5'] },
  'news-signal': { paths: ['M4 4h13v16H4zM7 8h7M7 12h7M7 16h4', 'M18 7l3-2v11l-3-2z'] },
  'research-lens': { paths: ['M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.3 15.3 21 21', 'M8 13l2-3 2 2 2-4'] },
  'india-grid': { paths: ['M4 4h16v16H4zM4 10h16M10 4v16', 'M13 7h4M15 5v4'] },
  'options-curve': { paths: ['M3 18h18M5 15c3-9 6-9 8-4s4 5 6-7', 'M6 6h2M17 14h2'] },
  candle: { paths: ['M7 4v16M17 3v18', 'M4.5 8h5v7h-5zM14.5 6h5v9h-5z'] },
  bars: { paths: ['M5 5v14M12 3v18M19 7v11', 'M3 8h4M10 7h4M17 10h4'] },
  'line-chart': { paths: ['M4 19V5M4 19h16', 'M6 15l4-4 3 2 5-7'] },
  'area-chart': { paths: ['M4 19V5M4 19h16', 'M6 16l4-5 3 2 5-7 2 13H6z'] },
  'point-figure': { paths: ['M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z'] },
  search: { paths: ['M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.3 15.3 21 21'] },
  close: { paths: ['m6 6 12 12M18 6 6 18'] },
  'chevron-down': { paths: ['m6 9 6 6 6-6'] },
  indicators: { paths: ['M4 6h16M4 12h16M4 18h16'], circles: [[8,6,1.5],[15,12,1.5],[11,18,1.5]] },
  compare: { paths: ['M5 7h8M13 7l-2-2M13 7l-2 2M19 17h-8M11 17l2-2M11 17l2 2', 'M7 7v7M17 17v-7'] },
  layouts: { paths: ['M4 5h16v4H4zM4 12h7v7H4zM14 12h6v7h-6z'] },
  timeframe: { paths: ['M12 5a7 7 0 1 0 7 7', 'M12 8v4l3 2'] },
  reset: { paths: ['M19 8V4l-2 2a8 8 0 1 0 2 8', 'M19 4h-4'] },
  capture: { paths: ['M4 7h4l1.5-2h5L16 7h4v12H4z'], circles: [[12,13,3]] },
  expand: { paths: ['M9 4H4v5M15 4h5v5M20 15v5h-5M4 15v5h5', 'm4 9 5-5m6 0 5 5m0 6-5 5m-6 0-5-5'] },
  collapse: { paths: ['M4 9h5V4M20 9h-5V4M20 15h-5v5M4 15h5v5', 'm9 9-5-5m11 0 5 5m-5 6 5 5M9 15l-5 5'] },
  analysis: { paths: ['M3 15h3l2-6 3 10 3-14 2 10h6', 'M3 20h18'] },
  alert: { paths: ['M7 17h10l-1.5-2.5V10a3.5 3.5 0 0 0-7 0v4.5zM10 20h4'] },
  trash: { paths: ['M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13M10 11v5M14 11v5'] },
  pan: { paths: ['M8 11V6a1.5 1.5 0 0 1 3 0v4M11 10V5a1.5 1.5 0 0 1 3 0v5M14 10V6a1.5 1.5 0 0 1 3 0v7', 'M8 10 6.5 9a1.5 1.5 0 0 0-2 2l3.5 5a5 5 0 0 0 4 2h2a5 5 0 0 0 5-5v-2'] },
  select: { paths: ['M5 3l13 8-6 1.5L9 19z', 'M13 14l4 5'] },
  trendline: { paths: ['M4 18 19 5', 'M5 5v3M5 5h3M19 16v3M16 19h3'] },
  ray: { paths: ['M5 18 18 5', 'M13 5h5v5M5 18h.01'] },
  horizontal: { paths: ['M4 12h16', 'M7 9v6M17 9v6'] },
  vertical: { paths: ['M12 4v16', 'M9 7h6M9 17h6'] },
  rectangle: { paths: ['M5 6h14v12H5z', 'M5 9h2M17 15h2'] },
  measure: { paths: ['M5 19 19 5', 'M8 16l-2-2M11 13l-2-2M14 10l-2-2M17 7l-2-2'] },
  fibonacci: { paths: ['M4 6h16M4 10h16M4 14h16M4 18h16', 'M7 4v2M12 8v2M16 12v2M9 16v2'] },
  long: { paths: ['M5 17 10 12l3 3 6-8', 'M15 7h4v4M4 20h16'] },
  short: { paths: ['m5 7 5 5 3-3 6 8', 'M15 17h4v-4M4 20h16'] },
  oil: { paths: ['M8 5h8l1 4v10H7V9zM7 11h10', 'M10 14h4'] },
  gas: { paths: ['M12 3c3 4 5 6 5 10a5 5 0 1 1-10 0c0-2 1-5 5-10z', 'M10 16c0-2 1-3 3-5'] },
  fuel: { paths: ['M6 5h8v14H6zM8 8h4M14 9h2l2 3v4a2 2 0 0 0 2 2', 'M9 19v-3'] },
  gold: { paths: ['m5 10 3-4h8l3 4-3 8H8z', 'M5 10h14M9 6l3 4 3-4'] },
  silver: { paths: ['M12 4c4 0 7 3 7 7s-3 7-7 7a7 7 0 0 1 0-14z', 'M9 7c2 1 3 3 3 5s-1 4-3 5'] },
  copper: { circles: [[12,12,7]], paths: ['M8 9h8M8 15h8'] },
  aluminum: { paths: ['m12 4 7 15H5z', 'M9 13h6'] },
  platinum: { paths: ['M12 4v16M6 9h12', 'M8 5h8v8H8z'] },
  wheat: { paths: ['M12 20V5', 'M12 8 8 5M12 11 8 8M12 14l-4-3M12 8l4-3M12 11l4-3M12 14l4-3'] },
  corn: { paths: ['M12 4c4 2 5 5 4 10-1 4-3 6-5 0-4-3-4-7 0-4 3-7 8-9z', 'M8 7c2 2 2 6 1 10M15 6c-1 4-1 8 0 11'] },
  soy: { paths: ['M5 15c0-4 4-7 9-7 4 0 5 3 4 6-1 4-6 6-10 4-2-1-3-2-3-3z', 'M7 17c4-1 7-4 9-7'] },
  sugar: { paths: ['M7 5h10l2 5-7 9-7-9z', 'M7 10h12M10 5l2 5 2-5'] },
  coffee: { paths: ['M5 8h11v8H5zM16 10h2a2 2 0 0 1 0 4h-2M4 19h14', 'M8 5c0 1 1 1 1 2M12 5c0 1 1 1 1 2'] },
  cotton: { circles: [[8,13,3],[12,10,3],[16,13,3]], paths: ['M12 16v4M9 20h6'] },
  bitcoin: { paths: ['M12 3v18M8 7h5a2 2 0 0 1 0 4H8h6a2 2 0 0 1 0 4H8', 'M5 5h10a6 6 0 1 1 0 14H5'] },
  ethereum: { paths: ['m12 3 5 9-5 3-5-3zM12 21l5-7-5 3-5-3z'] },
  inflation: { paths: ['M4 19V5M4 19h16', 'm6 15 4-4 3 2 5-7', 'M18 6h2v2'] },
  growth: { paths: ['M4 19V5M4 19h16', 'M7 15v-3M11 15V8M15 15v-5M19 15V6'] },
  employment: { paths: ['M8 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM3 20v-3a5 5 0 0 1 10 0v3', 'M16 11h5v9h-5zM18 14h1'] },
  'central-bank': { paths: ['M4 9h16M6 9v8M10 9v8M14 9v8M18 9v8M4 20h16', 'm12 4 8 4H4z'] },
  trade: { paths: ['M4 12h13M14 8l4 4-4 4', 'M20 6v12'] },
  manufacturing: { paths: ['M4 20V10l5 3V8l5 3V5l6 4v11z', 'M8 20v-4M14 20v-4'] },
  consumer: { paths: ['M5 8h14l-1 11H6zM9 9V7a3 3 0 0 1 6 0v2'] },
  event: { paths: ['M5 5h14v15H5zM8 3v4M16 3v4M5 10h14', 'M9 14h6M9 17h3'] },
  'risk-shield': { paths: ['M12 3 19 6v5c0 5-3 8-7 10-4-2-7-5-7-10V6z', 'M9 12l2 2 4-5'] },
  calendar: { paths: ['M5 5h14v15H5zM8 3v4M16 3v4M5 10h14', 'M9 14h2M13 14h2'] },
  correlation: { paths: ['M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z', 'M10 7.5h4M7.5 10v4M16.5 10v4'] },
  'prop-firm': { paths: ['M6 20V10l6-6 6 6v10', 'M9 20v-5h6v5M10 9h4'] },
  settings: { paths: ['M5 7h14M5 17h14'], circles: [[9,7,2],[15,17,2]] },
  balance: { paths: ['M4 7h16v10H4zM4 10h16'], circles: [[16,14,1.5]] },
}

export function NexusIcon({ name, size = 16, strokeWidth = 1.6, className, style, title }: NexusIconProps) {
  const shape = ICONS[name]
  return (
    <svg className={className} style={style} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="square" strokeLinejoin="miter" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      {shape.paths?.map((d, index) => <path d={d} key={index} />)}
      {shape.circles?.map(([cx, cy, r], index) => <circle cx={cx} cy={cy} r={r} key={`c-${index}`} />)}
      {shape.rects?.map(([x, y, width, height, rx = 0], index) => <rect x={x} y={y} width={width} height={height} rx={rx} key={`r-${index}`} />)}
      {shape.lines?.map(([x1, y1, x2, y2], index) => <line x1={x1} y1={y1} x2={x2} y2={y2} key={`l-${index}`} />)}
    </svg>
  )
}

export function NexusBeacon({ tone = 'live', className }: { tone?: 'live' | 'delayed' | 'modelled' | 'verified'; className?: string }) {
  return <span className={`nx-beacon nx-beacon--${tone}${className ? ` ${className}` : ''}`} aria-label={tone} />
}
