"""Validated data model for integer-valued LWE instances."""

from dataclasses import dataclass

import numpy as np
from numpy.typing import ArrayLike, NDArray


def _integer_array(name: str, values: ArrayLike) -> NDArray[np.int64]:
    raw = np.asarray(values)
    if raw.dtype.kind not in "iuf":
        raise ValueError(f"{name} must contain finite integer values")

    if raw.dtype.kind == "f":
        int64 = np.iinfo(np.int64)
        if (
            not np.all(np.isfinite(raw))
            or np.any(raw != np.trunc(raw))
            or np.any(raw < int64.min)
            or np.any(raw >= 2**63)
        ):
            raise ValueError(f"{name} must contain finite integer values")
    elif raw.dtype.kind == "u" and np.any(raw > np.iinfo(np.int64).max):
        raise ValueError(f"{name} contains values outside the int64 range")

    return np.array(raw, dtype=np.int64, copy=True)


@dataclass(frozen=True)
class LWEInstance:
    """An integer linear observation ``b = A @ secret + error``.

    This model intentionally represents the non-modular least-squares problem.
    Modular observations need a different objective and are not silently
    interpreted as ordinary Euclidean residuals.
    """

    A: ArrayLike
    secret: ArrayLike
    error: ArrayLike
    b: ArrayLike
    noise_bound: int | None = None

    def __post_init__(self) -> None:
        matrix = _integer_array("A", self.A)
        secret = _integer_array("secret", self.secret)
        error = _integer_array("error", self.error)
        observations = _integer_array("b", self.b)

        if matrix.ndim != 2:
            raise ValueError("A must be a two-dimensional matrix")
        m, n = matrix.shape
        if not 4 <= n <= 16:
            raise ValueError("A must have between 4 and 16 columns")
        if m < n:
            raise ValueError("A must have at least as many rows as columns")
        if secret.shape != (n,):
            raise ValueError(f"secret must have shape ({n},)")
        if not np.all((secret == 0) | (secret == 1)):
            raise ValueError("secret must contain only 0 or 1")
        if error.shape != (m,):
            raise ValueError(f"error must have shape ({m},)")
        if observations.shape != (m,):
            raise ValueError(f"b must have shape ({m},)")
        if not np.array_equal(observations, matrix @ secret + error):
            raise ValueError("b must equal A @ secret + error")
        if self.noise_bound is not None:
            if (
                isinstance(self.noise_bound, bool)
                or not isinstance(self.noise_bound, (int, np.integer))
                or self.noise_bound < 0
            ):
                raise ValueError("noise_bound must be a non-negative integer")
            if np.any(error > self.noise_bound) or np.any(error < -self.noise_bound):
                raise ValueError("error exceeds noise_bound")

        for array in (matrix, secret, error, observations):
            array.setflags(write=False)

        object.__setattr__(self, "A", matrix)
        object.__setattr__(self, "secret", secret)
        object.__setattr__(self, "error", error)
        object.__setattr__(self, "b", observations)
        if self.noise_bound is not None:
            object.__setattr__(self, "noise_bound", int(self.noise_bound))

    @property
    def m(self) -> int:
        """Number of observations."""
        return int(self.A.shape[0])

    @property
    def n(self) -> int:
        """Secret-key length."""
        return int(self.A.shape[1])
