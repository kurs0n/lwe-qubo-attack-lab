/**
 * Typed REST client contracts matching AGENTS.md backend endpoints:
 *   - POST /api/lwe/generate
 *   - POST /api/qubo/convert
 *   - POST /api/qubo/export
 *   - POST /api/solvers/run
 *   - POST /api/benchmark/batch
 */

export type QuboRepresentation = 'upper_triangular' | 'symmetric'

export type SolverKind =
  | 'brute_force'
  | 'simulated_annealing'
  | 'tabu_search'
  | 'qaoa'

export interface LweGenerateRequest {
  n: number
  m: number
  noise_bound: number
  seed?: number
}

export interface LweInstanceDto {
  n: number
  m: number
  A: number[][]
  b: number[]
  secret: number[]
  error: number[]
  seed?: number
}

export interface QuboConvertRequest {
  A: number[][]
  b: number[]
  representation?: QuboRepresentation
}

export interface QuboMatrixDto {
  Q: number[][]
  offset: number
  representation: QuboRepresentation
}

export interface SolverRunRequest {
  Q: number[][]
  offset: number
  solver: SolverKind
  true_secret?: number[]
  params?: Record<string, number | string | boolean>
}

export interface SolverResultDto {
  solution: number[]
  energy: number
  execution_time_ms: number
  is_correct: boolean | null
  hamming_distance: number | null
  extra_info: Record<string, unknown>
}

const API_BASE = '/api'

async function postJson<TResponse>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<TResponse> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || `API request failed (${response.status})`)
  }

  return (await response.json()) as TResponse
}

export const api = {
  generateLwe: (payload: LweGenerateRequest, signal?: AbortSignal) =>
    postJson<LweInstanceDto>('/lwe/generate', payload, signal),

  convertToQubo: (payload: QuboConvertRequest, signal?: AbortSignal) =>
    postJson<QuboMatrixDto>('/qubo/convert', payload, signal),

  runSolver: (payload: SolverRunRequest, signal?: AbortSignal) =>
    postJson<SolverResultDto>('/solvers/run', payload, signal),
}
