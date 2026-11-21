export type SolverEvent = "initial" | "sample" | "best" | "final";

export interface SolverStep {
  readonly iter: number;
  readonly state: readonly number[];
  readonly energy: number;
  readonly bestEnergy: number;
  readonly flipped: number | null;
  readonly deltaE: number | null;
  readonly temperature: number | null;
  readonly accepted: boolean | null;
  readonly tabu: readonly number[] | null;
  readonly event: SolverEvent;
}

export interface SolverProgress {
  readonly completed: number;
  readonly total: number;
  readonly bestEnergy: number;
}

export interface SolverResult {
  readonly solution: readonly number[];
  readonly energy: number;
  readonly executionTimeMs: number;
  readonly isCorrect: boolean | null;
  readonly hammingDistance: number | null;
  readonly extraInfo: Readonly<Record<string, number | string | boolean>>;
  readonly trace: readonly SolverStep[];
}

export interface SolverRuntimeOptions {
  readonly seed?: number;
  readonly trueSecret?: readonly number[];
  readonly traceLimit?: number;
  readonly yieldEvery?: number;
  readonly shouldCancel?: () => boolean;
  readonly yieldControl?: () => Promise<void>;
  readonly onProgress?: (progress: SolverProgress) => void;
  readonly onStep?: (step: SolverStep) => void;
}

export interface SolverProgressContext extends SolverRuntimeOptions {
  readonly totalIterations: number;
}

export class SolverCancelledError extends Error {
  constructor() {
    super("Solver run was cancelled");
    this.name = "SolverCancelledError";
  }
}
