import numpy as np
import pytest

from lwe_qubo.crypto.generator import generate_lwe_instance
from lwe_qubo.crypto.lwe_instance import LWEInstance


def test_generator_is_reproducible_and_respects_dimensions_and_noise() -> None:
    first = generate_lwe_instance(n=4, m=7, noise_bound=2, seed=31)
    second = generate_lwe_instance(n=4, m=7, noise_bound=2, seed=31)

    assert first.A.shape == (7, 4)
    assert first.secret.shape == (4,)
    assert first.b.shape == (7,)
    assert np.all((first.secret == 0) | (first.secret == 1))
    assert np.all(np.abs(first.error) <= 2)
    np.testing.assert_array_equal(first.A, second.A)
    np.testing.assert_array_equal(first.secret, second.secret)
    np.testing.assert_array_equal(first.error, second.error)
    np.testing.assert_array_equal(first.b, first.A @ first.secret + first.error)


@pytest.mark.parametrize(
    ("n", "m", "noise_bound", "coefficient_bound"),
    [(3, 4, 1, 10), (4, 3, 1, 10), (4, 4, -1, 10), (4, 4, 1, 0)],
)
def test_generator_rejects_invalid_parameters(
    n: int, m: int, noise_bound: int, coefficient_bound: int
) -> None:
    with pytest.raises(ValueError):
        generate_lwe_instance(n, m, noise_bound, coefficient_bound=coefficient_bound)


def test_instance_rejects_observation_mismatch() -> None:
    with pytest.raises(ValueError, match="b must equal"):
        LWEInstance(
            A=np.zeros((4, 4), dtype=int),
            secret=np.zeros(4, dtype=int),
            error=np.zeros(4, dtype=int),
            b=np.ones(4, dtype=int),
        )
