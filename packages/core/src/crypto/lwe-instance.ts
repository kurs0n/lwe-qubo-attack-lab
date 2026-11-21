export interface LWEInstanceInput {
  readonly A: readonly (readonly number[])[];
  readonly secret: readonly number[];
  readonly error: readonly number[];
  readonly b: readonly number[];
  readonly noiseBound?: number;
}

export interface LWEInstance {
  readonly A: readonly (readonly number[])[];
  readonly secret: readonly number[];
  readonly error: readonly number[];
  readonly b: readonly number[];
  readonly noiseBound: number | null;
  readonly m: number;
  readonly n: number;
}

function copyIntegerVector(name: string, values: readonly number[]): number[] {
  if (!Array.isArray(values) || !values.every(Number.isSafeInteger)) {
    throw new TypeError(`${name} must contain safe integer values`);
  }
  return [...values];
}

export function createLWEInstance(input: LWEInstanceInput): LWEInstance {
  if (!Array.isArray(input.A) || input.A.length === 0) {
    throw new TypeError("A must be a non-empty two-dimensional matrix");
  }
  const matrix = input.A.map((row) => copyIntegerVector("A", row));
  const n = matrix[0]?.length ?? 0;
  const m = matrix.length;
  if (matrix.some((row) => row.length !== n) || n === 0) {
    throw new TypeError("A must be a rectangular matrix");
  }
  if (n < 4 || n > 16) {
    throw new RangeError("A must have between 4 and 16 columns");
  }
  if (m < n) {
    throw new RangeError("A must have at least as many rows as columns");
  }

  const secret = copyIntegerVector("secret", input.secret);
  const error = copyIntegerVector("error", input.error);
  const observations = copyIntegerVector("b", input.b);
  if (secret.length !== n) {
    throw new RangeError(`secret must have length ${n}`);
  }
  if (secret.some((bit) => bit !== 0 && bit !== 1)) {
    throw new TypeError("secret must contain only 0 or 1");
  }
  if (error.length !== m) {
    throw new RangeError(`error must have length ${m}`);
  }
  if (observations.length !== m) {
    throw new RangeError(`b must have length ${m}`);
  }

  let noiseBound: number | null = null;
  if (input.noiseBound !== undefined) {
    const bound = input.noiseBound;
    if (!Number.isSafeInteger(bound) || bound < 0) {
      throw new RangeError("noiseBound must be a non-negative integer");
    }
    noiseBound = bound;
    if (error.some((value) => Math.abs(value) > bound)) {
      throw new RangeError("error exceeds noiseBound");
    }
  }

  for (let rowIndex = 0; rowIndex < m; rowIndex += 1) {
    const row = matrix[rowIndex];
    if (row === undefined) {
      throw new Error("Invalid matrix row");
    }
    const predicted = row.reduce(
      (sum, coefficient, columnIndex) =>
        sum + coefficient * (secret[columnIndex] ?? 0),
      0,
    );
    if (!Number.isSafeInteger(predicted + (error[rowIndex] ?? 0))) {
      throw new RangeError("A @ secret + error exceeds the safe integer range");
    }
    if (observations[rowIndex] !== predicted + error[rowIndex]!) {
      throw new TypeError("b must equal A @ secret + error");
    }
  }

  return Object.freeze({
    A: Object.freeze(matrix.map((row) => Object.freeze(row))),
    secret: Object.freeze(secret),
    error: Object.freeze(error),
    b: Object.freeze(observations),
    noiseBound,
    m,
    n,
  });
}
