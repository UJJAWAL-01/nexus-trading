import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { isValidSymbol } from '@/lib/providers/symbols'

// Portfolio positions. Stored only in this browser (localStorage key
// "nexus-portfolio"); nothing is sent to a server. Use workspace backup or CSV
// export to move it between devices.

export interface Position {
  id:      string
  symbol:  string
  qty:     number
  avgCost: number
  addedAt: number
}

export const MAX_POSITIONS = 200

export interface PositionInput { symbol: string; qty: number; avgCost: number }

/** Normalise + validate one position. Returns null when it is not acceptable. */
export function sanitizePosition(input: { symbol: unknown; qty: unknown; avgCost: unknown }): PositionInput | null {
  const symbol  = typeof input.symbol === 'string' ? input.symbol.trim().toUpperCase() : ''
  const qty     = typeof input.qty === 'number' ? input.qty : Number(input.qty)
  const avgCost = typeof input.avgCost === 'number' ? input.avgCost : Number(input.avgCost)
  if (!isValidSymbol(symbol)) return null
  if (!Number.isFinite(qty) || qty === 0 || Math.abs(qty) > 1e12) return null
  if (!Number.isFinite(avgCost) || avgCost < 0 || avgCost > 1e12) return null
  return { symbol, qty, avgCost }
}

interface PortfolioStore {
  positions: Position[]
  /** Adds a position, or merges into an existing one at the weighted-average cost. */
  upsert:    (input: PositionInput) => boolean
  remove:    (id: string) => void
  /** Replace everything (CSV import). Returns the number of positions kept. */
  replaceAll: (inputs: PositionInput[]) => number
  clear:     () => void
}

const newId = () => `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

function merge(positions: Position[], input: PositionInput): Position[] {
  const existing = positions.find(p => p.symbol === input.symbol)
  if (!existing) {
    if (positions.length >= MAX_POSITIONS) return positions
    return [...positions, { id: newId(), ...input, addedAt: Date.now() }]
  }
  const qty = existing.qty + input.qty
  if (qty === 0) return positions.filter(p => p.id !== existing.id)
  // Weighted average only makes sense when adding in the same direction;
  // when reducing a position the cost basis of what remains is unchanged.
  const sameDirection = Math.sign(existing.qty) === Math.sign(input.qty)
  const avgCost = sameDirection
    ? (existing.qty * existing.avgCost + input.qty * input.avgCost) / qty
    : existing.avgCost
  return positions.map(p => (p.id === existing.id ? { ...p, qty, avgCost } : p))
}

export const usePortfolio = create<PortfolioStore>()(
  persist(
    (set, get) => ({
      positions: [],
      upsert: (input) => {
        const clean = sanitizePosition(input)
        if (!clean) return false
        const before = get().positions
        const after  = merge(before, clean)
        if (after === before) return false
        set({ positions: after })
        return true
      },
      remove: (id) => set(state => ({ positions: state.positions.filter(p => p.id !== id) })),
      replaceAll: (inputs) => {
        let positions: Position[] = []
        for (const raw of inputs) {
          const clean = sanitizePosition(raw)
          if (clean) positions = merge(positions, clean)
        }
        set({ positions })
        return positions.length
      },
      clear: () => set({ positions: [] }),
    }),
    { name: 'nexus-portfolio', version: 1 },
  ),
)

// ── P&L maths (pure, unit-tested) ────────────────────────────────────────────

export interface PositionPnl {
  marketValue:   number | null
  costBasis:     number
  unrealized:    number | null
  unrealizedPct: number | null
  dayChange:     number | null
}

export function positionPnl(p: Pick<Position, 'qty' | 'avgCost'>, price: number | null, changeAbs: number | null): PositionPnl {
  const costBasis = p.qty * p.avgCost
  if (price === null || !Number.isFinite(price)) {
    return { marketValue: null, costBasis, unrealized: null, unrealizedPct: null, dayChange: null }
  }
  const marketValue = p.qty * price
  const unrealized  = marketValue - costBasis
  return {
    marketValue,
    costBasis,
    unrealized,
    unrealizedPct: costBasis !== 0 ? (unrealized / Math.abs(costBasis)) * 100 : null,
    dayChange:     changeAbs !== null && Number.isFinite(changeAbs) ? p.qty * changeAbs : null,
  }
}
