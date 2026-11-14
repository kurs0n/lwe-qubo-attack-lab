"""Simulated-annealing QUBO solver using dwave-samplers."""

from time import perf_counter

from dwave.samplers import SimulatedAnnealingSampler
from numpy.typing import ArrayLike

from lwe_qubo.qubo.converter import QUBO
from lwe_qubo.solvers.base import BaseSolver, SolverResult


class SimulatedAnnealingSolver(BaseSolver):
    """Solve QUBOs with D-Wave's local simulated annealing sampler."""

    def __init__(self, num_sweeps: int = 1000) -> None:
        if isinstance(num_sweeps, bool) or not isinstance(num_sweeps, int) or num_sweeps < 1:
            raise ValueError("num_sweeps must be a positive integer")
        self.num_sweeps = num_sweeps
        self._sampler = SimulatedAnnealingSampler()

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
            num_sweeps=self.num_sweeps,
            seed=seed,
        )
        return self._build_result(qubo, samples, started_at, num_reads, secret)
