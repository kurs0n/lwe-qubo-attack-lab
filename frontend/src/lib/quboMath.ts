export type QuboRepresentation = 'upper_triangular' | 'symmetric'

export interface QuboComputation {
  Q: number[][]
  offset: number
  maxAbs: number
}

/**
 * Exact LWE -> QUBO reduction per AGENTS.md Section 3:
 *   min_{s in {0,1}^n} ||As - b||^2 = s^T Q s + b^T b
 *
 * - Diagonal: Q_ii = (A^T A)_ii - 2 (A^T b)_i
 * - Upper-triangular (i < j): Q_ij = 2 (A^T A)_ij, Q_ji = 0
 * - Symmetric (i != j):       Q_ij = (A^T A)_ij
 */
export function computeQubo(
  A: readonly (readonly number[])[],
  b: readonly number[],
  representation: QuboRepresentation = 'upper_triangular',
): QuboComputation {
  const m = A.length
  const n = A[0]?.length ?? 0

  const ata: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(0))
  const atb: number[] = Array<number>(n).fill(0)

  for (let r = 0; r < m; r++) {
    const row = A[r]
    for (let i = 0; i < n; i++) {
      atb[i] += row[i] * b[r]
      for (let j = 0; j < n; j++) {
        ata[i][j] += row[i] * row[j]
      }
    }
  }

  const Q: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(0))
  let maxAbs = 0

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let val: number
      if (i === j) {
        val = ata[i][i] - 2 * atb[i]
      } else if (representation === 'upper_triangular') {
        val = i < j ? 2 * ata[i][j] : 0
      } else {
        val = ata[i][j]
      }
      Q[i][j] = val
      if (Math.abs(val) > maxAbs) maxAbs = Math.abs(val)
    }
  }

  const offset = b.reduce((acc, bi) => acc + bi * bi, 0)
  return { Q, offset, maxAbs: maxAbs || 1 }
}

export function multiplyMatVec(
  A: readonly (readonly number[])[],
  v: readonly number[],
): number[] {
  return A.map((row) => row.reduce((acc, val, idx) => acc + val * v[idx], 0))
}

export function evaluateQuboEnergy(
  Q: readonly (readonly number[])[],
  offset: number,
  candidate: readonly number[],
): number {
  const n = candidate.length
  let quad = 0
  for (let i = 0; i < n; i++) {
    if (candidate[i] === 0) continue
    for (let j = 0; j < n; j++) {
      if (candidate[j] === 0) continue
      quad += Q[i][j]
    }
  }
  return quad + offset
}

export function hammingDistance(a: readonly number[], b: readonly number[]): number {
  let dist = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) dist += 1
  }
  return dist
}
