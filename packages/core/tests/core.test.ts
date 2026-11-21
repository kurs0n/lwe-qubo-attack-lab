import { describe, expect, it } from "vitest";
import {
  BruteForceSolver,
  createLWEInstance,
  generateLWEInstance,
  lweToQUBO,
  QUBO,
  serializeQUBO,
  SimulatedAnnealingSolver,
  SolverCancelledError,
  TabuSearchSolver,
} from "../src/index";

describe("LWE instances", () => {
  it("generates deterministic instances with bounded noise", () => {
    const first = generateLWEInstance({
      n: 4,
      m: 7,
      noiseBound: 2,
      seed: 31,
    });
    const second = generateLWEInstance({
      n: 4,
      m: 7,
      noiseBound: 2,
      seed: 31,
    });

    expect(first).toEqual(second);
    expect(first.A).toHaveLength(7);
    expect(first.A[0]).toHaveLength(4);
    expect(first.secret.every((bit) => bit === 0 || bit === 1)).toBe(true);
    expect(first.error.every((value) => Math.abs(value) <= 2)).toBe(true);
    expect(first.b).toEqual(
      first.A.map((row, index) =>
        row.reduce(
          (sum, coefficient, column) =>
            sum + coefficient * (first.secret[column] ?? 0),
          first.error[index] ?? 0,
        ),
      ),
    );
  });

  it("rejects invalid parameters and inconsistent instances", () => {
    expect(() => generateLWEInstance({ n: 3, m: 4 })).toThrow(/n must/);
    expect(() => generateLWEInstance({ n: 4, m: 3 })).toThrow(/m must/);
    expect(() =>
      generateLWEInstance({ n: 4, m: 4, noiseBound: -1 }),
    ).toThrow(/noiseBound/);
    expect(
      () =>
        new QUBO(
          [
            [0, 0, 0, 0],
            [0, 0, 0, 0],
            [0, 0, 0, 0],
            [0, 0, 0, 0],
          ],
          0,
          "symmetric",
        ).energy([0, 0, 2, 1]),
    ).toThrow(/only 0 or 1/);
    expect(
      () =>
        createLWEInstance({
          A: [
            [1, 0, 0, 0],
            [0, 1, 0, 0],
            [0, 0, 1, 0],
            [0, 0, 0, 1],
          ],
          secret: [0, 0, 0, 0],
          error: [0, 0, 0, 0],
          b: [1, 0, 0, 0],
        }),
    ).toThrow(/b must equal/);
    expect(
      () =>
        createLWEInstance({
          A: [
            [1, 0, 0, 0],
            [0, 1, 0, 0],
            [0, 0, 1, 0],
            [0, 0, 0, 1],
          ],
          secret: [0, 0, 0, 0],
          error: [2, 0, 0, 0],
          b: [2, 0, 0, 0],
          noiseBound: 1,
        }),
    ).toThrow(/noiseBound/);
    expect(
      () => new QUBO([[0, 1], [1 + 1e-9, 0]], 0, "symmetric"),
    ).not.toThrow();
  });
});

describe("QUBO conversion", () => {
  it.each(["upper_triangular", "symmetric"] as const)(
    "matches least-squares energy for every binary candidate (%s)",
    (representation) => {
      const A = [
        [2, -1, 0, 3],
        [1, 4, -2, 0],
        [0, 1, 2, -1],
        [3, 0, 1, 2],
      ];
      const b = [4, -2, 3, 5];
      const qubo = lweToQUBO(A, b, representation);

      for (let bits = 0; bits < 2 ** A[0]!.length; bits += 1) {
        const candidate = Array.from(
          { length: A[0]!.length },
          (_, index) => (bits >>> index) & 1,
        );
        const residuals = A.map(
          (row, index) =>
            row.reduce(
              (sum, coefficient, column) =>
                sum + coefficient * (candidate[column] ?? 0),
              0,
            ) - (b[index] ?? 0),
        );
        const expected = residuals.reduce(
          (sum, residual) => sum + residual * residual,
          0,
        );
        expect(qubo.energy(candidate)).toBeCloseTo(expected);
      }
    },
  );

  it("serializes JSON, CSV, and Matrix Market without losing QUBO metadata", () => {
    const qubo = lweToQUBO(
      [
        [1, 0, 2, -1],
        [0, 2, -1, 3],
        [3, 1, 0, 2],
        [-1, 2, 1, 0],
      ],
      [1, 2, 3, 4],
      "symmetric",
    );
    const json = JSON.parse(serializeQUBO(qubo, "json")) as {
      offset: number;
      representation: string;
      matrix: number[][];
    };

    expect(json.offset).toBe(qubo.offset);
    expect(json.representation).toBe("symmetric");
    expect(json.matrix).toEqual(qubo.matrix);
    expect(serializeQUBO(qubo, "csv").split("\n")).toHaveLength(5);
    expect(serializeQUBO(qubo, "mtx")).toContain("% representation: symmetric");
  });
});

describe("solvers", () => {
  it("brute force finds and verifies the global optimum", async () => {
    const instance = generateLWEInstance({
      n: 4,
      m: 12,
      noiseBound: 0,
      seed: 43,
    });
    const qubo = lweToQUBO(instance.A, instance.b);
    const result = await new BruteForceSolver().solve(qubo, {
      trueSecret: instance.secret,
    });

    expect(result.energy).toBeCloseTo(0);
    expect(result.solution).toEqual(instance.secret);
    expect(result.isCorrect).toBe(true);
    expect(result.hammingDistance).toBe(0);
    expect(result.extraInfo.statesEvaluated).toBe(16);
    expect(result.trace.length).toBeGreaterThan(0);
    expect(result.trace.length).toBeLessThanOrEqual(2048);
  });

  it("brute force reports the exact minimum when ties exist", async () => {
    const qubo = new QUBO(
      [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
      3,
      "upper_triangular",
    );
    const result = await new BruteForceSolver().solve(qubo);

    expect(result.solution).toEqual([0, 0, 0, 0]);
    expect(result.energy).toBe(3);
    expect(result.extraInfo.statesEvaluated).toBe(16);
  });

  it("does not start an intractable brute-force search above the supported size", async () => {
    const qubo = new QUBO(
      Array.from({ length: 17 }, () => Array<number>(17).fill(0)),
      0,
      "symmetric",
    );
    await expect(new BruteForceSolver().solve(qubo)).rejects.toThrow(
      /at most 16 variables/,
    );
  });

  it("evaluates the full 16-bit search space", async () => {
    const qubo = new QUBO(
      Array.from({ length: 16 }, () => Array<number>(16).fill(0)),
      0,
      "symmetric",
    );
    const result = await new BruteForceSolver().solve(qubo);

    expect(result.extraInfo.statesEvaluated).toBe(65_536);
    expect(result.solution).toEqual(Array<number>(16).fill(0));
  });

  it("runs seeded annealing and tabu searches reproducibly", async () => {
    const qubo = lweToQUBO(
      [
        [1, 2, 0, 1],
        [-1, 0, 3, 2],
        [2, 1, 1, -2],
        [0, 3, -1, 2],
      ],
      [2, 1, -1, 3],
    );
    const options = { seed: 12, traceLimit: 50 };
    const annealer = new SimulatedAnnealingSolver({
      numReads: 3,
      numSweeps: 40,
    });
    const tabu = new TabuSearchSolver({
      numRestarts: 3,
      maxIterations: 40,
    });
    const annealingA = await annealer.solve(qubo, options);
    const annealingB = await annealer.solve(qubo, options);
    const tabuA = await tabu.solve(qubo, options);
    const tabuB = await tabu.solve(qubo, options);

    expect(annealingA.solution).toEqual(annealingB.solution);
    expect(annealingA.trace).toEqual(annealingB.trace);
    expect(tabuA.solution).toEqual(tabuB.solution);
    expect(tabuA.trace).toEqual(tabuB.trace);
    expect(annealingA.energy).toBe(qubo.energy(annealingA.solution));
    expect(tabuA.energy).toBe(qubo.energy(tabuA.solution));
  });

  it("matches the exact minimum on a seeded noiseless instance", async () => {
    const instance = generateLWEInstance({
      n: 4,
      m: 12,
      noiseBound: 0,
      seed: 43,
    });
    const qubo = lweToQUBO(instance.A, instance.b);
    const exact = await new BruteForceSolver().solve(qubo);
    const annealed = await new SimulatedAnnealingSolver({
      numReads: 20,
      numSweeps: 500,
    }).solve(qubo, { seed: 7, trueSecret: instance.secret });
    const tabu = await new TabuSearchSolver({
      numRestarts: 20,
      maxIterations: 100,
    }).solve(qubo, { seed: 7, trueSecret: instance.secret });

    expect(annealed.energy).toBeCloseTo(exact.energy);
    expect(annealed.isCorrect).toBe(true);
    expect(tabu.energy).toBeCloseTo(exact.energy);
    expect(tabu.isCorrect).toBe(true);
  });

  it("supports cooperative cancellation", async () => {
    const qubo = new QUBO(
      [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
      0,
      "upper_triangular",
    );
    await expect(
      new BruteForceSolver().solve(qubo, {
        yieldEvery: 1,
        yieldControl: async () => {},
        shouldCancel: () => true,
      }),
    ).rejects.toBeInstanceOf(SolverCancelledError);
  });
});
