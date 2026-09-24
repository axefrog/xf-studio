/** A representative tint from active REDengine multilayer palette entries.
 *
 * The studio currently has no decoded mlmask/texture maps, so this deliberately
 * averages the source layer colours. It is not a simulation of spatial masking.
 */
export function piercingPaletteColor(layers: readonly { rgb: readonly number[]; opacity: number }[]): string {
  const sum = [0, 0, 0];
  let weight = 0;
  for (const { rgb, opacity } of layers) {
    if (rgb.length !== 3 || rgb.some(v => !Number.isFinite(v) || v < 0 || v > 1) ||
      !Number.isFinite(opacity) || opacity < 0 || opacity > 1)
      throw Error("Invalid piercing palette layer");
    if (opacity === 0) continue;
    weight += opacity;
    for (let i = 0; i < 3; i++) sum[i]! += rgb[i]! * opacity;
  }
  if (weight === 0) throw Error("Piercing material has no visible palette layer");
  return `#${sum.map(v => {
    const linear = v / weight;
    const srgb = linear <= .0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - .055;
    return Math.round(srgb * 255).toString(16).padStart(2, "0");
  }).join("")}`;
}
