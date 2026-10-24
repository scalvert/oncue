/**
 * Decimal rounding that is exact: the result is computed from the double's true binary value, and
 * exact ties go to the even digit. This is what Python's round() and "{:.3f}" do, and the timing
 * pipeline was built on them: retime() cut points, scene bounds, and word times all pass through
 * here, so every take is cut at the same sample on every machine.
 *
 * Math.round(x * 1000) / 1000 and Number#toFixed are not equivalent: the multiplication rounds
 * first, and toFixed breaks exact ties upward (0.0625 -> "0.063", where Python gives "0.062").
 */

const view = new DataView(new ArrayBuffer(8));

/** |x| as an exact rational: { m, k } with |x| = m / 2^k (k >= 0) or m * 2^-k (k < 0). */
function decompose(x: number): { m: bigint; k: number } {
  view.setFloat64(0, Math.abs(x));
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const exp = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (exp === 0) {
    e = -1074; // subnormal
  } else {
    m |= 1n << 52n;
    e = exp - 1075;
  }
  if (m === 0n) return { m: 0n, k: 0 };
  while (e < 0 && (m & 1n) === 0n) {
    m >>= 1n;
    e += 1;
  }
  return { m, k: -e };
}

/** The decimal digits of |x| rounded to `digits` places (ties to even), as an integer string. */
function scaledDigits(x: number, digits: number): string {
  const { m, k } = decompose(x);
  const ten = 10n ** BigInt(digits);
  if (k <= 0) return (m * (1n << BigInt(-k)) * ten).toString();
  // |x| * 10^digits = m * 5^k * 10^digits / 10^k
  const num = m * 5n ** BigInt(k) * ten;
  const den = 10n ** BigInt(k);
  let q = num / den;
  const twice = (num % den) * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) q += 1n;
  return q.toString();
}

/** Python's f"{x:.{digits}f}". */
export function fixed(x: number, digits: number): string {
  if (!Number.isFinite(x)) throw new RangeError(`fixed(${x}): not a finite number`);
  if (!Number.isInteger(digits) || digits < 0) throw new RangeError(`fixed: bad digits ${digits}`);
  const s = scaledDigits(x, digits).padStart(digits + 1, "0");
  const body = digits === 0 ? s : `${s.slice(0, s.length - digits)}.${s.slice(s.length - digits)}`;
  return (x < 0 || Object.is(x, -0) ? "-" : "") + body;
}

/** Python's str(x) for a float in display range: 34.0 stays "34.0" (JavaScript prints "34"). */
export function pyFloat(x: number): string {
  return Number.isInteger(x) && Math.abs(x) < 1e16 ? x.toFixed(1) : String(x);
}

/** Python's round(x, digits). round(x) with no digits rounds to an integer, ties to even. */
export function round(x: number, digits = 0): number {
  if (!Number.isFinite(x)) return x;
  return Number(fixed(x, digits));
}
