/**
 * Number text as the resolver's JSON carries it. Pure.
 *
 * The reference JSON (WolvenKit `convert serialize`) prints a `Float` as the float32 value rounded to 9 significant digits,
 * ties to even, trailing zeros dropped, in fixed notation when the decimal exponent e satisfies -5 < e < 9 and as `d.dddE±XX`
 * otherwise [resource: WolvenKit 9.0.1 output; the rule matches .NET's "G9" format, knowledge/archive-format.md §6]. Consumers
 * parse that text back into a double, so what must match is the double: `float32Value` returns the number that text parses to.
 * JavaScript's `toPrecision` rounds ties up, which differs only when the exact value has a 5 as its tenth significant digit
 * followed by nothing (e.g. 2^-13).
 */

/** The 9-significant-digit decimal text of a float32 value, rounded half to even. */
export function float32Text(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (!Number.isFinite(value)) return value > 0 ? "+inf" : "-inf";
  if (value === 0) return Object.is(value, -0) ? "-0" : "0";
  const negative = value < 0, magnitude = Math.abs(value);
  // Exact decimal digits of the (float32, hence double-exact) value: up to 100 significant digits is enough for every normal float32.
  const exact = magnitude.toExponential(99);
  const [mantissa, exponentText] = exact.split("e") as [string, string];
  let digits = mantissa.replace(".", "").replace(/0+$/, "");
  let exponent = Number(exponentText);
  if (digits.length > 9) {
    const head = digits.slice(0, 9), rest = digits.slice(9);
    const tie = rest === "5";
    const up = rest[0]! > "5" || (rest[0] === "5" && (!tie || Number(head[8]) % 2 === 1));
    let n = BigInt(head) + (up ? 1n : 0n);
    if (n.toString().length > 9) { n /= 10n; exponent++; }
    digits = n.toString().replace(/0+$/, "") || "0";
  }
  let text: string;
  if (exponent > -5 && exponent < 9) {
    if (exponent >= 0) text = digits.length > exponent + 1 ? `${digits.slice(0, exponent + 1)}.${digits.slice(exponent + 1)}` : digits.padEnd(exponent + 1, "0");
    else text = `0.${"0".repeat(-exponent - 1)}${digits}`;
  } else {
    const sign = exponent < 0 ? "-" : "+";
    text = `${digits[0]}${digits.length > 1 ? `.${digits.slice(1)}` : ""}E${sign}${String(Math.abs(exponent)).padStart(2, "0")}`;
  }
  return negative ? `-${text}` : text;
}

/** The double a consumer gets when it parses the reference JSON's text of this float32 value (null for NaN, which that JSON can't hold). */
export function float32Value(value: number): number | string | null {
  if (Number.isNaN(value)) return null;
  if (!Number.isFinite(value)) return value > 0 ? "+inf" : "-inf";
  // `toPrecision(9)` rounds correctly except on an exact tie, which only a value with exactly ten significant digits ending in 5 has.
  const ten = value.toPrecision(10);
  if (/5(?:e|$)/.test(ten) && Number(ten) === value) return Number(float32Text(value));
  return Number(value.toPrecision(9));
}

/**
 * A `Double`: .NET "G17" gives the shortest round-trip text for nearly every double, and JavaScript numbers are doubles, so the
 * value itself is what a consumer parses back.
 */
export const doubleValue = (value: number): number | string | null =>
  Number.isNaN(value) ? null : Number.isFinite(value) ? value : value > 0 ? "+inf" : "-inf";
