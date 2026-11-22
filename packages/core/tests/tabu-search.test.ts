import { describe, expect, it } from "vitest";
import {
  BruteForceSolver,
  generateLWEInstance,
  lweToQUBO,
  QUBO,
  SolverCancelledError,
  TabuSearchSolver,
  type QUBORepresentation,
  type TabuSearchResult,
} from "../src/index";

function lweQUBO(
  n: number,
  seed: number,
  representation: QUBORepresentation = "upper_triangular",
  noiseBound = 0,
) {
  const instance = generateLWEInstance({ n, m: 2 * n, noiseBound, seed });
  return { instance, qubo: lweToQUBO(instance.A, instance.b, representation) };
}

function withoutTiming(result: TabuSearchResult) {
  const { executionTimeMs: _ignored, ...rest } = result;
  return rest;
}

describe("TabuSearchSolver", () => {
  it.each([
    [4, 43],
    [6, 7],
    [8, 101],
  ])(
    "matches brute force on noiseless instances (n=%i, seed=%i)",
    async (n, seed) => {
      const { instance, qubo } = lweQUBO(n, seed);
      const exact = await new BruteForceSolver().solve(qubo);
      const result = await new TabuSearchSolver().solve(qubo, {
        numReads: 20,
        numIterations: 500,
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

  it("is deterministic for a seed", async () => {
    const { qubo } = lweQUBO(6, 15, "symmetric", 2);
    const options = { numReads: 3, numIterations: 60, seed: 77 } as const;
    const first = await new TabuSearchSolver().solve(qubo, options);
    const second = await new TabuSearchSolver().solve(qubo, options);
    const other = await new TabuSearchSolver().solve(qubo, {
      ...options,
      seed: 78,
    });

    expect(withoutTiming(first)).toEqual(withoutTiming(second));
    expect(other.trace).not.toEqual(first.trace);
  });

  it("returns the best final state and reports best-seen states", async () => {
    const { instance, qubo } = lweQUBO(8, 33, "upper_triangular", 2);
    const result = await new TabuSearchSolver().solve(qubo, {
      numReads: 6,
      numIterations: 100,
      seed: 5,
      trueSecret: instance.secret,
    });

    expect(result.samples).toHaveLength(6);
    expect(new Set(result.samples.map((s) => s.read)).size).toBe(6);
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
    expect(result.extraInfo).toMatchObject({
      seed: 5,
      numReads: 6,
      numIterations: 100,
    });
  });

  it("keeps every best-so-far improvement and read boundary in a bounded trace", async () => {
    const { qubo } = lweQUBO(8, 19, "upper_triangular", 1);
    const numReads = 3;
    const numIterations = 300;
    const traceLimit = 128;
    const result = await new TabuSearchSolver().solve(qubo, {
      numReads,
      numIterations,
      seed: 12,
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
  });

  it("stores the tabu list as an array of variable indices", async () => {
    const { qubo } = lweQUBO(6, 7);
    const result = await new TabuSearchSolver().solve(qubo, {
      numReads: 1,
      numIterations: 50,
      tenure: 3,
      seed: 1,
      traceLimit: 1000,
    });

    // Every step except the initial one should have a flipped variable.
    const moves = result.trace.filter((step) => step.flipped !== null);
    expect(moves.length).toBeGreaterThan(0);

    for (const step of result.trace) {
      // tabu is always an array (never null) for tabu search.
      expect(Array.isArray(step.tabu)).toBe(true);
      // All tabu indices are valid variable indices.
      for (const v of step.tabu ?? []) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(qubo.size);
      }
    }
  });

  it("auto-computes tenure as floor(sqrt(n)) when not supplied", async () => {
    const { qubo } = lweQUBO(9, 42);
    const result = await new TabuSearchSolver().solve(qubo, { seed: 1 });
    // tenure = floor(sqrt(9)) = 3
    expect(result.extraInfo.tenure).toBe(3);
  });

  it("reports progress and supports cooperative cancellation", async () => {
    const { qubo } = lweQUBO(4, 6);
    const progress: number[] = [];
    await new TabuSearchSolver().solve(qubo, {
      numReads: 2,
      numIterations: 100,
      seed: 1,
      yieldEvery: 64,
      onProgress: ({ completed, total }) => {
        expect(total).toBe(2 * 100);
        progress.push(completed);
      },
    });
    expect(progress.at(-1)).toBe(200);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));

    let calls = 0;
    await expect(
      new TabuSearchSolver().solve(qubo, {
        numIterations: 100,
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
    const result = await new TabuSearchSolver().solve(qubo, {
      numIterations: 20,
      seed: 2,
      onStep: (step) => streamed.push(step.energy),
    });
    expect(streamed).toEqual(result.trace.map((step) => step.energy));
  });

  it("rejects invalid parameters", async () => {
    const { qubo } = lweQUBO(4, 6);
    const solver = new TabuSearchSolver();
    await expect(solver.solve(qubo, { numReads: 0 })).rejects.toThrow(
      /numReads/,
    );
    await expect(solver.solve(qubo, { numIterations: 1.5 })).rejects.toThrow(
      /numIterations/,
    );
    await expect(solver.solve(qubo, { tenure: 0 })).rejects.toThrow(/tenure/);
    await expect(
      solver.solve(qubo, { trueSecret: [1, 0] }),
    ).rejects.toThrow(/trueSecret/);
  });
});

