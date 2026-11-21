import { createLWEInstance, type LWEInstance } from "./lwe-instance";
import { resolveSeed, SeededRandom } from "../random/seeded-random";

export interface GenerateLWEOptions {
  readonly n: number;
  readonly m: number;
  readonly noiseBound?: number;
  readonly coefficientBound?: number;
  readonly seed?: number;
}

export function generateLWEInstance({
  n,
  m,
  noiseBound = 1,
  coefficientBound = 10,
  seed,
}: GenerateLWEOptions): LWEInstance {
  if (!Number.isSafeInteger(n) || n < 4 || n > 16) {
    throw new RangeError("n must be an integer between 4 and 16");
  }
  if (!Number.isSafeInteger(m) || m < n) {
    throw new RangeError("m must be an integer greater than or equal to n");
  }
  if (!Number.isSafeInteger(noiseBound) || noiseBound < 0) {
    throw new RangeError("noiseBound must be a non-negative integer");
  }
  if (!Number.isSafeInteger(coefficientBound) || coefficientBound < 1) {
    throw new RangeError("coefficientBound must be a positive integer");
  }

  const random = new SeededRandom(resolveSeed(seed));
  const A = Array.from({ length: m }, () =>
    Array.from(
      { length: n },
      () => random.integer(-coefficientBound, coefficientBound),
    ),
  );
  const secret = Array.from({ length: n }, () => random.bit());
  const error = Array.from(
    { length: m },
    () => random.integer(-noiseBound, noiseBound),
  );
  const b = A.map((row, rowIndex) =>
    row.reduce(
      (sum, coefficient, columnIndex) =>
        sum + coefficient * (secret[columnIndex] ?? 0),
      error[rowIndex] ?? 0,
    ),
  );

  return createLWEInstance({ A, secret, error, b, noiseBound });
}
