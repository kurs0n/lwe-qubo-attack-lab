"""Tabu-search QUBO solver using dwave-samplers."""

from time import perf_counter

from dwave.samplers import TabuSampler
from numpy.typing import ArrayLike

from lwe_qubo.qubo.converter import QUBO
from lwe_qubo.solvers.base import BaseSolver, SolverResult


class TabuSearchSolver(BaseSolver):
    """Solve QUBOs with D-Wave's local tabu-search sampler."""

    def __init__(
        self,
        tenure: int | None = None,
        num_restarts: int = 1000,
    ) -> None:
        if tenure is not None and (
            isinstance(tenure, bool) or not isinstance(tenure, int) or tenure < 1
        ):
            raise ValueError("tenure must be a positive integer or None")
        if (
            isinstance(num_restarts, bool)
            or not isinstance(num_restarts, int)
            or num_restarts < 1
        ):
            raise ValueError("num_restarts must be a positive integer")
        self.tenure = tenure
        self.num_restarts = num_restarts
        self._sampler = TabuSampler()

    def solve(
        self,
        qubo: QUBO,
        *,
        num_reads: int = 100,
        seed: int | None = None,
        true_secret: ArrayLike | None = None,
    ) -> SolverResult:
        secret = self._validate_inputs(qubo, num_reads, seed, true_secret)
        started_at = perf_counter()
        samples = self._sampler.sample_qubo(
            self._to_sampler_qubo(qubo),
            num_reads=num_reads,
            tenure=self.tenure,
            num_restarts=self.num_restarts,
            seed=seed,
        )
        return self._build_result(qubo, samples, started_at, num_reads, secret)
