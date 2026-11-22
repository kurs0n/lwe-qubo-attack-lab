import { QUBO } from "../qubo/converter";
import {
  buildSolverResult,
  checkCancellation,
  createProgressContext,
  now,
  TraceCollector,
  validateTrueSecret,
} from "./common";
import type {
  SolverProgressContext,
  SolverResult,
  SolverRuntimeOptions,
} from "./types";

export type BruteForceOptions = Omit<SolverRuntimeOptions, "seed">;

export class BruteForceSolver {
  async solve(
    qubo: QUBO,
    options: BruteForceOptions = {},
  ): Promise<SolverResult> {
    if (qubo.size > 16) {
      throw new RangeError("brute force supports at most 16 variables");
    }
    const total = 2 ** qubo.size;
    if (!Number.isSafeInteger(total)) {
      throw new RangeError("brute-force state count exceeds the safe integer range");
    }
    const context: SolverProgressContext = {
      ...options,
      totalIterations: total,
    };
    const progress = createProgressContext(context);
    const started = now();
    const trueSecret = validateTrueSecret(qubo, options.trueSecret);
    const trace = new TraceCollector(
      total,
      options.traceLimit ?? 2048,
      options.onStep,
    );
    let bestState: number[] = [];
    let bestEnergy = Number.POSITIVE_INFINITY;
    let lastEnergy = Number.POSITIVE_INFINITY;
    const yieldEvery = options.yieldEvery ?? 256;

    for (let candidate = 0; candidate < total; candidate += 1) {
      if (candidate % yieldEvery === 0) {
        checkCancellation(context);
      }
      const state = Array.from(
        { length: qubo.size },
        (_, index) => Math.floor(candidate / 2 ** index) % 2,
      );
      const energy = qubo.energy(state);
      const improved = energy < bestEnergy;
      if (improved) {
        bestEnergy = energy;
        bestState = state;
      }
      trace.record(
        {
          iter: candidate,
          state,
          energy,
          bestEnergy,
          flipped: null,
          deltaE: null,
          temperature: null,
          accepted: null,
          tabu: null,
          read: null,
        },
        candidate === total - 1
          ? "final"
          : candidate === 0
            ? "initial"
            : improved
              ? "best"
              : undefined,
      );
      lastEnergy = energy;
      if ((candidate + 1) % yieldEvery === 0 || candidate === total - 1) {
        progress.report(candidate + 1, bestEnergy);
      }
      const yieldTask = progress.yieldIfNeeded(candidate + 1);
      if (yieldTask !== undefined) {
        await yieldTask;
      }
    }

    if (lastEnergy === Number.POSITIVE_INFINITY) {
      throw new Error("Brute-force search evaluated no candidates");
    }
    return buildSolverResult(
      qubo,
      bestState,
      now() - started,
      trueSecret,
      { statesEvaluated: total },
      trace,
    );
  }
}
