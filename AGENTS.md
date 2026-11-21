# AI Agent Guidelines & Operating Manual (AGENTS.md)

This document establishes operational directives, architectural standards, mathematical conventions, and role-based responsibilities for AI coding agents collaborating on the **`lwe-qubo-attack-lab`** repository.

---

## 1. Project Mission & Technical Context

The purpose of this repository is to implement, evaluate, and benchmark an attack against a simplified post-quantum cryptographic scheme—**Learning With Errors (LWE)**—by reducing it to **Quadratic Unconstrained Binary Optimization (QUBO)** and solving it via classical exhaustive search, metaheuristics, and quantum/simulated quantum solvers.

- **Secret Key:** Binary vector $s \in \{0, 1\}^n$, with $n \in [4, 16]$.
- **Observation Equation:** $b = As + e$, where $A \in \mathbb{Z}^{m \times n}$, $e \in \mathbb{Z}^m$ (bounded error/noise), and $b \in \mathbb{Z}^m$ ($m \ge n$).
- **Objective:** Recover secret $s$ from known public data $(A, b)$ by minimizing $\|As - b\|^2$.
- **Solvers:**
  1. *Brute Force* (exhaustive $2^n$ search; serves as the ground-truth baseline).
  2. *Simulated Annealing* (`dwave-samplers`).
  3. *Tabu Search* (`dwave-samplers`).
  4. *QAOA* (optional quantum-simulated optimization via Qiskit or PennyLane for small $n$).

---

## 2. Team Personas & Responsibility Boundaries

When taking on tasks, agents must align their scope, conventions, and style with the corresponding area owner:

| Area / Persona | Scope & Responsibility | Operational Directives for Agents |
|---|---|---|
| **Cryptography & QUBO Model** *(Patryk Kurek)* | Parameterized LWE generator $(n, m, q, e)$, mathematical QUBO reduction, matrix exporter, energy landscape validation | Ensure rigorous mathematical definitions, correct noise distribution handling, check that zero-noise instances yield global minimum energy matching the ground-truth key $s$, and verify upper-triangular vs symmetric matrix consistency. |
| **Optimization Solvers** *(Piotr Ziobrowski)* | Solver implementations, unified `BaseSolver` abstraction, benchmark scripts, timing profilers | Ensure reproducibility by accepting explicit random `seed` parameters. Profile execution using high-resolution monotonic clocks (`time.perf_counter()`). Maintain compatibility with `dimod.BinaryQuadraticModel` and `dwave-samplers`. |
| **Web Application & Interactive Article** *(Kacper Sikora)* | React/TypeScript article, interactive visualizations, Web Worker integration, static deployment | Keep the UI modular and responsive. Run long computations off the main thread and provide progress and cancellation feedback. Do not add a runtime API/backend without a concrete requirement. |
| **Testing, Quality & Docs** *(Wojciech Marcela)* | Unit & integration tests (`pytest`), statistical analysis, experimental notebooks/scripts, final reporting | Maintain robust test coverage (edge cases $n=4$, $e=0$, invalid matrix dimensions). Verify that heuristic energies closely track Brute Force results. Keep documentation synchronized with codebase changes. |

---

## 3. Mathematical Specifications & LWE $\to$ QUBO Derivation

Every code module converting LWE instances into QUBO matrices must strictly follow this mathematical transformation:

### 3.1 Derivation
Given public matrix $A \in \mathbb{R}^{m \times n}$ and observation vector $b \in \mathbb{R}^m$, the least-squares optimization is:
$$\min_{s \in \{0, 1\}^n} \|As - b\|^2$$

Expanding the inner product:
$$\|As - b\|^2 = (As - b)^T (As - b) = s^T (A^T A) s - 2 (A^T b)^T s + b^T b$$

Because $s_i \in \{0, 1\}$ is binary, $s_i^2 = s_i$. The linear term $-2 (A^T b)_i s_i$ can be merged directly into the quadratic diagonal elements $s_i^2$:
$$s^T (A^T A) s - 2 (A^T b)^T s = \sum_{i=1}^n \left( (A^T A)_{ii} - 2(A^T b)_i \right) s_i + \sum_{i \neq j} (A^T A)_{ij} s_i s_j$$

### 3.2 Canonical Matrix Representations
Agents must support two output representations:

1. **Upper-Triangular Matrix (D-Wave standard)**:
   - For $i = j$:
     $$Q_{ii} = (A^T A)_{ii} - 2(A^T b)_i$$
   - For $i < j$:
     $$Q_{ij} = 2 (A^T A)_{ij}$$
   - For $i > j$:
     $$Q_{ij} = 0$$

2. **Symmetric Matrix**:
   - For $i = j$:
     $$Q_{ii} = (A^T A)_{ii} - 2(A^T b)_i$$
   - For $i \neq j$:
     $$Q_{ij} = (A^T A)_{ij}$$

### 3.3 Energy Offset & Verification Condition
- **Energy Offset:** $C = b^T b = \|b\|^2$.
- The total reconstructed energy for a candidate vector $\hat{s}$ is:
  $$E(\hat{s}) = \hat{s}^T Q \hat{s} + C = \|A\hat{s} - b\|^2$$
- In the noiseless case ($e = \mathbf{0}$), when $\hat{s} = s$, the total energy must evaluate to exactly $0.0$.
- In the noisy case ($b = As + e$), the energy of the true secret is $E(s) = \|e\|^2$.

---

## 4. Software Architecture & Implementation Conventions

### 4.1 Application Architecture (No Runtime Backend)

The repository contains a Python library and a TypeScript workspace. There is no web backend. The static web application runs the interactive core in the browser:

```
packages/core/   # Pure TypeScript: browser LWE, QUBO, solvers, seeded RNG, trace types
frontend/        # Vite + React: static interactive article and playground
```

Run browser solvers in Web Workers. Use the existing Python library for manual experiments and `dwave-samplers` reference runs; the frontend does not need a benchmark CLI or request-serving backend. If the article later needs precomputed research charts, generate and commit their JSON from Python. Do not add FastAPI, REST endpoints, or backend deployment infrastructure unless requirements change.

### 4.2 Standard Solver Interface
Python solver implementations must inherit from `BaseSolver` and return a standard `SolverResult`. The TypeScript core uses its own typed result and trace contracts; keep those pure and independent from Python classes:

```python
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional
from pydantic import BaseModel
import numpy as np

class SolverResult(BaseModel):
    solution: List[int]                  # Recovered binary secret vector s
    energy: float                        # Evaluated QUBO energy (s^T Q s + offset)
    execution_time_ms: float             # Measured solver execution time in milliseconds
    is_correct: Optional[bool] = None    # Evaluated if ground-truth secret s is provided
    hamming_distance: Optional[int] = None # Hamming distance from true secret
    extra_info: Dict[str, Any] = {}      # Solver-specific metrics (e.g. sample count, num_reads)

class BaseSolver(ABC):
    @abstractmethod
    def solve(self, Q: np.ndarray, offset: float = 0.0, **kwargs) -> SolverResult:
        """
        Solves min s^T Q s + offset for s in {0,1}^n.
        
        Args:
            Q: Square QUBO matrix (upper-triangular or symmetric).
            offset: Scalar constant energy offset (b^T b).
            **kwargs: Hyperparameters (num_reads, sweeps, tabu_tenure, seed, etc.).
        """
        pass
```

### 4.3 Frontend & Interactive Article Guidelines

The frontend's goal is an explorable, interactive article that explains the LWE-to-QUBO attack—not just a dashboard. The proposed frontend architecture is:

```text
packages/core/   # Pure TypeScript: LWE generator, QUBO reduction, solvers, seeded RNG, trace types
frontend/        # Vite + React: article, visualizations, and interactive playground
```

The TypeScript core and web application are implemented. The Python package is retained as a separate local library and reference implementation; it is not a web service. TypeScript is the source used by the browser, while manual experiments use Python. When changing shared mathematics, keep both implementations aligned with tests or shared fixtures, and do not silently remove the Python package. The small problem sizes ($n \le 16$) are suitable for TypeScript; avoid introducing Rust/WASM without measured evidence that it is needed.

- Use React with TypeScript. Keep `packages/core` independent of the DOM and React so it can run in both Node and browser environments.
- Build the frontend as a static application with no runtime API/backend dependency. Use the Python library for manual experiments and optional `dwave-samplers` reference runs or QAOA. If benchmark results are needed in the article, generate them offline in Python and load committed JSON.
- Run interactive solvers in a Web Worker, not on the main thread. Send progress and trace chunks with `postMessage`; support cancellation so computation does not block scrolling or interaction.
- Do not use browser timings as research benchmark results; JIT warm-up, garbage collection, timer precision, and background-tab throttling make them unsuitable. For manual benchmark runs, record the Python version, hardware, and relevant solver parameters.
- Model a solver run as a deterministic, seeded trace of snapshots. A step should contain the iteration, current state, energy, best energy, and solver-specific data such as flipped variable, energy delta, temperature, acceptance, or tabu state. The same trace should power article playback, benchmark export, and golden-fixture tests. Downsample long traces while preserving every best-so-far improvement and other meaningful events.
- Expose traces as a learner-friendly stepper with previous/next, scrubbing, and optional playback. Explain in plain language what the current candidate/state means, whether the move was accepted, how energy changed, and why temperature or tabu restrictions matter. Clearly label sampled traces rather than implying every internal step is shown.
- Scroll position selects a trace/article state; it should not directly drive an irreversible animation. Use a sticky visualization beside narrative steps, with `IntersectionObserver` (or Scrollama) to select the active step. This makes the explanation deterministic, reversible, and scrub-able.
- Prefer D3/SVG for matrices and charts, Observable Plot for standard charts, and KaTeX for equations. Use Canvas only when SVG becomes impractical for a large energy landscape. Do not require Plotly for new article visualizations; its styling and bundle weight are a poor fit for this cohesive editorial experience.
- Prioritize visualizations in this order: energy landscape (enumerate all states for $n \le 12$; consider a hypercube for $n \le 6$), Hamming distance from the true secret over time, QUBO matrix, tabu-list timeline, then simulated-annealing temperature/acceptance. Keep the true secret hidden in attack-facing views and clearly distinguish “the solver found the QUBO optimum” from “the optimum recovered the generated secret.”
- Build the article progressively: introduce the public observations with the secret hidden; explain LWE and noise; show why the search space grows as $2^n$; derive $\|As-b\|^2$ term by term and reveal $Q$; compare brute force, local search, simulated annealing, and tabu behavior; present precomputed benchmark results; then offer a live parameter/solver playground followed by methodology, limitations, and conclusions.
- Deliver incrementally. The current app provides parameter controls, generated public data, a QUBO heatmap, solver results, and an energy trace. Build scrollytelling and energy-landscape exploration on top of that workflow. Static deployment (for example, GitHub Pages) should remain possible, including offline presentation use.

---

## 5. Engineering Quality & Testing Requirements

Before concluding any development turn, AI agents must ensure:
1. **Typing & Linting:**
   - Strict Python 3.10+ typing annotations (`mypy` compatible).
   - TypeScript workspaces must pass `npm run check`; keep core, benchmark code, and browser code type-safe.
   - Clean docstrings and adherence to PEP 8 standards.
2. **Automated Testing Suite (`pytest`):**
   - Unit tests for LWE generator: matrix dimensions, binary secret validation, bounded noise vectors.
   - Unit tests for QUBO conversion: algebraic equivalence check between $\|As - b\|^2$ and $s^T Q s + C$.
   - Solver correctness: verify that `BruteForceSolver` consistently uncovers the global optimum on small instances ($n \le 8$).
   - Solver consistency: check that `SimulatedAnnealing` matches Brute Force on noiseless instances ($e = 0$).
   - TypeScript core behavior must be covered by `npm test`, including brute-force optimality, deterministic seeded runs, and parity between QUBO energy and least-squares residuals.
3. **Sandbox & Dependencies:**
   - Solvers must execute locally without depending on external cloud tokens (use `dwave-samplers`, not live D-Wave Advantage QPU unless explicitly configured).

---

## 6. Milestones Reference for Agent Context

- **Stage 1 (Completed):** Team setup, repository creation, literature survey.
- **Stage 2 (In Progress / Nov 4–24):** Core concept & prototype: LWE $\to$ QUBO conversion engine, initial Brute Force & SA solvers, and a React skeleton.
- **Stage 3 (Nov 25 – Dec 7/8):** Demonstrator version: Tabu Search solver, unified solver interfaces, heatmap UI, unit test suites.
- **Stage 4 (Dec 9 – Jan 5):** Full functionality: benchmark suite ($n \in [4, 16]$, noise sweeps), interactive article, and static visual analytics.
- **Stage 5 (Jan 6 – Jan 26):** Polish, final report documentation, demo video recording, rehearsal, and presentation.
