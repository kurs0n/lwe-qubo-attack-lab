"""Reproducible generation of small, non-modular LWE instances."""

import numpy as np

from lwe_qubo.crypto.lwe_instance import LWEInstance


def generate_lwe_instance(
    n: int,
    m: int,
    noise_bound: int = 1,
    seed: int | None = None,
    coefficient_bound: int = 10,
) -> LWEInstance:
    """Generate an integer instance with uniform bounded secret and error.

    Matrix entries are sampled uniformly from
    ``[-coefficient_bound, coefficient_bound]`` and error entries from
    ``[-noise_bound, noise_bound]`` (both inclusive).
    """
    if isinstance(n, bool) or not isinstance(n, (int, np.integer)) or not 4 <= n <= 16:
        raise ValueError("n must be an integer between 4 and 16")
    if isinstance(m, bool) or not isinstance(m, (int, np.integer)) or m < n:
        raise ValueError("m must be an integer greater than or equal to n")
    if (
        isinstance(noise_bound, bool)
        or not isinstance(noise_bound, (int, np.integer))
        or noise_bound < 0
    ):
        raise ValueError("noise_bound must be a non-negative integer")
    if (
        isinstance(coefficient_bound, bool)
        or not isinstance(coefficient_bound, (int, np.integer))
        or coefficient_bound < 1
    ):
        raise ValueError("coefficient_bound must be a positive integer")

    rng = np.random.default_rng(seed)
    matrix = rng.integers(-coefficient_bound, coefficient_bound + 1, size=(m, n))
    secret = rng.integers(0, 2, size=n)
    error = rng.integers(-noise_bound, noise_bound + 1, size=m)
    observations = matrix @ secret + error

    return LWEInstance(
        A=matrix,
        secret=secret,
        error=error,
        b=observations,
        noise_bound=int(noise_bound),
    )
