"""Serialization for QUBO matrices."""

import csv
import json
from pathlib import Path
from typing import Literal

from lwe_qubo.qubo.converter import QUBO

ExportFormat = Literal["json", "csv", "mtx"]


def export_qubo(
    qubo: QUBO,
    path: str | Path,
    file_format: ExportFormat | None = None,
) -> Path:
    """Write a QUBO as JSON, CSV coefficients, or Matrix Market array.

    JSON preserves the offset and representation. Matrix Market includes both
    as valid comment metadata. CSV contains only the coefficient matrix.
    """
    destination = Path(path)
    selected_format = file_format or _format_from_suffix(destination)
    if selected_format not in ("json", "csv", "mtx"):
        raise ValueError("file_format must be 'json', 'csv', or 'mtx'")

    if selected_format == "json":
        payload = {
            "matrix": qubo.matrix.tolist(),
            "offset": qubo.offset,
            "representation": qubo.representation,
        }
        destination.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    elif selected_format == "csv":
        with destination.open("w", newline="", encoding="utf-8") as output:
            writer = csv.writer(output)
            writer.writerows(qubo.matrix.tolist())
    else:
        _write_matrix_market(qubo, destination)

    return destination


def _format_from_suffix(path: Path) -> ExportFormat:
    suffix = path.suffix.lower()
    if suffix == ".json":
        return "json"
    if suffix == ".csv":
        return "csv"
    if suffix in (".mtx", ".mm"):
        return "mtx"
    raise ValueError("could not infer format; use .json, .csv, or .mtx")


def _write_matrix_market(qubo: QUBO, path: Path) -> None:
    size = qubo.matrix.shape[0]
    with path.open("w", encoding="utf-8") as output:
        output.write("%%MatrixMarket matrix array real general\n")
        output.write(f"% offset: {qubo.offset:.17g}\n")
        output.write(f"% representation: {qubo.representation}\n")
        output.write(f"{size} {size}\n")
        for value in qubo.matrix.flatten(order="F"):
            output.write(f"{value:.17g}\n")
