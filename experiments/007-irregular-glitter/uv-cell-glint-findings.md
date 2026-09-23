# UV-cell direct-glint pilot

23 September 2026. This is an **isolated browser material experiment**, not the production editor finish or a game material. Open `http://127.0.0.1:4317/glitter-study.html` and choose **UV-cell glint pilot (direct light)**. The head, expanded plate, blink and idle are the same local preview used by the earlier lit-head study; the page cannot save or modify Nathan's draft.

## What it tests

The previous fine-field maps preserve flake placement but average their normal directions into one normal per texel. The [CPU oracle](glint-oracle-findings.md) measures the resulting loss of directional highlights. This pilot asks a narrower visual question: does evaluating stable UV-anchored facet directions against a moving light/view produce a more recognisable glitter effect on the moving head?

It uses a **separate** project-authored 576 × 576 hashed UV-cell field, with one jittered candidate per cell, varied radii, and fixed tangent-space slopes. It does **not** render the oracle's 350,000-ID irregular catalogue and should not be compared as if the flake identities matched. The makeup alpha remains the study's fixed purple eye mask. For each fragment and direct light, a 3 × 3 neighbourhood evaluates candidate footprint and a narrow angular lobe. UV derivatives supply a deformed tangent frame and an approximate screen footprint; at distance the discrete response fades toward a low-energy broad mean. Seed, position and orientation never depend on frame number.

The glints are added to Three.js's outgoing light. This is a deliberately bounded visual hypothesis: it is not an energy-conserving microfacet BRDF, a statistically correct footprint filter, or an environment-lit sparkle model. Strength and angular sharpness are study controls, not portable recipe fields. The previous two-reflection and normal-map comparisons remain available as distinct variants.

## Observations and limits

- The corrected shader compiled in an isolated in-app browser tab at both 1K and 2K. At close-eye view, pale gold-white flecks appear over purple pigment; setting strength to zero removes them. Sweeping the directional-light angle changes which flecks brighten. The same UV placements remain recognisable between the 1K and 2K masks. Distant view still shows some sparkles, but they remain coarser and sparser than the supplied makeup photographs.
- The 2K idle check sampled 90 display frames: median 16.7 ms, 95th percentile 16.8 ms and maximum 16.8 ms, with no browser-console errors. This shows display cadence on this machine, **not** shader GPU cost or a performance guarantee on other hardware. The 3 × 3 candidate loop runs per light per fragment and requires profiling before adoption.
- The first test build referenced an unavailable shader tangent symbol. We corrected it to recover tangent directions from deformed view-position and UV derivatives, then restarted verification in a fresh isolated tab. Results above refer only to the successfully compiled build.
- Only the browser pilot can execute this procedural glint calculation. The [REDengine feasibility audit](../../research/materials/redengine-glint-feasibility.md) found no demonstrated stock/custom shader route that reproduces it on a soft skinned makeup decal. A reflected-flake decal or separately masked emissive accent could approximate pieces of the appearance, but neither is yet proven in the game. No material or recipe was promoted to production.

The [primary stochastic-microfacet papers](../../research/materials/glitter-filtering-research.md) motivate coherent facet placement and footprint-aware filtering, but their algorithms were not implemented here. The next decision requires a material candidate that can be built from current game resources, a closer visual comparison to Nathan's photographs, and one batched runtime validation session. Keep the browser/game gap visible in the export contract.
