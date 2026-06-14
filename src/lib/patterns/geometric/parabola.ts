// Quadratic (parabola) least-squares fit — the shape test behind cup & handle
// and rounding bottoms. A positive leading coefficient means a "bowl".

export interface ParabolaFit { a: number; b: number; c: number; r2: number }

/** Fit y = a·x² + b·x + c over x = 0..n-1 (normalised), returning R². */
export function fitParabola(y: number[]): ParabolaFit | null {
  const n = y.length
  if (n < 5) return null
  // Normalise x to 0..1 for numerical stability.
  const xs = y.map((_, i) => i / (n - 1))
  let Sx = 0, Sx2 = 0, Sx3 = 0, Sx4 = 0, Sy = 0, Sxy = 0, Sx2y = 0
  for (let i = 0; i < n; i++) {
    const x = xs[i], x2 = x * x
    Sx += x; Sx2 += x2; Sx3 += x2 * x; Sx4 += x2 * x2
    Sy += y[i]; Sxy += x * y[i]; Sx2y += x2 * y[i]
  }
  // Solve the 3×3 normal-equation system via Cramer's rule.
  const m = [
    [Sx4, Sx3, Sx2],
    [Sx3, Sx2, Sx],
    [Sx2, Sx, n],
  ]
  const rhs = [Sx2y, Sxy, Sy]
  const det3 = (a: number[][]) =>
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1])
    - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
    + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
  const D = det3(m)
  if (Math.abs(D) < 1e-12) return null
  const replace = (col: number) => m.map((row, r) => row.map((v, cc) => (cc === col ? rhs[r] : v)))
  const a = det3(replace(0)) / D
  const b = det3(replace(1)) / D
  const c = det3(replace(2)) / D

  const mean = Sy / n
  let ssTot = 0, ssRes = 0
  for (let i = 0; i < n; i++) {
    const pred = a * xs[i] * xs[i] + b * xs[i] + c
    ssRes += (y[i] - pred) ** 2
    ssTot += (y[i] - mean) ** 2
  }
  const r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot)
  return { a, b, c, r2 }
}
