import json

import numpy as np
import pytest

from lwe_qubo.qubo.converter import QUBO, lwe_to_qubo
from lwe_qubo.qubo.exporter import export_qubo


@pytest.mark.parametrize("representation", ["upper_triangular", "symmetric"])
def test_qubo_energy_matches_least_squares_for_every_binary_candidate(
    representation: str,
) -> None:
    A = np.array([[2, -1, 0, 3], [1, 4, -2, 0], [0, 1, 2, -1], [3, 0, 1, 2]])
    b = np.array([4, -2, 3, 5])
    qubo = lwe_to_qubo(A, b, representation=representation)

    if representation == "upper_triangular":
        assert np.allclose(np.tril(qubo.matrix, k=-1), 0)
    else:
        np.testing.assert_allclose(qubo.matrix, qubo.matrix.T)

    for bits in range(1 << A.shape[1]):
        candidate = np.array([(bits >> index) & 1 for index in range(A.shape[1])])
        expected = np.sum((A @ candidate - b) ** 2)
        assert qubo.energy(candidate) == pytest.approx(expected)


def test_zero_noise_secret_has_zero_total_energy() -> None:
    A = np.arange(16).reshape(4, 4) - 5
    secret = np.array([1, 0, 1, 1])
    qubo = lwe_to_qubo(A, A @ secret)

    assert qubo.energy(secret) == pytest.approx(0.0, abs=1e-10)


def test_export_json_preserves_matrix_offset_and_representation(tmp_path) -> None:
    qubo = lwe_to_qubo(np.eye(4), np.array([1, 2, 3, 4]), "symmetric")
    destination = export_qubo(qubo, tmp_path / "qubo.json")
    data = json.loads(destination.read_text(encoding="utf-8"))

    assert data["representation"] == "symmetric"
    assert data["offset"] == qubo.offset
    np.testing.assert_allclose(data["matrix"], qubo.matrix)


def test_export_matrix_market_contains_offset_metadata(tmp_path) -> None:
    qubo = lwe_to_qubo(np.eye(4), np.ones(4))
    destination = export_qubo(qubo, tmp_path / "qubo.mtx")
    contents = destination.read_text(encoding="utf-8")

    assert contents.startswith("%%MatrixMarket matrix array real general\n")
    assert "% offset: 4" in contents


def test_energy_rejects_non_binary_candidates() -> None:
    qubo = QUBO(np.eye(4), 0, "symmetric")

    with pytest.raises(ValueError, match="only 0 or 1"):
        qubo.energy([0, 0, 2, 1])
