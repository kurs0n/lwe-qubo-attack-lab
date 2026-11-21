import type {
  SolverProgress,
  SolverResult,
  SolverStep,
} from "@lwe-qubo/core";

export type SolverName = "bruteForce" | "simulatedAnnealing" | "tabuSearch";

export interface RunSolverMessage {
  readonly type: "run";
  readonly runId: number;
  readonly n: number;
  readonly m: number;
  readonly noiseBound: number;
  readonly seed: number;
  readonly solver: SolverName;
}

export interface CancelSolverMessage {
  readonly type: "cancel";
  readonly runId: number;
}

export type WorkerInput = RunSolverMessage | CancelSolverMessage;

export type WorkerOutput =
  | {
      readonly type: "progress";
      readonly runId: number;
      readonly progress: SolverProgress;
    }
  | {
      readonly type: "trace";
      readonly runId: number;
      readonly steps: readonly SolverStep[];
    }
  | {
      readonly type: "done";
      readonly runId: number;
      readonly instance: {
        readonly A: readonly (readonly number[])[];
        readonly b: readonly number[];
        readonly n: number;
        readonly m: number;
        readonly noiseBound: number;
      };
      readonly qubo: {
        readonly matrix: readonly (readonly number[])[];
        readonly offset: number;
      };
      readonly result: Omit<SolverResult, "trace">;
    }
  | {
      readonly type: "cancelled";
      readonly runId: number;
    }
  | {
      readonly type: "error";
      readonly runId: number;
      readonly message: string;
    };
