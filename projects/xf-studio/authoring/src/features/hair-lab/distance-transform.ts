/** Separable squared Euclidean transform, following Felzenszwalb and Huttenlocher (2012).
 * Independently implemented from the lower-envelope construction; no reference source code is used. */
export function squaredDistances(mask: Uint8Array, n: number, spacing: readonly number[], target: number): Float32Array {
  const values = Float32Array.from(mask, v => v === target ? 0 : 1e20);
  const input = new Float64Array(n), output = new Float64Array(n), sites = new Int32Array(n), starts = new Float64Array(n);
  const strides = [1, n, n * n];
  for (let axis = 0; axis < 3; axis++) {
    const stride = strides[axis], other = strides.filter((_, k) => k !== axis), weight = spacing[axis] ** 2;
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      const base = a * other[0] + b * other[1];
      for (let q = 0; q < n; q++) input[q] = values[base + q * stride];
      let size = 0;
      for (let q = 0; q < n; q++) {
        if (input[q] > 1e19) continue;
        let start = -Infinity;
        while (size) {
          const p = sites[size - 1];
          start = ((input[q] - input[p]) / weight + q * q - p * p) / (2 * (q - p));
          if (start > starts[size - 1]) break;
          size--;
        }
        sites[size] = q; starts[size] = size ? start : -Infinity; size++;
      }
      if (!size) output.fill(1e20);
      else {
        let active = 0;
        for (let q = 0; q < n; q++) {
          while (active + 1 < size && starts[active + 1] < q) active++;
          output[q] = input[sites[active]] + weight * (q - sites[active]) ** 2;
        }
      }
      for (let q = 0; q < n; q++) values[base + q * stride] = output[q];
    }
  }
  return values;
}

/** Separable 3×3×3 binary closing seals sub-grid grooves in the collision solid. */
export function closeVoxels(mask: Uint8Array, n: number): Uint8Array {
  let source = mask;
  for (const dilate of [true, false]) for (const stride of [1, n, n * n]) {
    const next = new Uint8Array(mask.length);
    for (let i = 0; i < mask.length; i++) {
      const at = Math.floor(i / stride) % n, a = at ? source[i - stride] : 0, b = source[i], c = at < n - 1 ? source[i + stride] : 0;
      next[i] = dilate ? Math.max(a, b, c) : Math.min(a, b, c);
    }
    source = next;
  }
  return source;
}
