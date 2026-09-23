# Six residual eye-plate contacts: localized, still rejected

24 September 2026. This follow-up starts from the coupled numeric candidate
SHA-256 `928c6cf5b454d23b5209f21ef5ec559533a3481df50c8064dda579cd140f5f17`.
It does **not** change the owned Blender plate, mesh/morph resources, archive,
or installed game. The independently reconstructed 107 static shapes and 73
sampled idle frames reproduce its zero static and six posed new non-adjacent
triangle contacts.

## Contact location and size

The six pairs occupy five plate triangles: `799, 800, 801, 803, 1227` of
3,010 total. Their seven vertices are `119, 121, 128, 130, 321, 322, 525`;
every contact face shares crease vertex **119**. The plate UV bounds are
`U 0.37109375–0.375`, `V 0.2509765625–0.25537109375`: a bounding box of
8 × 9 texels at 2K, or 16 × 18 at 4K. This is localization, **not** a
statement that deleting five faces would preserve shape or makeup coverage.

At idle frame 120, five plate faces intersect head face 1989. At frame 170,
plate face 1227 intersects head face 1987. The original mapped head faces
are 1993/1994/1995/1997/2421; none of the new pairings shares source-head
vertices, and the native head has no corresponding intersection under the
existing adjacency/original-contact filter. The smallest rigid translation
separating each individual pair is `4.8954e-6–1.0308e-5` asset units.
That number is a local diagnostic, not an editable-vertex solution.

The geometry is a narrow fold rather than a broad penetration: relative to
head face 1989's plane at frame 120, vertex 119 is `-8.3082e-6` across
the plane while the other vertices of the first crossing triangle are
`+3.5128e-5` and `+4.6226e-5`. Relative to head face 1987 at frame 170,
vertex 119 is `-3.4517e-5`, while the other two vertices of triangle 1227
are `+5.6476e-5` and `+8.0418e-4`. The [case-level probe](six_contact_probe_summary.json)
records every face, vertex, UV, plane distance and translation.

The global `0.00025` displacement limit is **not** exhausted here: the
largest displacement among the seven vertices is `4.7409e-5` in
`h091_eyes` and `4.7048e-5` in saved V. The *relative neighbor* limit is
the binding control: six nearby `h091_eyes` edges and two saved-V edges
already reach their local cap of at most `0.00005`. Raising the overall
displacement allowance therefore would not by itself make this fold
editable within the current smoothness constraint.

## Focused numeric repair and full gate

[The reproducible probe](six_contact_probe.py) used a three-variable
`h091_eyes` adjustment to vertex 119 only. It required that vertex to lie
on the same side of head faces 1989/1987 as its neighboring plate vertices,
with `2e-6` signed plane clearance at frames 120/170, while satisfying
`h091_eyes` and saved-V displacement and all incident-edge caps. SciPy SLSQP
converged from three starts to a feasible local delta
`(-1.4958525e-5, -3.8864471e-5, -4.1772267e-6)`. Its local shape/plane
slack is nonnegative to numerical precision.

The ignored numeric variant has SHA-256
`c1ee22bd1077f174c03d8b7dd5a372fb98f5f3a379a73a396d680c577e0b6359`.
The [independent full verifier](six_contact_verify_summary.json), run against
the original GLBs and pose matrices, confirms 107 static and 73 posed cases,
zero new static contacts, zero displacement violations, and zero neighbor
violations. It clears the original six at frames 120/170 **but exposes eight**
new contacts: four at frame 25 and four at frame 169. These involve the same
crease fan and head faces 722/1987/1988/1989. The candidate therefore
fails the posed-contact gate and is **not approved** for packing or use.

This is a sharper result than the prior SAT solver failure: a legal local
motion exists for the six *alone*, but it trades them for contacts at other
sampled phases. It does not prove that every possible coupled base/morph
change or topology construction fails. The earlier two-to-four-ring
active-set trials also failed within the current bounds; that history and
this one-vertex result together argue against widening the same local
offset search as the next step.

## Next representation study

Inspect a crease-specific remesh or split surface patch at the seven-vertex
region, retaining UV coverage and head-weight correspondence on both sides
of the fold, then recheck all 107/73 cases. An alternative is a projected
head-surface/depth material for this narrow region, but that needs separate
material/depth and animation validation. Simply culling the five faces
would create a makeup gap and is not an accepted fix. Any actual converted
candidate must also round-trip all 105 morphs and verify exact native skin
bytes in **both** the mesh and morph base buffer before it can replace the
master. Sampled nonintersection alone does not prove continuous idle motion,
appearance, or in-game rendering.

Reproduce with the ignored local source build and numeric inputs at the
paths and hashes in the reports:

```powershell
# Only if SciPy is absent from the active Python environment; NumPy is also required.
python -m pip install scipy --no-deps --target experiments/006-plate-clearance/generated/python-deps
python experiments/006-plate-clearance/research/six_contact_probe.py
python experiments/006-plate-clearance/research/coupled_morph_verify.py `
  --candidate experiments/006-plate-clearance/generated/morph-aware/six-contact-one-vertex.npz `
  --sha256 c1ee22bd1077f174c03d8b7dd5a372fb98f5f3a379a73a396d680c577e0b6359 `
  --output experiments/006-plate-clearance/research/six_contact_verify_summary.json
```

No new community source, external code or third-party asset informed this
work; it uses the project's previously credited extraction/analysis tools.
