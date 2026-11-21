import { resolveSeed, SeededRandom } from "../random/seeded-random";
import { QUBO } from "../qubo/converter";
import {
  buildSolverResult,
  checkCancellation,
  createProgressContext,
  flippedEnergyDelta,
  now,
  TraceCollector,
  validatePositiveInteger,
  validateTrueSecret,
} from "./common";
import type {
  SolverProgressContext,
  SolverResult,
  SolverRuntimeOptions,
} from "./types";

export interface TabuSearchConfig {
  readonly numRestarts?: number;
  readonly maxIterations?: number;
  readonly tenure?: number;
}

export type TabuSearchOptions = SolverRuntimeOptions;

export class TabuSearchSolver {
  private readonly numRestarts: number;
  private readonly maxIterations: number;
  private readonly tenure: number | undefined;

  constructor(config: TabuSearchConfig = {}) {
    this.numRestarts = config.numRestarts ?? 100;
    this.maxIterations = config.maxIterations ?? 500;
    this.tenure = config.tenure;
    validatePositiveInteger(this.numRestarts, "numRestarts");
    validatePositiveInteger(this.maxIterations, "maxIterations");
    if (this.tenure !== undefined) {
      validatePositiveInteger(this.tenure, "tenure");
    }
  }

  async solve(
    qubo: QUBO,
    options: TabuSearchOptions = {},
  ): Promise<SolverResult> {
    const seed = resolveSeed(options.seed);
    const random = new SeededRandom(seed);
    const total = this.numRestarts * this.maxIterations;
    if (!Number.isSafeInteger(total)) {
      throw new RangeError("tabu-search iteration count is too large");
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
    const tenure = this.tenure ?? Math.max(1, Math.floor(qubo.size / 2));
    let bestState: number[] = [];
    let bestEnergy = Number.POSITIVE_INFINITY;
    let completed = 0;
    const yieldEvery = options.yieldEvery ?? 256;

    for (let restart = 0; restart < this.numRestarts; restart += 1) {
      const state = Array.from({ length: qubo.size }, () => random.bit());
      let energy = qubo.energy(state);
      const tabuUntil = Array<number>(qubo.size).fill(0);
      if (energy < bestEnergy) {
        bestEnergy = energy;
        bestState = [...state];
      }

      for (let iteration = 0; iteration < this.maxIterations; iteration += 1) {
        checkCancellation(context);
        const nextIteration = iteration + 1;
        let selected = -1;
        let selectedDelta = Number.POSITIVE_INFINITY;
        for (let variable = 0; variable < qubo.size; variable += 1) {
          const delta = flippedEnergyDelta(qubo, state, variable);
          const candidateEnergy = energy + delta;
          const isTabu = (tabuUntil[variable] ?? 0) > iteration;
          const aspiration = candidateEnergy < bestEnergy;
          if (!isTabu || aspiration) {
            if (delta < selectedDelta) {
              selected = variable;
              selectedDelta = delta;
            }
          }
        }

        if (selected === -1) {
          for (let variable = 0; variable < qubo.size; variable += 1) {
            const delta = flippedEnergyDelta(qubo, state, variable);
            if (delta < selectedDelta) {
              selected = variable;
              selectedDelta = delta;
            }
          }
        }
        if (selected < 0) {
          throw new Error("Tabu search could not select a variable to flip");
        }

        state[selected] = 1 - (state[selected] ?? 0);
        energy += selectedDelta;
        tabuUntil[selected] = nextIteration + tenure;
        const improved = energy < bestEnergy;
        if (improved) {
          bestEnergy = energy;
          bestState = [...state];
        }
        completed += 1;
        trace.record(
          {
            iter: completed,
            state,
            energy,
            bestEnergy,
            flipped: selected,
            deltaE: selectedDelta,
            temperature: null,
            accepted: true,
            tabu: tabuUntil.flatMap((expiry, index) =>
              expiry > nextIteration ? [index] : [],
            ),
          },
          improved,
        );
        if (completed % yieldEvery === 0 || completed === total) {
          progress.report(completed, bestEnergy);
        }
        const yieldTask = progress.yieldIfNeeded(completed);
        if (yieldTask !== undefined) {
          await yieldTask;
        }
      }
    }

    trace.record(
      {
        iter: completed,
        state: bestState,
        energy: bestEnergy,
        bestEnergy,
        flipped: null,
        deltaE: null,
        temperature: null,
        accepted: null,
        tabu: null,
      },
      false,
      true,
    );
    return buildSolverResult(
      qubo,
      bestState,
      now() - started,
      trueSecret,
      {
        numRestarts: this.numRestarts,
        maxIterations: this.maxIterations,
        tenure,
        seed,
      },
      trace,
    );
  }
}
