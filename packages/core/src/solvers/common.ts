import { QUBO } from "../qubo/converter";
import type {
  SolverEvent,
  SolverProgressContext,
  SolverResult,
  SolverStep,
} from "./types";
import { SolverCancelledError } from "./types";

export function validateBinaryVector(
  vector: readonly number[],
  size: number,
  name: string,
): readonly number[] {
  if (!Array.isArray(vector) || vector.length !== size) {
    throw new RangeError(`${name} must have length ${size}`);
  }
  if (vector.some((bit) => bit !== 0 && bit !== 1)) {
    throw new TypeError(`${name} must contain only 0 or 1`);
  }
  return vector;
}

export function validateTrueSecret(
  qubo: QUBO,
  secret: readonly number[] | undefined,
): readonly number[] | null {
  if (secret === undefined) {
    return null;
  }
  return validateBinaryVector(secret, qubo.size, "trueSecret");
}

export function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

export function hammingDistance(
  left: readonly number[],
  right: readonly number[],
): number {
  return left.reduce(
    (distance, bit, index) => distance + (bit === (right[index] ?? 0) ? 0 : 1),
    0,
  );
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

/** Events that are always kept in a trace, regardless of downsampling. */
export type TraceEvent = Exclude<SolverEvent, "sample">;

/**
 * Collects a downsampled solver trace.
 *
 * Regular steps are kept every `stride` iterations. Steps recorded with an
 * explicit event (best-so-far improvements, read boundaries, final state) are
 * always kept. If the result still exceeds `limit`, regular samples are thinned
 * evenly so the trace fits while every meaningful event survives.
 */
export class TraceCollector {
  private readonly steps: SolverStep[] = [];
  private readonly stride: number;

  constructor(
    private readonly total: number,
    private readonly limit: number,
    private readonly onStep?: (step: SolverStep) => void,
  ) {
    validatePositiveInteger(limit, "traceLimit");
    this.stride = Math.max(1, Math.ceil(total / Math.max(1, limit - 1)));
  }

  record(step: Omit<SolverStep, "event">, event?: TraceEvent): void {
    if (event === undefined && step.iter % this.stride !== 0) {
      return;
    }
    const fullStep: SolverStep = {
      ...step,
      event: event ?? (step.iter === 0 ? "initial" : "sample"),
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
    if (this.steps.length <= this.limit) {
      return Object.freeze([...this.steps]);
    }
    const samples = this.steps.filter((step) => step.event === "sample");
    const budget = Math.max(
      0,
      this.limit - (this.steps.length - samples.length),
    );
    const keep = new Set<SolverStep>();
    for (let index = 0; index < budget; index += 1) {
      const sample = samples[Math.floor((index * samples.length) / budget)];
      if (sample !== undefined) {
        keep.add(sample);
      }
    }
    return Object.freeze(
      this.steps.filter((step) => step.event !== "sample" || keep.has(step)),
    );
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
  const distance =
    trueSecret === null ? null : hammingDistance(frozenSolution, trueSecret);
  return Object.freeze({
    solution: frozenSolution,
    energy: qubo.energy(frozenSolution),
    executionTimeMs,
    isCorrect: distance === null ? null : distance === 0,
    hammingDistance: distance,
    extraInfo: Object.freeze({ ...extraInfo }),
    trace: trace.snapshot(),
  });
}

export function now(): number {
  return performance.now();
}
