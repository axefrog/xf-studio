/** Browser-only source-channel adapters. These do not reproduce REDengine lighting. */
export function skinRoughnessToGreen(
  rgba: Uint8ClampedArray | Uint8Array,
  mode: "base-r" | "r-b-lower-bound",
): Uint8Array {
  if (rgba.length % 4) throw new Error("RGBA roughness length is invalid");
  const out = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const red = rgba[i];
    const blue = rgba[i + 2] / 255;
    // The selected MI says BiasMin=1, BiasMax=0.93. The compiled shader's
    // spatial bias is omitted: 0.93 is an explicitly labelled lower-bound bracket.
    const roughness = mode === "base-r" ? red : red * (1 - 0.07 * blue);
    out[i] = rgba[i];
    out[i + 1] = Math.round(roughness);
    out[i + 2] = rgba[i + 2];
    out[i + 3] = rgba[i + 3];
  }
  return out;
}

export function skinPackedRgToRgb(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  if (rgba.length % 4) throw new Error("RGBA normal length is invalid");
  const out = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const x = rgba[i] / 255 * 2 - 1;
    const y = rgba[i + 1] / 255 * 2 - 1;
    const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
    out[i] = rgba[i]; out[i + 1] = rgba[i + 1];
    out[i + 2] = Math.round((z * 0.5 + 0.5) * 255);
    out[i + 3] = rgba[i + 3];
  }
  return out;
}
