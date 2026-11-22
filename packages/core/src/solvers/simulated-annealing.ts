import { QUBO } from "../qubo/converter";
import { resolveSeed, SeededRandom } from "../random/seeded-random";
import {
  acceptanceProbability,
  betaToTemperature,
  buildBetaSchedule,
  defaultBetaRange,
  flipCoefficients,
  type BetaRange,
} from "./annealing-schedule";
import {
  buildSolverResult,
  checkCancellation,
  createProgressContext,
  hammingDistance,
  now,
  TraceCollector,
  validateBinaryVector,
  validatePositiveInteger,
  validateTrueSecret,
  type TraceEvent,
} from "./common";
import type {
  SolverProgressContext,
  SolverResult,
  SolverRuntimeOptions,
} from "./types";

/** Parameters of the annealing schedule. */
export interface SimulatedAnnealingParameters {
  /** Sweeps per read; one sweep proposes a flip of every bit once (default 1000). */
  readonly numSweeps?: number;
  /** `[betaHot, betaCold]`; defaults to {@link defaultBetaRange}. */
  readonly betaRange?: BetaRange;
}

export interface SimulatedAnnealingOptions
  extends SolverRuntimeOptions,
    SimulatedAnnealingParameters {
  /** Independent restarts from random states (default 1). */
  readonly numReads?: number;
}

export interface AnnealingMovesOptions extends SimulatedAnnealingParameters {
  /** Run seed. With the same seed and `read`, moves match the solver exactly. */
  readonly seed: number;
  /** Which read of a multi-read run to replay (default 0). */
  readonly read?: number;
  /** Starting state; defaults to the same random state the solver would use. */
  readonly initialState?: readonly number[];
}

/**
 * One proposed single-bit flip, as seen by a learner stepping through a read.
 * `move = 0` is the starting state before any proposal (move fields are null).
 */
export interface AnnealingMove {
  readonly read: number;
  readonly move: number;
  readonly sweep: number;
  readonly beta: number;
  readonly temperature: number;
  /** Bit proposed for flipping. */
  readonly variable: number | null;
  /** Energy change if the flip is accepted. */
  readonly deltaE: number | null;
  readonly acceptanceProbability: number | null;
  /** Uniform draw compared with the probability; null for downhill moves. */
  readonly randomDraw: number | null;
  readonly accepted: boolean | null;
  /** State after the move. */
  readonly state: readonly number[];
  /** QUBO energy (including offset) after the move. */
  readonly energy: number;
  /** Lowest energy seen so far in this read. */
  readonly bestEnergy: number;
}

/** Outcome of one independent read. */
export interface AnnealingSample {
  readonly read: number;
  /** State at the end of the read, after the coldest sweep. */
  readonly state: readonly number[];
  readonly energy: number;
  /** Lowest-energy state visited during the read (may beat `state`). */
  readonly bestSeenState: readonly number[];
  readonly bestSeenEnergy: number;
  readonly acceptedMoves: number;
  readonly isCorrect: boolean | null;
  readonly hammingDistance: number | null;
}

export interface SimulatedAnnealingResult extends SolverResult {
  /** One entry per read, sorted by final energy (ties by read index). */
  readonly samples: readonly AnnealingSample[];
  /** β used in each sweep. */
  readonly betaSchedule: readonly number[];
}

function resolveSchedule(
  qubo: QUBO,
  params: SimulatedAnnealingParameters,
): readonly number[] {
  return buildBetaSchedule(
    params.betaRange ?? defaultBetaRange(qubo),
    params.numSweeps ?? 1000,
  );
}

/** One proposal, with a *live* reference to the mutable state (internal). */
interface RawMove {
  readonly move: number;
  readonly sweep: number;
  readonly beta: number;
  readonly variable: number;
  readonly deltaE: number;
  readonly acceptanceProbability: number;
  readonly randomDraw: number | null;
  readonly accepted: boolean;
  readonly state: readonly number[];
  readonly energy: number;
}

/**
 * Anneals one read. Each sweep visits bits 0..n−1 in order and proposes
 * flipping each one; the proposal is accepted by the Metropolis rule.
 *
 * `field[i] = Σ_{j≠i} W_ij · x_j` is kept up to date after every accepted
 * flip, so computing `ΔE_i = (1 − 2x_i) · (Q_ii + field[i])` is O(1).
 */
function* runRead(
  qubo: QUBO,
  schedule: readonly number[],
  random: SeededRandom,
  initial: readonly number[],
): Generator<RawMove, void, undefined> {
  const n = qubo.size;
  const { diagonal, coupling } = flipCoefficients(qubo);
  const state = [...initial];
  const field = Array.from({ length: n }, (_, i) =>
    state.reduce((sum, bit, j) => sum + (coupling[i]?.[j] ?? 0) * bit, 0),
  );

  let energy = qubo.energy(initial);
  let move = 0;
  for (let sweep = 0; sweep < schedule.length; sweep += 1) {
    const beta = schedule[sweep] ?? 0;
    for (let variable = 0; variable < n; variable += 1) {
      const bit = state[variable] ?? 0;
      const direction = 1 - 2 * bit; // +1 for 0→1, −1 for 1→0
      const deltaE = direction * ((diagonal[variable] ?? 0) + (field[variable] ?? 0));
      const probability = acceptanceProbability(deltaE, beta);
      // Downhill moves are always accepted, so no random number is needed.
      const randomDraw = deltaE <= 0 ? null : random.next();
      const accepted = randomDraw === null || randomDraw < probability;
      if (accepted) {
        state[variable] = 1 - bit;
        energy += deltaE;
        for (let j = 0; j < n; j += 1) {
          field[j] = (field[j] ?? 0) + (coupling[j]?.[variable] ?? 0) * direction;
        }
      }
      move += 1;
      yield {
        move,
        sweep,
        beta,
        variable,
        deltaE,
        acceptanceProbability: probability,
        randomDraw,
        accepted,
        state,
        energy,
      };
    }
  }
}

/** Independent, deterministic random stream for each read of a run. */
function readRandom(seed: number, read: number): SeededRandom {
  const mixed = (seed + Math.imul(read, 0x9e37_79b9)) >>> 0;
  return new SeededRandom(new SeededRandom(mixed).nextUint32());
}

function randomState(random: SeededRandom, size: number): number[] {
  return Array.from({ length: size }, () => random.bit());
}

/**
 * Lazily replays every proposed flip of one simulated-annealing read.
 *
 * Intended for step-by-step explanations on small instances: each yielded
 * {@link AnnealingMove} carries the proposal, its acceptance probability, the
 * random draw, and the resulting state. The first value (`move = 0`) is the
 * starting state. With the same `seed`, `read`, and parameters, the moves are
 * identical to those performed by {@link SimulatedAnnealingSolver.solve}.
 *
 * Parameters are validated eagerly, before the first `next()` call.
 */
export function annealingMoves(
  qubo: QUBO,
  options: AnnealingMovesOptions,
): Generator<AnnealingMove, void, undefined> {
  const schedule = resolveSchedule(qubo, options);
  const seed = resolveSeed(options.seed);
  const read = options.read ?? 0;
  if (!Number.isSafeInteger(read) || read < 0) {
    throw new RangeError("read must be a non-negative integer");
  }
  const random = readRandom(seed, read);
  const initial =
    options.initialState === undefined
      ? randomState(random, qubo.size)
      : [...validateBinaryVector(options.initialState, qubo.size, "initialState")];

  function* generate(): Generator<AnnealingMove, void, undefined> {
    const initialEnergy = qubo.energy(initial);
    let bestEnergy = initialEnergy;
    const firstBeta = schedule[0] ?? 0;
    yield Object.freeze({
      read,
      move: 0,
      sweep: 0,
      beta: firstBeta,
      temperature: betaToTemperature(firstBeta),
      variable: null,
      deltaE: null,
      acceptanceProbability: null,
      randomDraw: null,
      accepted: null,
      state: Object.freeze([...initial]),
      energy: initialEnergy,
      bestEnergy,
    });
    for (const raw of runRead(qubo, schedule, random, initial)) {
      bestEnergy = Math.min(bestEnergy, raw.energy);
      yield Object.freeze({
        ...raw,
        read,
        temperature: betaToTemperature(raw.beta),
        state: Object.freeze([...raw.state]),
        bestEnergy,
      });
    }
  }

  return generate();
}

/**
 * Simulated annealing for QUBO problems.
 *
 * Each of `numReads` independent reads starts from a random state and runs
 * `numSweeps` sweeps. β grows geometrically from `betaHot` to `betaCold`
 * (temperature falls), and every proposed bit flip is accepted by the
 * Metropolis rule.
 *
 * The reported `solution` is the lowest-energy *final* state across reads.
 * The lowest state visited during each read is reported separately as
 * `bestSeenState`. Results are reproducible for a given seed.
 */
export class SimulatedAnnealingSolver {
  async solve(
    qubo: QUBO,
    options: SimulatedAnnealingOptions = {},
  ): Promise<SimulatedAnnealingResult> {
    const schedule = resolveSchedule(qubo, options);
    const numReads = options.numReads ?? 1;
    validatePositiveInteger(numReads, "numReads");
    const seed = resolveSeed(options.seed);
    const trueSecret = validateTrueSecret(qubo, options.trueSecret);

    const movesPerRead = schedule.length * qubo.size;
    const totalMoves = numReads * movesPerRead;
    if (!Number.isSafeInteger(numReads * (movesPerRead + 1))) {
      throw new RangeError("annealing run length exceeds the safe integer range");
    }
    const context: SolverProgressContext = {
      ...options,
      totalIterations: totalMoves,
    };
    const progress = createProgressContext(context);
    const yieldEvery = options.yieldEvery ?? 256;
    // Each read occupies `movesPerRead + 1` trace iterations: its start state
    // plus one per proposal, so read boundaries never share an iteration.
    const trace = new TraceCollector(
      numReads * (movesPerRead + 1),
      options.traceLimit ?? 2048,
      options.onStep,
    );
    const started = now();

    let globalBest = Number.POSITIVE_INFINITY;
    let completed = 0;
    let acceptedTotal = 0;
    const samples: AnnealingSample[] = [];

    for (let read = 0; read < numReads; read += 1) {
      checkCancellation(context);
      const random = readRandom(seed, read);
      const initial = randomState(random, qubo.size);
      const initialEnergy = qubo.energy(initial);
      const iterBase = read * (movesPerRead + 1);
      let bestSeenState: readonly number[] = initial;
      let bestSeenEnergy = initialEnergy;
      let finalState: readonly number[] = initial;
      let accepted = 0;
      globalBest = Math.min(globalBest, initialEnergy);
      trace.record(
        {
          iter: iterBase,
          state: initial,
          energy: initialEnergy,
          bestEnergy: globalBest,
          flipped: null,
          deltaE: null,
          temperature: betaToTemperature(schedule[0] ?? 0),
          accepted: null,
          tabu: null,
          read,
        },
        read === 0 ? "initial" : "read-start",
      );

      for (const raw of runRead(qubo, schedule, random, initial)) {
        completed += 1;
        if (raw.accepted) {
          accepted += 1;
        }
        if (raw.energy < bestSeenEnergy) {
          bestSeenEnergy = raw.energy;
          bestSeenState = [...raw.state];
        }
        const improved = raw.energy < globalBest;
        if (improved) {
          globalBest = raw.energy;
        }
        const isLast = raw.move === movesPerRead;
        if (isLast) {
          finalState = [...raw.state];
        }
        const event: TraceEvent | undefined = isLast
          ? read === numReads - 1
            ? "final"
            : "read-end"
          : improved
            ? "best"
            : undefined;
        trace.record(
          {
            iter: iterBase + raw.move,
            state: raw.state,
            energy: raw.energy,
            bestEnergy: globalBest,
            flipped: raw.variable,
            deltaE: raw.deltaE,
            temperature: betaToTemperature(raw.beta),
            accepted: raw.accepted,
            tabu: null,
            read,
          },
          event,
        );
        if (completed % yieldEvery === 0 || completed === totalMoves) {
          checkCancellation(context);
          progress.report(completed, globalBest);
        }
        const yieldTask = progress.yieldIfNeeded(completed);
        if (yieldTask !== undefined) {
          await yieldTask;
        }
      }

      acceptedTotal += accepted;
      const distance =
        trueSecret === null ? null : hammingDistance(finalState, trueSecret);
      samples.push(
        Object.freeze({
          read,
          state: Object.freeze([...finalState]),
          energy: qubo.energy(finalState),
          bestSeenState: Object.freeze([...bestSeenState]),
          bestSeenEnergy: qubo.energy(bestSeenState),
          acceptedMoves: accepted,
          isCorrect: distance === null ? null : distance === 0,
          hammingDistance: distance,
        }),
      );
    }

    samples.sort((left, right) => left.energy - right.energy || left.read - right.read);
    const best = samples[0];
    if (best === undefined) {
      throw new Error("Simulated annealing produced no samples");
    }
    const result = buildSolverResult(
      qubo,
      best.state,
      now() - started,
      trueSecret,
      {
        seed,
        numReads,
        numSweeps: schedule.length,
        betaHot: schedule[0] ?? 0,
        betaCold: schedule.at(-1) ?? 0,
        movesProposed: totalMoves,
        acceptedMoves: acceptedTotal,
        acceptanceRate: acceptedTotal / totalMoves,
      },
      trace,
    );
    return Object.freeze({
      ...result,
      samples: Object.freeze(samples),
      betaSchedule: schedule,
    });
  }
}
