import { QUBO } from "../qubo/converter";
import type {
  SolverProgressContext,
  SolverResult,
  SolverStep,
} from "./types";
import { SolverCancelledError } from "./types";

export function validateTrueSecret(
  qubo: QUBO,
  secret: readonly number[] | undefined,
): readonly number[] | null {
  if (secret === undefined) {
    return null;
  }
  if (!Array.isArray(secret) || secret.length !== qubo.size) {
    throw new RangeError(`trueSecret must have length ${qubo.size}`);
  }
  if (secret.some((bit) => bit !== 0 && bit !== 1)) {
    throw new TypeError("trueSecret must contain only 0 or 1");
  }
  return secret;
}

export function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

export function checkCancellation(
  options: SolverProgressContext,
): void {
  if (options.shouldCancel?.()) {
    throw new SolverCancelledError();
  }
}

export function createProgressContext(
  options: SolverProgressContext,
): {
  readonly report: (completed: number, bestEnergy: number) => void;
  readonly yieldIfNeeded: (completed: number) => Promise<void> | undefined;
} {
  const yieldEvery = options.yieldEvery ?? 256;
  validatePositiveInteger(yieldEvery, "yieldEvery");
  return {
    report: (completed, bestEnergy) => {
      options.onProgress?.({
        completed,
        total: options.totalIterations,
        bestEnergy,
      });
    },
    yieldIfNeeded: (completed) => {
      if (completed % yieldEvery === 0 && options.yieldControl !== undefined) {
        return options.yieldControl().then(() => checkCancellation(options));
      }
    },
  };
}

export class TraceCollector {
  private readonly steps: SolverStep[] = [];
  private readonly stride: number;

  constructor(
    private readonly total: number,
    limit: number,
    private readonly onStep?: (step: SolverStep) => void,
  ) {
    validatePositiveInteger(limit, "traceLimit");
    this.stride = Math.max(1, Math.ceil(total / Math.max(1, limit - 1)));
  }

  record(
    step: Omit<SolverStep, "event">,
    important = false,
    final = false,
  ): void {
    if (!important && !final && step.iter % this.stride !== 0) {
      return;
    }
    const fullStep: SolverStep = {
      ...step,
      event: final
        ? "final"
        : step.iter === 0
          ? "initial"
          : important
            ? "best"
            : "sample",
      state: Object.freeze([...step.state]),
      tabu: step.tabu === null ? null : Object.freeze([...step.tabu]),
    };
    const previous = this.steps.at(-1);
    if (previous?.iter === fullStep.iter) {
      this.steps[this.steps.length - 1] = fullStep;
    } else {
      this.steps.push(fullStep);
    }
    this.onStep?.(fullStep);
  }

  snapshot(): readonly SolverStep[] {
    return Object.freeze([...this.steps]);
  }
}

export function buildSolverResult(
  qubo: QUBO,
  solution: readonly number[],
  executionTimeMs: number,
  trueSecret: readonly number[] | null,
  extraInfo: Record<string, number | string | boolean>,
  trace: TraceCollector,
): SolverResult {
  const frozenSolution = Object.freeze([...solution]);
  const hammingDistance =
    trueSecret === null
      ? null
      : frozenSolution.reduce(
          (distance, bit, index) =>
            distance + (bit === (trueSecret[index] ?? 0) ? 0 : 1),
          0,
        );
  return Object.freeze({
    solution: frozenSolution,
    energy: qubo.energy(frozenSolution),
    executionTimeMs,
    isCorrect: hammingDistance === null ? null : hammingDistance === 0,
    hammingDistance,
    extraInfo: Object.freeze({ ...extraInfo }),
    trace: trace.snapshot(),
  });
}

export function now(): number {
  return performance.now();
}
