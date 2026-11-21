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

export interface SimulatedAnnealingConfig {
  readonly numSweeps?: number;
  readonly numReads?: number;
  readonly startTemperature?: number;
  readonly endTemperature?: number;
}

export type SimulatedAnnealingOptions = SolverRuntimeOptions;

export class SimulatedAnnealingSolver {
  private readonly numSweeps: number;
  private readonly numReads: number;
  private readonly startTemperature: number;
  private readonly endTemperature: number;

  constructor(config: SimulatedAnnealingConfig = {}) {
    this.numSweeps = config.numSweeps ?? 1000;
    this.numReads = config.numReads ?? 100;
    this.startTemperature = config.startTemperature ?? 4;
    this.endTemperature = config.endTemperature ?? 0.01;
    validatePositiveInteger(this.numSweeps, "numSweeps");
    validatePositiveInteger(this.numReads, "numReads");
    if (
      !Number.isFinite(this.startTemperature) ||
      !Number.isFinite(this.endTemperature) ||
      this.startTemperature <= 0 ||
      this.endTemperature <= 0 ||
      this.endTemperature > this.startTemperature
    ) {
      throw new RangeError(
        "temperatures must be finite, positive, and endTemperature <= startTemperature",
      );
    }
  }

  async solve(
    qubo: QUBO,
    options: SimulatedAnnealingOptions = {},
  ): Promise<SolverResult> {
    const seed = resolveSeed(options.seed);
    const random = new SeededRandom(seed);
    const total = this.numReads * this.numSweeps;
    if (!Number.isSafeInteger(total)) {
      throw new RangeError("simulated-annealing iteration count is too large");
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
    let completed = 0;
    const yieldEvery = options.yieldEvery ?? 256;

    for (let read = 0; read < this.numReads; read += 1) {
      const state = Array.from({ length: qubo.size }, () => random.bit());
      let energy = qubo.energy(state);
      const improved = energy < bestEnergy;
      if (improved) {
        bestEnergy = energy;
        bestState = [...state];
      }
      trace.record(
        {
          iter: completed,
          state,
          energy,
          bestEnergy,
          flipped: null,
          deltaE: null,
          temperature: this.startTemperature,
          accepted: null,
          tabu: null,
        },
        improved,
      );

      for (let sweep = 0; sweep < this.numSweeps; sweep += 1) {
        checkCancellation(context);
        const flipped = random.integer(0, qubo.size - 1);
        const deltaE = flippedEnergyDelta(qubo, state, flipped);
        const fraction =
          this.numSweeps === 1 ? 1 : sweep / (this.numSweeps - 1);
        const temperature =
          this.startTemperature *
          (this.endTemperature / this.startTemperature) ** fraction;
        const accepted =
          deltaE <= 0 || random.next() < Math.exp(-deltaE / temperature);
        if (accepted) {
          state[flipped] = 1 - (state[flipped] ?? 0);
          energy += deltaE;
        }
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
            flipped,
            deltaE,
            temperature,
            accepted,
            tabu: null,
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
        temperature: this.endTemperature,
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
      { numReads: this.numReads, numSweeps: this.numSweeps, seed },
      trace,
    );
  }
}
