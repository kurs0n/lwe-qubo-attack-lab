import { QUBO } from "../qubo/converter";
import { resolveSeed, SeededRandom } from "../random/seeded-random";
import { flipCoefficients } from "./annealing-schedule";
import {
  buildSolverResult,
  checkCancellation,
  createProgressContext,
  hammingDistance,
  now,
  TraceCollector,
  validatePositiveInteger,
  validateTrueSecret,
  type TraceEvent,
} from "./common";
import type {
  SolverProgressContext,
  SolverResult,
  SolverRuntimeOptions,
} from "./types";

/** Parameters of the tabu search algorithm. */
export interface TabuSearchParameters {
  /**
   * Number of moves per read; one move = choosing and applying the best
   * non-tabu single-bit flip across all variables (default 1000).
   */
  readonly numIterations?: number;
  /**
   * How many subsequent moves a flipped variable is forbidden from being
   * flipped again (default: `floor(sqrt(n))`).
   */
  readonly tenure?: number;
}

export interface TabuSearchOptions
  extends SolverRuntimeOptions,
    TabuSearchParameters {
  /** Independent restarts from random states (default 1). */
  readonly numReads?: number;
}

/** Outcome of one independent read. */
export interface TabuSample {
  readonly read: number;
  /** State at the end of the read. */
  readonly state: readonly number[];
  readonly energy: number;
  /** Lowest-energy state visited during the read (may beat `state`). */
  readonly bestSeenState: readonly number[];
  readonly bestSeenEnergy: number;
  readonly isCorrect: boolean | null;
  readonly hammingDistance: number | null;
}

export interface TabuSearchResult extends SolverResult {
  /** One entry per read, sorted by final energy (ties by read index). */
  readonly samples: readonly TabuSample[];
}

function resolveTabuTenure(n: number, tenure?: number): number {
  if (tenure === undefined) {
    return Math.max(1, Math.floor(Math.sqrt(n)));
  }
  return tenure;
}

function randomState(random: SeededRandom, size: number): number[] {
  return Array.from({ length: size }, () => random.bit());
}

/** Independent, deterministic random stream for each read of a run. */
function readRandom(seed: number, read: number): SeededRandom {
  const mixed = (seed + Math.imul(read, 0x9e37_79b9)) >>> 0;
  return new SeededRandom(new SeededRandom(mixed).nextUint32());
}

/**
 * Tabu search for QUBO problems.
 *
 * Each of `numReads` independent reads starts from a random binary state.
 * At every step, all single-bit flips are evaluated and the best non-tabu
 * one is selected. A flipped variable is added to the tabu list for `tenure`
 * subsequent steps. An aspiration criterion overrides the tabu restriction
 * when accepting a move would produce a new global best energy.
 *
 * The reported `solution` is the lowest-energy state seen across reads.
 * Results are reproducible for a given seed.
 */
export class TabuSearchSolver {
  async solve(
    qubo: QUBO,
    options: TabuSearchOptions = {},
  ): Promise<TabuSearchResult> {
    const numReads = options.numReads ?? 1;
    validatePositiveInteger(numReads, "numReads");
    const numIterations = options.numIterations ?? 1000;
    validatePositiveInteger(numIterations, "numIterations");
    if (options.tenure !== undefined) {
      validatePositiveInteger(options.tenure, "tenure");
    }
    const tenure = resolveTabuTenure(qubo.size, options.tenure);
    const seed = resolveSeed(options.seed);
    const trueSecret = validateTrueSecret(qubo, options.trueSecret);

    const totalIterations = numReads * numIterations;
    if (!Number.isSafeInteger(totalIterations)) {
      throw new RangeError("tabu search run length exceeds the safe integer range");
    }
    const context: SolverProgressContext = {
      ...options,
      totalIterations,
    };
    const progress = createProgressContext(context);
    const yieldEvery = options.yieldEvery ?? 256;
    // Trace: each read has numIterations + 1 entries (initial state + one per move).
    const trace = new TraceCollector(
      numReads * (numIterations + 1),
      options.traceLimit ?? 2048,
      options.onStep,
    );
    const started = now();

    let globalBest = Number.POSITIVE_INFINITY;
    let completed = 0;
    const samples: TabuSample[] = [];
    const { diagonal, coupling } = flipCoefficients(qubo);

    for (let read = 0; read < numReads; read += 1) {
      checkCancellation(context);
      const random = readRandom(seed, read);
      const state = randomState(random, qubo.size);
      let energy = qubo.energy(state);

      // field[i] = Σ_{j} coupling[i][j] * state[j].
      // Kept up to date after every accepted flip so ΔE is O(1).
      const field = Array.from({ length: qubo.size }, (_, i) =>
        state.reduce(
          (sum, bit, j) => sum + (coupling[i]?.[j] ?? 0) * bit,
          0,
        ),
      );

      let bestSeenState: readonly number[] = [...state];
      let bestSeenEnergy = energy;

      // iterBase makes iteration numbers globally unique across reads.
      const iterBase = read * (numIterations + 1);

      // tabuExpiry[v] = absolute iteration after which variable v is free again.
      const tabuExpiry = new Array<number>(qubo.size).fill(0);

      if (energy < globalBest) {
        globalBest = energy;
      }

      // Record the initial state of this read.
      trace.record(
        {
          iter: iterBase,
          state: [...state],
          energy,
          bestEnergy: globalBest,
          flipped: null,
          deltaE: null,
          temperature: null,
          accepted: null,
          tabu: [],
          read,
        },
        read === 0 ? "initial" : "read-start",
      );

      for (let iter = 1; iter <= numIterations; iter += 1) {
        const absIter = iterBase + iter;

        // Scan all single-bit flips and pick the best admissible one.
        let bestDeltaE = Number.POSITIVE_INFINITY;
        let bestVar = -1;

        // Also track the best tabu move in case aspiration applies.
        let bestTabuDeltaE = Number.POSITIVE_INFINITY;
        let bestTabuVar = -1;

        for (let v = 0; v < qubo.size; v += 1) {
          const bit = state[v] ?? 0;
          const direction = 1 - 2 * bit; // +1 for 0→1, −1 for 1→0
          const deltaE =
            direction * ((diagonal[v] ?? 0) + (field[v] ?? 0));
          const isTabu = (tabuExpiry[v] ?? 0) >= absIter;

          if (!isTabu) {
            if (deltaE < bestDeltaE) {
              bestDeltaE = deltaE;
              bestVar = v;
            }
          } else {
            // Aspiration: override tabu if this move would beat global best.
            if (energy + deltaE < globalBest && deltaE < bestTabuDeltaE) {
              bestTabuDeltaE = deltaE;
              bestTabuVar = v;
            }
          }
        }

        // Aspiration takes priority over the best non-tabu move when it
        // improves the global optimum.
        let chosenVar: number;
        let chosenDeltaE: number;
        if (
          bestTabuVar !== -1 &&
          energy + bestTabuDeltaE < globalBest
        ) {
          chosenVar = bestTabuVar;
          chosenDeltaE = bestTabuDeltaE;
        } else if (bestVar !== -1) {
          chosenVar = bestVar;
          chosenDeltaE = bestDeltaE;
        } else {
          // Entire neighbourhood is tabu and no aspiration — pick the
          // globally least-harmful tabu move to avoid stalling.
          for (let v = 0; v < qubo.size; v += 1) {
            const bit = state[v] ?? 0;
            const direction = 1 - 2 * bit;
            const deltaE =
              direction * ((diagonal[v] ?? 0) + (field[v] ?? 0));
            if (deltaE < bestTabuDeltaE) {
              bestTabuDeltaE = deltaE;
              bestTabuVar = v;
            }
          }
          if (bestTabuVar === -1) {
            break; // Degenerate QUBO with no variables.
          }
          chosenVar = bestTabuVar;
          chosenDeltaE = bestTabuDeltaE;
        }

        // Apply the chosen flip.
        const chosenBit = state[chosenVar] ?? 0;
        const chosenDirection = 1 - 2 * chosenBit;
        state[chosenVar] = 1 - chosenBit;
        energy += chosenDeltaE;

        // Update the field vector in O(n).
        for (let j = 0; j < qubo.size; j += 1) {
          field[j] =
            (field[j] ?? 0) +
            (coupling[j]?.[chosenVar] ?? 0) * chosenDirection;
        }

        // Forbid the flipped variable for the next `tenure` moves.
        tabuExpiry[chosenVar] = absIter + tenure;

        // Update best-seen and global best.
        if (energy < bestSeenEnergy) {
          bestSeenEnergy = energy;
          bestSeenState = [...state];
        }
        const improved = energy < globalBest;
        if (improved) {
          globalBest = energy;
        }

        completed += 1;
        const isLast = iter === numIterations;
        const event: TraceEvent | undefined = isLast
          ? read === numReads - 1
            ? "final"
            : "read-end"
          : improved
            ? "best"
            : undefined;

        // Snapshot the active tabu list (variables still forbidden).
        const activeTabu = tabuExpiry
          .map((exp, v) => (exp > absIter ? v : -1))
          .filter((v) => v >= 0);

        trace.record(
          {
            iter: absIter,
            state: [...state],
            energy,
            bestEnergy: globalBest,
            flipped: chosenVar,
            deltaE: chosenDeltaE,
            temperature: null,
            accepted: true,
            tabu: activeTabu,
            read,
          },
          event,
        );

        if (completed % yieldEvery === 0 || completed === totalIterations) {
          checkCancellation(context);
          progress.report(completed, globalBest);
        }
        const yieldTask = progress.yieldIfNeeded(completed);
        if (yieldTask !== undefined) {
          await yieldTask;
        }
      }

      const finalState = Object.freeze([...state]);
      const finalBestSeenState = Object.freeze([...bestSeenState]);
      const distance =
        trueSecret === null
          ? null
          : hammingDistance(finalState, trueSecret);
      samples.push(
        Object.freeze({
          read,
          state: finalState,
          energy: qubo.energy(finalState),
          bestSeenState: finalBestSeenState,
          bestSeenEnergy: qubo.energy(finalBestSeenState),
          isCorrect: distance === null ? null : distance === 0,
          hammingDistance: distance,
        }),
      );
    }

    samples.sort((left, right) => left.energy - right.energy || left.read - right.read);
    const best = samples[0];
    if (best === undefined) {
      throw new Error("Tabu search produced no samples");
    }
    const result = buildSolverResult(
      qubo,
      best.state,
      now() - started,
      trueSecret,
      {
        seed,
        numReads,
        numIterations,
        tenure,
      },
      trace,
    );
    return Object.freeze({
      ...result,
      samples: Object.freeze(samples),
    });
  }
}

