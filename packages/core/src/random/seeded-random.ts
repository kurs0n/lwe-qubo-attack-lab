export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
      throw new RangeError("seed must be an integer between 0 and 2**32 - 1");
    }
    this.state = seed >>> 0;
  }

  nextUint32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  }

  next(): number {
    return this.nextUint32() / 0x1_0000_0000;
  }

  integer(min: number, max: number): number {
    if (
      !Number.isSafeInteger(min) ||
      !Number.isSafeInteger(max) ||
      max < min ||
      max - min + 1 > 0x1_0000_0000
    ) {
      throw new RangeError("integer range must be safe and no wider than 2**32");
    }
    const range = max - min + 1;
    const limit = Math.floor(0x1_0000_0000 / range) * range;
    let value = this.nextUint32();
    while (value >= limit) {
      value = this.nextUint32();
    }
    return min + (value % range);
  }

  bit(): number {
    return this.nextUint32() & 1;
  }
}

export function resolveSeed(seed?: number): number {
  if (seed !== undefined) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
      throw new RangeError("seed must be an integer between 0 and 2**32 - 1");
    }
    return seed;
  }
  const values = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values);
    return values[0] ?? 0;
  }
  return Math.floor(Math.random() * 0x1_0000_0000);
}
