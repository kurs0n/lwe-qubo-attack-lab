import type { Layout } from 'plotly.js-dist-min'

export interface ColorSwatchSpec {
  name: string
  role: string
  lightHex: string
  darkHex: string
  cssVar: string
  softVar?: string
  borderVar?: string
}

/**
 * Quantum Teal — Locked Semantic Domain Palette
 * Follows a 90/10 neutral-to-accent ratio with 3-part diagram chip tokens.
 */
export const SEMANTIC_SWATCHES: readonly ColorSwatchSpec[] = [
  {
    name: 'Brand / Secret Key s',
    role: 'Active secret bits, primary interactive controls, SA solver accent',
    lightHex: '#0D7A6F',
    darkHex: '#2DD4BF',
    cssVar: '--accent-brand',
    softVar: '--accent-brand-soft',
    borderVar: '--accent-brand-border',
  },
  {
    name: 'QUBO Negative (Qᵢⱼ < 0)',
    role: 'Favorable diagonal bias & attractive spin couplings',
    lightHex: '#0F6CBD',
    darkHex: '#38BDF8',
    cssVar: '--qubo-negative',
    softVar: '--qubo-negative-soft',
    borderVar: '--qubo-negative-border',
  },
  {
    name: 'QUBO Positive (Qᵢⱼ > 0)',
    role: 'Quadratic energy penalties & conflicting bit pairs',
    lightHex: '#D64045',
    darkHex: '#FB7185',
    cssVar: '--qubo-positive',
    softVar: '--qubo-positive-soft',
    borderVar: '--qubo-positive-border',
  },
  {
    name: 'Noise Vector e',
    role: 'Bounded LWE error perturbations & noise sweep alerts',
    lightHex: '#C77700',
    darkHex: '#FBBF24',
    cssVar: '--noise-accent',
    softVar: '--noise-soft',
    borderVar: '--noise-border',
  },
  {
    name: 'Optimal / Exact Recovery',
    role: 'Global energy minimum & Hamming distance d_H = 0 match',
    lightHex: '#15803D',
    darkHex: '#4ADE80',
    cssVar: '--optimal-accent',
    softVar: '--optimal-soft',
    borderVar: '--optimal-border',
  },
  {
    name: 'Tabu Search Series',
    role: 'Distinct solver series color in benchmarks & comparisons',
    lightHex: '#6D4AFF',
    darkHex: '#A78BFA',
    cssVar: '--solver-tabu',
  },
] as const

export const SOLVER_COLORS = {
  light: {
    bruteForce: '#0F1722',
    simulatedAnnealing: '#0D7A6F',
    tabuSearch: '#6D4AFF',
    qaoa: '#C026D3',
  },
  dark: {
    bruteForce: '#E2E8F0',
    simulatedAnnealing: '#2DD4BF',
    tabuSearch: '#A78BFA',
    qaoa: '#E879F9',
  },
} as const

/**
 * Diverging colorscale centered at 0 for QUBO matrix heatmaps.
 * Cobalt Blue (negative weights) -> Neutral Paper/Slate (0) -> Coral Red (positive penalties).
 */
export function getQuboColorscale(isDark: boolean): Array<[number, string]> {
  if (isDark) {
    return [
      [0.0, '#0369a1'],
      [0.25, '#38bdf8'],
      [0.5, '#16202a'],
      [0.75, '#fb7185'],
      [1.0, '#be123c'],
    ]
  }
  return [
    [0.0, '#0a4d8c'],
    [0.25, '#4da3e8'],
    [0.5, '#f4f6f8'],
    [0.75, '#ef7b7f'],
    [1.0, '#b52329'],
  ]
}

export function getPlotlyLayoutDefaults(isDark: boolean): Partial<Layout> {
  const monoFont = '"JetBrains Mono", ui-monospace, monospace'
  const ink = isDark ? '#ecf3f9' : '#0f1722'
  const muted = isDark ? '#8ea1b5' : '#5b6a7d'
  const grid = isDark ? 'rgba(236, 243, 249, 0.08)' : 'rgba(15, 23, 34, 0.08)'
  const hoverBg = isDark ? '#18222d' : '#0f1722'

  return {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: {
      family: monoFont,
      size: 12,
      color: ink,
    },
    margin: { t: 28, r: 24, b: 44, l: 48 },
    hoverlabel: {
      bgcolor: hoverBg,
      bordercolor: hoverBg,
      font: {
        family: monoFont,
        size: 12,
        color: '#f8fafc',
      },
    },
    xaxis: {
      gridcolor: grid,
      zerolinecolor: grid,
      tickfont: { color: muted, family: monoFont, size: 12 },
    },
    yaxis: {
      gridcolor: grid,
      zerolinecolor: grid,
      tickfont: { color: muted, family: monoFont, size: 12 },
    },
  }
}
