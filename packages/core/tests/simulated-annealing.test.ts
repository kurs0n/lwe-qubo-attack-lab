import { describe, expect, it } from "vitest";
import {
  acceptanceProbability,
  annealingMoves,
  BruteForceSolver,
  buildBetaSchedule,
  defaultBetaRange,
  generateLWEInstance,
  lweToQUBO,
  QUBO,
  SimulatedAnnealingSolver,
  SolverCancelledError,
  type QUBORepresentation,
  type SimulatedAnnealingResult,
} from "../src/index";

function bitsOf(value: number, size: number): number[] {
  return Array.from({ length: size }, (_, index) => (value >>> index) & 1);
}

function lweQUBO(
  n: number,
  seed: number,
  representation: QUBORepresentation = "upper_triangular",
  noiseBound = 0,
) {
  const instance = generateLWEInstance({ n, m: 2 * n, noiseBound, seed });
  return { instance, qubo: lweToQUBO(instance.A, instance.b, representation) };
}

function withoutTiming(result: SimulatedAnnealingResult) {
  const { executionTimeMs: _ignored, ...rest } = result;
  return rest;
}

describe("annealing schedule", () => {
  it("derives the default beta range from the largest and smallest flip cost", () => {
    // ΔE_max = max(|2| + 4, |−2| + 4) = 6, ΔE_min = min(2, 2, 4) = 2.
    const upper = new QUBO([[2, 4], [0, -2]], 0, "upper_triangular");
    const symmetric = new QUBO([[2, 2], [2, -2]], 0, "symmetric");
    for (const qubo of [upper, symmetric]) {
      const [hot, cold] = defaultBetaRange(qubo);
      expect(hot).toBeCloseTo(Math.log(2) / 6, 12);
      expect(cold).toBeCloseTo(Math.log(100) / 2, 12);
    }

    // ΔE_max = |5| + 1 = 6, ΔE_min = coupling 1.
    const [hot, cold] = defaultBetaRange(new QUBO([[5, 1], [0, -3]], 0, "upper_triangular"));
    expect(hot).toBeCloseTo(Math.log(2) / 6, 12);
    expect(cold).toBeCloseTo(Math.log(100), 12);
  });

  it("accepts every real flip with at least 50% probability at the hot end", () => {
    const { qubo } = lweQUBO(6, 5, "upper_triangular", 2);
    const [hot, cold] = defaultBetaRange(qubo);
    expect(hot).toBeLessThan(cold);

    let largestFlip = 0;
    for (let value = 0; value < 2 ** qubo.size; value += 1) {
      const state = bitsOf(value, qubo.size);
      for (let bit = 0; bit < qubo.size; bit += 1) {
        const flipped = [...state];
        flipped[bit] = 1 - flipped[bit]!;
        largestFlip = Math.max(largestFlip, qubo.energy(flipped) - qubo.energy(state));
      }
    }
    expect(acceptanceProbability(largestFlip, hot)).toBeGreaterThanOrEqual(0.5);
  });

  it("uses [0.1, 1] for an all-zero problem", () => {
    const zero = new QUBO([[0, 0], [0, 0]], 7, "upper_triangular");
    expect(defaultBetaRange(zero)).toEqual([0.1, 1]);
  });

  it("builds a geometric schedule with exact endpoints", () => {
    const schedule = buildBetaSchedule([0.1, 10], 5);
    expect(schedule).toHaveLength(5);
    expect(schedule[0]).toBe(0.1);
    expect(schedule.at(-1)).toBe(10);
    for (let index = 1; index < schedule.length; index += 1) {
      expect(schedule[index]! / schedule[index - 1]!).toBeCloseTo(10 ** 0.5, 10);
    }
    expect(buildBetaSchedule([1, 3], 1)).toEqual([1]);
    expect(buildBetaSchedule([2, 2], 3)).toEqual([2, 2, 2]);
  });

  it("rejects invalid schedules", () => {
    expect(() => buildBetaSchedule([0, 2], 4)).toThrow(/positive/);
    expect(() => buildBetaSchedule([1, Number.POSITIVE_INFINITY], 4)).toThrow(
      /positive and finite/,
    );
    expect(() => buildBetaSchedule([3, 2], 4)).toThrow(/hot to cold/);
    expect(() => buildBetaSchedule([1, 2], 0)).toThrow(/numSweeps/);
  });

  it("computes Metropolis acceptance probabilities", () => {
    expect(acceptanceProbability(-3, 2)).toBe(1);
    expect(acceptanceProbability(0, 2)).toBe(1);
    expect(acceptanceProbability(1, 2)).toBeCloseTo(Math.exp(-2), 12);
    expect(acceptanceProbability(1e6, 1)).toBe(0);
  });
});

describe("annealingMoves (step-by-step generator)", () => {
  it.each(["upper_triangular", "symmetric"] as const)(
    "reports exact energy changes and consistent states (%s)",
    (representation) => {
      const { qubo } = lweQUBO(6, 11, representation, 1);
      const moves = [...annealingMoves(qubo, { seed: 4, numSweeps: 40 })];
      expect(moves).toHaveLength(1 + 40 * qubo.size);
      expect(moves[0]!.move).toBe(0);
      expect(moves[0]!.variable).toBeNull();

      for (let index = 1; index < moves.length; index += 1) {
        const before = moves[index - 1]!;
        const move = moves[index]!;
        const variable = move.variable!;
        const flipped = [...before.state];
        flipped[variable] = 1 - flipped[variable]!;

        expect(variable).toBe((index - 1) % qubo.size);
        expect(move.sweep).toBe(Math.floor((index - 1) / qubo.size));
        expect(move.deltaE).toBeCloseTo(
          qubo.energy(flipped) - qubo.energy(before.state),
          8,
        );
        expect(move.state).toEqual(move.accepted ? flipped : before.state);
        expect(move.energy).toBeCloseTo(qubo.energy(move.state), 8);
        expect(move.bestEnergy).toBe(Math.min(before.bestEnergy, move.energy));
        expect(move.temperature).toBeCloseTo(1 / move.beta, 12);
      }
    },
  );

  it("always accepts downhill moves and draws a number only for uphill ones", () => {
    const { qubo } = lweQUBO(6, 12, "upper_triangular", 1);
    for (const move of annealingMoves(qubo, { seed: 9, numSweeps: 50 })) {
      if (move.deltaE === null) {
        continue;
      }
      if (move.deltaE <= 0) {
        expect(move.accepted).toBe(true);
        expect(move.randomDraw).toBeNull();
        expect(move.acceptanceProbability).toBe(1);
      } else {
        expect(move.randomDraw).not.toBeNull();
        expect(move.accepted).toBe(move.randomDraw! < move.acceptanceProbability!);
      }
    }
  });

  it("never climbs uphill when the temperature is effectively zero", () => {
    const { qubo } = lweQUBO(8, 21, "upper_triangular", 1);
    const moves = [
      ...annealingMoves(qubo, { seed: 3, numSweeps: 20, betaRange: [1e9, 1e9] }),
    ];
    const uphill = moves.filter((move) => (move.deltaE ?? 0) > 0);
    expect(uphill.length).toBeGreaterThan(0);
    expect(uphill.every((move) => move.accepted === false)).toBe(true);
    for (let index = 1; index < moves.length; index += 1) {
      expect(moves[index]!.energy).toBeLessThanOrEqual(moves[index - 1]!.energy);
    }
  });

  it("starts from a given initial state and validates parameters eagerly", () => {
    const { qubo } = lweQUBO(4, 6);
    const [first] = annealingMoves(qubo, {
      seed: 1,
      numSweeps: 2,
      initialState: [1, 0, 1, 1],
    });
    expect(first?.state).toEqual([1, 0, 1, 1]);
    expect(() =>
      annealingMoves(qubo, { seed: 1, initialState: [1, 0, 2, 1] }),
    ).toThrow(/only 0 or 1/);
    expect(() => annealingMoves(qubo, { seed: 1, read: -1 })).toThrow(/read/);
    expect(() => annealingMoves(qubo, { seed: -5 })).toThrow(/seed/);
    expect(() => annealingMoves(qubo, { seed: 1, betaRange: [2, 1] })).toThrow(
      /hot to cold/,
    );
  });
});

describe("SimulatedAnnealingSolver", () => {
  it.each([
    [4, 43],
    [6, 7],
    [8, 101],
    [8, 2024],
  ])(
    "matches brute force on noiseless instances (n=%i, seed=%i)",
    async (n, seed) => {
      const { instance, qubo } = lweQUBO(n, seed);
      const exact = await new BruteForceSolver().solve(qubo);
      const result = await new SimulatedAnnealingSolver().solve(qubo, {
        numReads: 10,
        numSweeps: 1000,
        seed,
        trueSecret: instance.secret,
      });

      expect(result.energy).toBeCloseTo(exact.energy, 8);
      expect(result.energy).toBeCloseTo(0, 8);
      expect(result.solution).toEqual(instance.secret);
      expect(result.isCorrect).toBe(true);
      expect(result.hammingDistance).toBe(0);
    },
  );

  it("is deterministic for a seed and replayable read by read", async () => {
    const { qubo } = lweQUBO(6, 15, "symmetric", 2);
    const options = { numReads: 3, numSweeps: 60, seed: 77 } as const;
    const first = await new SimulatedAnnealingSolver().solve(qubo, options);
    const second = await new SimulatedAnnealingSolver().solve(qubo, options);
    const other = await new SimulatedAnnealingSolver().solve(qubo, {
      ...options,
      seed: 78,
    });

    expect(withoutTiming(first)).toEqual(withoutTiming(second));
    expect(other.trace).not.toEqual(first.trace);

    for (const sample of first.samples) {
      const moves = [
        ...annealingMoves(qubo, { seed: 77, numSweeps: 60, read: sample.read }),
      ];
      expect(moves.at(-1)?.state).toEqual(sample.state);
      expect(moves.at(-1)?.bestEnergy).toBeCloseTo(sample.bestSeenEnergy, 8);
      expect(moves.filter((move) => move.accepted).length).toBe(
        sample.acceptedMoves,
      );
    }
  });

  it("returns the best final state and reports best-seen states", async () => {
    const { instance, qubo } = lweQUBO(8, 33, "upper_triangular", 2);
    const result = await new SimulatedAnnealingSolver().solve(qubo, {
      numReads: 6,
      numSweeps: 30,
      seed: 5,
      trueSecret: instance.secret,
    });

    expect(result.samples).toHaveLength(6);
    expect(new Set(result.samples.map((sample) => sample.read)).size).toBe(6);
    expect(result.solution).toEqual(result.samples[0]!.state);
    expect(result.energy).toBe(result.samples[0]!.energy);
    for (let index = 0; index < result.samples.length; index += 1) {
      const sample = result.samples[index]!;
      expect(sample.energy).toBeCloseTo(qubo.energy(sample.state), 8);
      expect(sample.bestSeenEnergy).toBeLessThanOrEqual(sample.energy);
      expect(sample.bestSeenEnergy).toBeCloseTo(
        qubo.energy(sample.bestSeenState),
        8,
      );
      expect(sample.hammingDistance).not.toBeNull();
      if (index > 0) {
        expect(sample.energy).toBeGreaterThanOrEqual(
          result.samples[index - 1]!.energy,
        );
      }
    }
    expect(result.betaSchedule).toHaveLength(30);
    expect(result.extraInfo).toMatchObject({
      seed: 5,
      numReads: 6,
      numSweeps: 30,
      movesProposed: 6 * 30 * 8,
    });
    expect(result.extraInfo.acceptanceRate).toBeGreaterThan(0);
    expect(result.extraInfo.acceptanceRate).toBeLessThanOrEqual(1);
  });

  it("keeps every best-so-far improvement and read boundary in a bounded trace", async () => {
    const { qubo } = lweQUBO(8, 19, "upper_triangular", 1);
    const seed = 12;
    const numReads = 3;
    const numSweeps = 300;
    const traceLimit = 128;
    const result = await new SimulatedAnnealingSolver().solve(qubo, {
      numReads,
      numSweeps,
      seed,
      traceLimit,
    });
    const { trace } = result;

    expect(trace.length).toBeLessThanOrEqual(traceLimit);
    expect(trace[0]?.event).toBe("initial");
    expect(trace.at(-1)?.event).toBe("final");
    expect(trace.filter((step) => step.event === "read-start")).toHaveLength(
      numReads - 1,
    );
    expect(trace.filter((step) => step.event === "read-end")).toHaveLength(
      numReads - 1,
    );
    for (let index = 1; index < trace.length; index += 1) {
      expect(trace[index]!.iter).toBeGreaterThan(trace[index - 1]!.iter);
      expect(trace[index]!.bestEnergy).toBeLessThanOrEqual(
        trace[index - 1]!.bestEnergy,
      );
    }

    // Replay all reads to find every global best-so-far improvement.
    const improvements: number[] = [];
    let best = Number.POSITIVE_INFINITY;
    for (let read = 0; read < numReads; read += 1) {
      for (const move of annealingMoves(qubo, { seed, numSweeps, read })) {
        if (move.energy < best) {
          best = move.energy;
          improvements.push(best);
        }
      }
    }
    const tracedBests = new Set(trace.map((step) => step.bestEnergy));
    for (const value of improvements) {
      expect(tracedBests.has(value)).toBe(true);
      expect(trace.some((step) => step.energy === value)).toBe(true);
    }
    expect(trace.at(-1)?.bestEnergy).toBe(best);
    expect(trace.every((step) => step.read !== null)).toBe(true);
  });

  it("reports progress and supports cooperative cancellation", async () => {
    const { qubo } = lweQUBO(4, 6);
    const progress: number[] = [];
    await new SimulatedAnnealingSolver().solve(qubo, {
      numReads: 2,
      numSweeps: 100,
      seed: 1,
      yieldEvery: 64,
      onProgress: ({ completed, total }) => {
        expect(total).toBe(2 * 100 * 4);
        progress.push(completed);
      },
    });
    expect(progress.at(-1)).toBe(800);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));

    let calls = 0;
    await expect(
      new SimulatedAnnealingSolver().solve(qubo, {
        numSweeps: 100,
        seed: 1,
        yieldEvery: 16,
        yieldControl: async () => {},
        shouldCancel: () => {
          calls += 1;
          return calls > 3;
        },
      }),
    ).rejects.toBeInstanceOf(SolverCancelledError);
  });

  it("streams recorded steps through onStep", async () => {
    const { qubo } = lweQUBO(4, 6);
    const streamed: number[] = [];
    const result = await new SimulatedAnnealingSolver().solve(qubo, {
      numSweeps: 20,
      seed: 2,
      onStep: (step) => streamed.push(step.energy),
    });
    expect(streamed).toEqual(result.trace.map((step) => step.energy));
  });

  it("rejects invalid parameters", async () => {
    const { qubo } = lweQUBO(4, 6);
    const solver = new SimulatedAnnealingSolver();
    await expect(solver.solve(qubo, { numReads: 0 })).rejects.toThrow(/numReads/);
    await expect(solver.solve(qubo, { numSweeps: 1.5 })).rejects.toThrow(
      /numSweeps/,
    );
    await expect(solver.solve(qubo, { betaRange: [-1, 2] })).rejects.toThrow(
      /positive/,
    );
    await expect(solver.solve(qubo, { betaRange: [5, 1] })).rejects.toThrow(
      /hot to cold/,
    );
    await expect(solver.solve(qubo, { trueSecret: [1, 0] })).rejects.toThrow(
      /trueSecret/,
    );
  });
});
