"""Least-squares conversion from LWE observations to QUBO."""

from dataclasses import dataclass
from typing import Literal

import numpy as np
from numpy.typing import ArrayLike, NDArray

QUBORepresentation = Literal["upper_triangular", "symmetric"]


@dataclass(frozen=True)
class QUBO:
    """A QUBO matrix, its constant offset, and its matrix convention."""

    matrix: ArrayLike
    offset: float
    representation: QUBORepresentation

    def __post_init__(self) -> None:
        matrix = np.asarray(self.matrix, dtype=np.float64)
        if matrix.ndim != 2 or matrix.shape[0] != matrix.shape[1] or matrix.shape[0] == 0:
            raise ValueError("QUBO matrix must be a non-empty square matrix")
        if not np.all(np.isfinite(matrix)):
            raise ValueError("QUBO matrix must contain only finite values")
        if self.representation not in ("upper_triangular", "symmetric"):
            raise ValueError("representation must be 'upper_triangular' or 'symmetric'")
        if self.representation == "upper_triangular" and np.any(np.tril(matrix, k=-1) != 0):
            raise ValueError("upper_triangular QUBO matrices must have a zero lower triangle")
        if self.representation == "symmetric" and not np.allclose(matrix, matrix.T):
            raise ValueError("symmetric QUBO matrices must be symmetric")
        if not np.isfinite(self.offset):
            raise ValueError("offset must be finite")

        matrix = np.array(matrix, copy=True)
        matrix.setflags(write=False)
        object.__setattr__(self, "matrix", matrix)
        object.__setattr__(self, "offset", float(self.offset))

    def energy(self, candidate: ArrayLike) -> float:
        """Evaluate ``candidate.T @ Q @ candidate + offset`` for a binary vector."""
        vector = np.asarray(candidate)
        if vector.shape != (self.matrix.shape[0],):
            raise ValueError(f"candidate must have shape ({self.matrix.shape[0]},)")
        if vector.dtype.kind not in "iuf" or not np.all((vector == 0) | (vector == 1)):
            raise ValueError("candidate must contain only 0 or 1")
        vector = vector.astype(np.float64, copy=False)
        return float(vector @ self.matrix @ vector + self.offset)


def lwe_to_qubo(
    A: ArrayLike,
    b: ArrayLike,
    representation: QUBORepresentation = "upper_triangular",
) -> QUBO:
    """Convert ``||A @ s - b||²`` into an equivalent binary QUBO.

    The returned offset is ``b.T @ b``. For the upper-triangular convention,
    off-diagonal entries are doubled; the symmetric convention stores the
    Gram-matrix entries on both sides of the diagonal.
    """
    matrix = np.asarray(A, dtype=np.float64)
    observations = np.asarray(b, dtype=np.float64)
    if matrix.ndim != 2 or matrix.shape[0] == 0 or matrix.shape[1] == 0:
        raise ValueError("A must be a non-empty two-dimensional matrix")
    if observations.shape != (matrix.shape[0],):
        raise ValueError(f"b must have shape ({matrix.shape[0]},)")
    if not np.all(np.isfinite(matrix)) or not np.all(np.isfinite(observations)):
        raise ValueError("A and b must contain only finite values")
    if representation not in ("upper_triangular", "symmetric"):
        raise ValueError("representation must be 'upper_triangular' or 'symmetric'")

    gram = matrix.T @ matrix
    linear = matrix.T @ observations
    if representation == "upper_triangular":
        coefficients = np.triu(2.0 * gram, k=1)
    else:
        coefficients = gram.copy()
    diagonal = np.diag_indices_from(coefficients)
    coefficients[diagonal] = np.diag(gram) - 2.0 * linear

    return QUBO(
        matrix=coefficients,
        offset=float(observations @ observations),
        representation=representation,
    )
