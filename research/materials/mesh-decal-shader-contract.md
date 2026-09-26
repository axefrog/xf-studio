# Mesh decal shader: inspected material-input contract

**Current status:** consolidated, with every other program of the family, in the [decal reference](shader-decal.md); the observations below remain valid.

Observed 23 September 2026 in the installed game shader cache. This covers the selected `mesh_decal` MeshSkinned, `renderstage_post_gbuffer` compilation only. Other templates, vertex factories, render passes and runtime state may differ.

Pixel GUID `16098255505177109230`; vertex GUID `11128168794837425370`; material GUID `3719702598002043981`. The [cache index](evidence/shader-cache-index.json) records source/extract hashes. Local DXIL disassembly: `research/consumers/glitter/raw/shaders/mesh-decal-skinned-fragment.ll`. The unmodified `.mt` defines source-alpha/inverse-source-alpha blending on its three main render targets and disables depth writes.

## Observed calculations

Material parameter registers are cross-referenced against serialized `base\materials\mesh_decal.mt`; they are cb4 registers in this particular pixel program. At lines 286–300, NormalTexture (register 11) reads **red and green**, converts each with `2*x-1`, and reconstructs positive Z with `sqrt(max(0,1-x*x-y*y))`. Texture blue is unused here. At lines 301–326, RoughnessTexture and MetalnessTexture each read **red**, multiply by their respective scale, add bias and clamp to 0–1. The browser's packed roughness-G/metalness-B image must therefore be separated into scalar textures for this engine template.

For diffuse alpha `a`, mask contrast `c`, secondary mask red `s`, secondary influence `i`:

```text
adjusted = saturate((a - 0.5) * tan((c + 1) * pi/4) + 0.5)
coverage = adjusted² * (1 - i*s)
colour target alpha = DiffuseAlpha * coverage
surface target alpha = RoughnessMetalnessAlpha * coverage
```

These are directly traced through SSA values 120, 128–152, 330–338. They explain why a linear browser alpha should not simply be presumed identical in this decal. With contrast and secondary influence zero, encoding `sqrt(desiredCoverage)` in diffuse alpha compensates for the square at texel centres. **Filtering a square root and then squaring is not identical to filtering coverage**; mip/edge comparisons remain necessary.

Normal coverage follows a separate path (values 209–220, 326, 333–335): UseNormalAlphaTex >0.5 chooses NormalAlphaTex.red, otherwise raw diffuse alpha. NormalAlpha multiplies that value. Consequently, compensating diffuse alpha requires a separate linear normal mask if normal weight is intended to follow the original shape coverage. The default scalar values in the inspected template are zero for DiffuseAlpha, NormalAlpha and RoughnessMetalnessAlpha; candidate instances must explicitly enable the needed contributions.

When NormalsBlendingMode >0.5, the shader reads a screen-space texture at t74, decodes a normalized vector and combines it with the tangent-space decal normal. The observed formula resembles reoriented normal blending. It also scales normal coverage by `saturate(50*(1-reconstructedZ))`, reducing a flat normal's contribution. NormalsBlendingModeAlpha.red interpolates between two computed normal results. The other mode transforms the decal normal through the mesh basis directly. This is strong evidence of different normal-composition behavior, but does not by itself prove the frame resource binding or the result on these overlapping eye plates.

## Consequences for the current candidate

- Explicitly configure colour, normal and surface weights independently. Do not infer visible flake response from a visible pigment mask.
- Use linear BC5 XY normal data, separate linear scalar roughness/metalness maps, and an independent normal-coverage mask. Check serialized texture settings rather than trusting filenames.
- Carry both normal modes and both green-channel signs in the first comparison. Distinguish image-row flipping from tangent-space normal Y inversion: these are different transformations.
- Keep the authoritative material template's normal render priority. The old priority override is not needed to study these input channels.
- Browser MeshStandardMaterial shades transparent surfaces separately; the game decal updates material properties in G-buffer targets. Shared inputs improve comparison but do not make these rendering paths equivalent.

The isolated fixture is [Experiment 003](../../experiments/003-decal-material-import/README.md). No live game launch or deployment is implied by these source/binary findings.
