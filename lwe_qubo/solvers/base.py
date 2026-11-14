"""Shared result and input handling for classical samplers."""

from abc import ABC, abstractmethod
from collections.abc import Mapping
from dataclasses import dataclass, field
from time import perf_counter
from typing import Protocol

import numpy as np
from numpy.typing import ArrayLike

from lwe_qubo.qubo.converter import QUBO

QUBOTerms = dict[tuple[int, int], float]


class SampleRecord(Protocol):
    """The first-record interface shared by dimod sample sets."""

    sample: Mapping[int, int]
    energy: float


class SampleSet(Protocol):
    """The best-sample interface shared by dimod sample sets."""

    first: SampleRecord


@dataclass(frozen=True)
class SolverResult:
    """Best solution returned by a classical sampler."""

    solution: list[int]
    energy: float
    execution_time_ms: float
    is_correct: bool | None = None
    hamming_distance: int | None = None
    extra_info: dict[str, int | float | str] = field(default_factory=dict)


class BaseSolver(ABC):
    """Common interface for solvers backed by dwave-samplers."""

    @abstractmethod
    def solve(
        self,
        qubo: QUBO,
        *,
        num_reads: int = 100,
        seed: int | None = None,
        true_secret: ArrayLike | None = None,
    ) -> SolverResult:
        """Minimize a QUBO, optionally comparing the result to its known secret."""

    @staticmethod
    def _validate_inputs(
        qubo: QUBO,
        num_reads: int,
        seed: int | None,
        true_secret: ArrayLike | None,
    ) -> np.ndarray | None:
        if isinstance(num_reads, bool) or not isinstance(num_reads, int) or num_reads < 1:
            raise ValueError("num_reads must be a positive integer")
        if seed is not None and (
            isinstance(seed, bool)
            or not isinstance(seed, int)
            or not 0 <= seed <= np.iinfo(np.uint32).max
        ):
            raise ValueError("seed must be an integer between 0 and 2**32 - 1")
        if true_secret is None:
            return None

        secret = np.asarray(true_secret)
        if secret.shape != (qubo.matrix.shape[0],):
            raise ValueError(f"true_secret must have shape ({qubo.matrix.shape[0]},)")
        if secret.dtype.kind not in "iuf" or not np.all((secret == 0) | (secret == 1)):
            raise ValueError("true_secret must contain only 0 or 1")
        return secret.astype(np.int8, copy=False)

    @staticmethod
    def _to_sampler_qubo(qubo: QUBO) -> QUBOTerms:
        """Convert either supported matrix convention to D-Wave QUBO terms."""
        terms: QUBOTerms = {}
        size = qubo.matrix.shape[0]
        for i in range(size):
            terms[(i, i)] = float(qubo.matrix[i, i])
            for j in range(i + 1, size):
                coefficient = float(qubo.matrix[i, j])
                if qubo.representation == "symmetric":
                    coefficient += float(qubo.matrix[j, i])
                if coefficient != 0.0:
                    terms[(i, j)] = coefficient
        return terms

    @staticmethod
    def _build_result(
        qubo: QUBO,
        samples: SampleSet,
        started_at: float,
        num_reads: int,
        true_secret: np.ndarray | None,
    ) -> SolverResult:
        solution = [
            int(samples.first.sample[index])
            for index in range(qubo.matrix.shape[0])
        ]
        correct = None
        distance = None
        if true_secret is not None:
            correct = bool(np.array_equal(solution, true_secret))
            distance = int(np.count_nonzero(np.asarray(solution) != true_secret))

        return SolverResult(
            solution=solution,
            energy=qubo.energy(solution),
            execution_time_ms=(perf_counter() - started_at) * 1000.0,
            is_correct=correct,
            hamming_distance=distance,
            extra_info={
                "num_reads": num_reads,
                "sampler_energy": float(samples.first.energy + qubo.offset),
            },
        )
