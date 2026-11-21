import {
  BruteForceSolver,
  generateLWEInstance,
  lweToQUBO,
  SimulatedAnnealingSolver,
  SolverCancelledError,
  TabuSearchSolver,
} from "@lwe-qubo/core";
import type { SolverResult, SolverStep } from "@lwe-qubo/core";
import type {
  RunSolverMessage,
  WorkerInput,
  WorkerOutput,
} from "./worker-protocol";

const cancelledRuns = new Set<number>();
const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<WorkerInput>) => {
  if (event.data.type === "cancel") {
    cancelledRuns.add(event.data.runId);
    return;
  }
  void runSolver(event.data);
};

async function runSolver(message: RunSolverMessage): Promise<void> {
  const { runId } = message;
  const traceBatch: SolverStep[] = [];
  let lastProgressAt = 0;
  const flushTrace = (): void => {
    if (traceBatch.length === 0) {
      return;
    }
    const steps = traceBatch.splice(0, traceBatch.length);
    post({ type: "trace", runId, steps });
  };

  try {
    cancelledRuns.delete(runId);
    const instance = generateLWEInstance({
      n: message.n,
      m: message.m,
      noiseBound: message.noiseBound,
      seed: message.seed,
    });
    const qubo = lweToQUBO(instance.A, instance.b);
    const runtimeOptions = {
      seed: message.seed,
      trueSecret: instance.secret,
      traceLimit: 1600,
      yieldEvery: 256,
      shouldCancel: () => cancelledRuns.has(runId),
      yieldControl: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
      onProgress: (progress: {
        readonly completed: number;
        readonly total: number;
        readonly bestEnergy: number;
      }) => {
        const now = performance.now();
        if (now - lastProgressAt >= 100 || progress.completed === progress.total) {
          post({ type: "progress", runId, progress });
          lastProgressAt = now;
        }
      },
      onStep: (step: SolverStep) => {
        traceBatch.push(step);
        if (traceBatch.length >= 64) {
          flushTrace();
        }
      },
    };

    let result: SolverResult;
    if (message.solver === "bruteForce") {
      result = await new BruteForceSolver().solve(qubo, runtimeOptions);
    } else if (message.solver === "simulatedAnnealing") {
      result = await new SimulatedAnnealingSolver({
        numReads: 10,
        numSweeps: 1000,
      }).solve(qubo, runtimeOptions);
    } else {
      result = await new TabuSearchSolver({
        numRestarts: 10,
        maxIterations: 500,
      }).solve(qubo, runtimeOptions);
    }

    flushTrace();
    const { trace: _trace, ...resultSummary } = result;
    post({
      type: "done",
      runId,
      instance: {
        A: instance.A,
        b: instance.b,
        n: instance.n,
        m: instance.m,
        noiseBound: message.noiseBound,
      },
      qubo: { matrix: qubo.matrix, offset: qubo.offset },
      result: resultSummary,
    });
  } catch (error) {
    flushTrace();
    if (error instanceof SolverCancelledError || cancelledRuns.has(runId)) {
      post({ type: "cancelled", runId });
    } else {
      post({
        type: "error",
        runId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    cancelledRuns.delete(runId);
  }
}

function post(message: WorkerOutput): void {
  workerScope.postMessage(message);
}
