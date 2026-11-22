import { QUBO } from "../qubo/converter";
import { validatePositiveInteger } from "./common";

/** Inverse temperature range `[betaHot, betaCold]` (β = 1 / T). */
export type BetaRange = readonly [number, number];

/** Acceptance probability of the largest uphill step at the start of a run. */
const HOT_ACCEPTANCE = 0.5;
/** Acceptance probability of the smallest uphill step at the end of a run. */
const COLD_ACCEPTANCE = 0.01;

/**
 * Coefficients that determine the energy change of a single-bit flip:
 *
 * `ΔE_i = (1 − 2x_i) · (Q_ii + Σ_{j≠i} W_ij · x_j)`, where `W_ij = Q_ij + Q_ji`.
 *
 * Using `W` makes the formula valid for both upper-triangular and symmetric
 * QUBO matrices. `coupling` is symmetric with a zero diagonal.
 */
export function flipCoefficients(qubo: QUBO): {
  readonly diagonal: readonly number[];
  readonly coupling: readonly (readonly number[])[];
} {
  const n = qubo.size;
  const diagonal = Array.from({ length: n }, (_, i) => qubo.matrix[i]?.[i] ?? 0);
  const coupling = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) =>
      i === j ? 0 : (qubo.matrix[i]?.[j] ?? 0) + (qubo.matrix[j]?.[i] ?? 0),
    ),
  );
  return { diagonal, coupling };
}

/**
 * Default β range derived from the energy scale of the QUBO.
 *
 * - The largest possible flip cost is `ΔE_max = max_i (|Q_ii| + Σ_j |W_ij|)`.
 *   The hot β accepts that step with probability 50%:
 *   `betaHot = ln 2 / ΔE_max`.
 * - The smallest possible flip cost `ΔE_min` is the smallest non-zero
 *   coefficient `|Q_ii|` or `|W_ij|`. The cold β accepts that step with
 *   probability 1%: `betaCold = ln 100 / ΔE_min`.
 *
 * In words: at the start even the largest uphill step succeeds every other
 * time; at the end even the smallest one succeeds only once in a hundred. A
 * QUBO whose coefficients are all zero has no energy scale and gets `[0.1, 1]`.
 */
export function defaultBetaRange(qubo: QUBO): BetaRange {
  const { diagonal, coupling } = flipCoefficients(qubo);
  let maxDelta = 0;
  let minDelta = Number.POSITIVE_INFINITY;
  for (let i = 0; i < qubo.size; i += 1) {
    const ownBias = Math.abs(diagonal[i] ?? 0);
    let largestFlip = ownBias;
    if (ownBias > 0) {
      minDelta = Math.min(minDelta, ownBias);
    }
    for (let j = 0; j < qubo.size; j += 1) {
      const weight = Math.abs(coupling[i]?.[j] ?? 0);
      largestFlip += weight;
      if (weight > 0) {
        minDelta = Math.min(minDelta, weight);
      }
    }
    maxDelta = Math.max(maxDelta, largestFlip);
  }
  if (maxDelta === 0) {
    return Object.freeze([0.1, 1]) as BetaRange;
  }
  return Object.freeze([
    -Math.log(HOT_ACCEPTANCE) / maxDelta,
    -Math.log(COLD_ACCEPTANCE) / minDelta,
  ]) as BetaRange;
}

/**
 * Geometric β schedule with one value per sweep: β starts at `betaHot`, is
 * multiplied by a constant factor after every sweep, and ends exactly at
 * `betaCold`. Temperature `T = 1/β` therefore falls exponentially.
 */
export function buildBetaSchedule(
  betaRange: BetaRange,
  numSweeps: number,
): readonly number[] {
  validatePositiveInteger(numSweeps, "numSweeps");
  if (!Array.isArray(betaRange) || betaRange.length !== 2) {
    throw new TypeError("betaRange must be a pair [betaHot, betaCold]");
  }
  const [hot, cold] = betaRange;
  if (!Number.isFinite(hot) || !Number.isFinite(cold) || hot <= 0 || cold <= 0) {
    throw new RangeError("betaRange values must be positive and finite");
  }
  if (hot > cold) {
    throw new RangeError(
      "betaRange must go from hot to cold (betaRange[0] <= betaRange[1])",
    );
  }
  if (numSweeps === 1) {
    return Object.freeze([hot]);
  }
  const schedule = Array.from(
    { length: numSweeps },
    (_, sweep) => hot * (cold / hot) ** (sweep / (numSweeps - 1)),
  );
  schedule[numSweeps - 1] = cold;
  return Object.freeze(schedule);
}

/**
 * Metropolis rule: a flip that does not increase the energy (`ΔE ≤ 0`) is
 * always accepted; an uphill flip is accepted with probability `exp(−β·ΔE)`.
 */
export function acceptanceProbability(deltaE: number, beta: number): number {
  return deltaE <= 0 ? 1 : Math.exp(-beta * deltaE);
}

/** Temperature `T = 1 / β`. */
export function betaToTemperature(beta: number): number {
  return 1 / beta;
}
