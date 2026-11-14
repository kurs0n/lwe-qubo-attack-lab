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
| **Web Application & Infrastructure** *(Kacper Sikora)* | FastAPI backend, React frontend, Plotly heatmap visualization, Docker & Compose setup | Enforce clean REST interfaces with Pydantic request/response schemas. Keep UI components modular, responsive, and provide clear user feedback (loading spinners, progress indicators) during long-running solver calls. |
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

### 4.1 Backend Architecture (`backend/app/`)
```
backend/app/
├── api/
│   ├── routes_lwe.py        # POST /api/lwe/generate
│   ├── routes_qubo.py       # POST /api/qubo/convert, /api/qubo/export
│   ├── routes_solvers.py    # POST /api/solvers/run
│   └── routes_benchmark.py  # POST /api/benchmark/batch
├── core/
│   └── config.py            # Global configuration (CORS, timeouts, max n)
├── crypto/
│   ├── lwe_instance.py      # Pydantic & dataclass representation of LWE instance
│   └── generator.py         # Deterministic instance generation with seed
├── qubo/
│   ├── converter.py         # Numpy & dimod BQM converter
│   └── exporter.py          # JSON, CSV, Matrix Market serialization
├── solvers/
│   ├── base.py              # BaseSolver abstract class & SolverResult model
│   ├── brute_force.py       # Fast vectorized exhaustive search
│   ├── simulated_annealing.py # dwave-samplers SimulatedAnnealingSampler wrapper
│   ├── tabu_search.py       # dwave-samplers TabuSampler wrapper
│   └── qaoa_solver.py       # (Optional) QAOA circuit simulation
└── analysis/
    └── benchmark.py         # Batch runner calculating success rates and execution times
```

### 4.2 Standard Solver Interface
All solver implementations must inherit from `BaseSolver` and return a standard `SolverResult`:

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

### 4.3 Frontend Guidelines (`frontend/src/`)
- Built with React (functional components and hooks) and styled with clean Tailwind CSS.
- Heatmap visualization for matrix $Q$ must use Plotly:
  - Diverging color scale centered at zero (e.g., `RdBu` or `Viridis`).
  - Labeled axes corresponding to binary variables $s_0, s_1, \dots, s_{n-1}$.
  - Hover tooltips showing row, column, and exact coefficient value.
- Clear error handling for validation errors (e.g., if $n > 16$ or $m < n$).
- Benchmark view displaying Plotly bar/line charts comparing solver accuracy and runtime.

---

## 5. Engineering Quality & Testing Requirements

Before concluding any development turn, AI agents must ensure:
1. **Typing & Linting:**
   - Strict Python 3.10+ typing annotations (`mypy` compatible).
   - Clean docstrings and adherence to PEP 8 standards.
2. **Automated Testing Suite (`pytest`):**
   - Unit tests for LWE generator: matrix dimensions, binary secret validation, bounded noise vectors.
   - Unit tests for QUBO conversion: algebraic equivalence check between $\|As - b\|^2$ and $s^T Q s + C$.
   - Solver correctness: verify that `BruteForceSolver` consistently uncovers the global optimum on small instances ($n \le 8$).
   - Solver consistency: check that `SimulatedAnnealing` matches Brute Force on noiseless instances ($e = 0$).
3. **Sandbox & Dependencies:**
   - Solvers must execute locally without depending on external cloud tokens (use `dwave-samplers`, not live D-Wave Advantage QPU unless explicitly configured).

---

## 6. Milestones Reference for Agent Context

- **Stage 1 (Completed):** Team setup, repository creation, literature survey.
- **Stage 2 (In Progress / Nov 4–24):** Core concept & prototype: LWE $\to$ QUBO conversion engine, initial Brute Force & SA solvers, API & React skeletons.
- **Stage 3 (Nov 25 – Dec 7/8):** Demonstrator version: Tabu Search solver, unified solver interfaces, heatmap UI, unit test suites.
- **Stage 4 (Dec 9 – Jan 5):** Full functionality: benchmark suite ($n \in [4, 16]$, noise sweeps), Plotly analytics, Docker containerization.
- **Stage 5 (Jan 6 – Jan 26):** Polish, final report documentation, demo video recording, rehearsal, and presentation.
