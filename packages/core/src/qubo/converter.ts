export type QUBORepresentation = "upper_triangular" | "symmetric";

export class QUBO {
  readonly matrix: readonly (readonly number[])[];
  readonly offset: number;
  readonly representation: QUBORepresentation;
  readonly size: number;

  constructor(
    matrix: readonly (readonly number[])[],
    offset: number,
    representation: QUBORepresentation,
  ) {
    if (!Array.isArray(matrix) || matrix.length === 0) {
      throw new TypeError("QUBO matrix must be a non-empty square matrix");
    }
    if (!matrix.every((row) => Array.isArray(row) && row.length === matrix.length)) {
      throw new TypeError("QUBO matrix must be a non-empty square matrix");
    }
    if (!matrix.flat().every(Number.isFinite)) {
      throw new TypeError("QUBO matrix must contain only finite values");
    }
    if (representation !== "upper_triangular" && representation !== "symmetric") {
      throw new TypeError(
        "representation must be 'upper_triangular' or 'symmetric'",
      );
    }
    if (
      representation === "upper_triangular" &&
      matrix.some((row: readonly number[], rowIndex: number) =>
        row.some(
          (value: number, columnIndex: number) =>
            columnIndex < rowIndex && value !== 0,
        ),
      )
    ) {
      throw new TypeError(
        "upper_triangular QUBO matrices must have a zero lower triangle",
      );
    }
    if (
      representation === "symmetric" &&
      matrix.some((row: readonly number[], rowIndex: number) =>
        row.some(
          (value: number, columnIndex: number) =>
            Math.abs(value - (matrix[columnIndex]?.[rowIndex] ?? 0)) >
            1e-8 + 1e-5 * Math.abs(matrix[columnIndex]?.[rowIndex] ?? 0),
        ),
      )
    ) {
      throw new TypeError("symmetric QUBO matrices must be symmetric");
    }
    if (!Number.isFinite(offset)) {
      throw new TypeError("offset must be finite");
    }

    this.matrix = Object.freeze(matrix.map((row) => Object.freeze([...row])));
    this.offset = offset;
    this.representation = representation;
    this.size = matrix.length;
    Object.freeze(this);
  }

  energy(candidate: readonly number[]): number {
    if (!Array.isArray(candidate) || candidate.length !== this.size) {
      throw new RangeError(`candidate must have length ${this.size}`);
    }
    if (candidate.some((bit) => bit !== 0 && bit !== 1)) {
      throw new TypeError("candidate must contain only 0 or 1");
    }
    let energy = this.offset;
    for (let row = 0; row < this.size; row += 1) {
      for (let column = 0; column < this.size; column += 1) {
        energy +=
          (candidate[row] ?? 0) *
          (this.matrix[row]?.[column] ?? 0) *
          (candidate[column] ?? 0);
      }
    }
    return energy;
  }
}

export function lweToQUBO(
  A: readonly (readonly number[])[],
  b: readonly number[],
  representation: QUBORepresentation = "upper_triangular",
): QUBO {
  if (!Array.isArray(A) || A.length === 0 || !Array.isArray(A[0]) || A[0].length === 0) {
    throw new TypeError("A must be a non-empty two-dimensional matrix");
  }
  const rows = A.length;
  const columns = A[0].length;
  if (!A.every((row) => Array.isArray(row) && row.length === columns)) {
    throw new TypeError("A must be a rectangular matrix");
  }
  if (!Array.isArray(b) || b.length !== rows) {
    throw new RangeError(`b must have length ${rows}`);
  }
  if (!A.flat().every(Number.isFinite) || !b.every(Number.isFinite)) {
    throw new TypeError("A and b must contain only finite values");
  }
  if (representation !== "upper_triangular" && representation !== "symmetric") {
    throw new TypeError(
      "representation must be 'upper_triangular' or 'symmetric'",
    );
  }

  const gram = Array.from({ length: columns }, () =>
    Array<number>(columns).fill(0),
  );
  const linear = Array<number>(columns).fill(0);
  for (let i = 0; i < columns; i += 1) {
    for (let row = 0; row < rows; row += 1) {
      const aRow = A[row];
      if (aRow === undefined) {
        throw new Error("Invalid matrix row");
      }
      linear[i] = (linear[i] ?? 0) + (aRow[i] ?? 0) * (b[row] ?? 0);
      for (let j = 0; j < columns; j += 1) {
        gram[i]![j] = (gram[i]![j] ?? 0) + (aRow[i] ?? 0) * (aRow[j] ?? 0);
      }
    }
  }

  const Q = gram.map((row, i) =>
    row.map((value, j) => {
      if (i === j) {
        return value - 2 * (linear[i] ?? 0);
      }
      if (representation === "upper_triangular") {
        return i < j ? 2 * value : 0;
      }
      return value;
    }),
  );
  const offset = b.reduce((sum, value) => sum + value * value, 0);
  return new QUBO(Q, offset, representation);
}
