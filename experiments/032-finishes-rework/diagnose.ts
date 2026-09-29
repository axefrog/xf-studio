// Glitter flakes 2 and shimmer-grain-2: offline evidence (experiment 032). Deterministic; reads no game files.
//
//   bun experiments/032-finishes-rework/diagnose.ts          # result.json (tracked, asset-free)
//   bun experiments/032-finishes-rework/diagnose.ts --png    # also renders into ignored generated/
//
// The tools are experiment 030's: the export's own maps and mip chains (Build's compilers on the built-in plate's window),
// rendered by a small deferred-light model of `mesh_decal` mode 1 on the skin class: the gate saturate(50 − 50z) on the
// filtered normal (times the flake mask for the Glitter route's NormalAlphaTex), an encoded lerp onto a flat skin normal,
// two GGX lobes at roughness × 0.966 and × 1.597, F0 = lerp(0.04, albedo, metalness), Lambert diffuse × (1 − metalness),
// and here also a uniform environment (albedo × (1 − metalness) + F0) for what shows whatever the lights do. Glitter's
// flakes are identified as the connected components of the level-0 flake mask, so each one can be followed through a sweep
// of 168 light directions and three views. A temporal-filter forecast applies the decoded `m_simpleTemporal` clamp in its
// steady state (history clamped to the 5-tap cross mean ± 1σ in PQ, 5 % current), treating 1.0 as 100 nits.
// No SSS, upscaler, bloom, lid curvature or ray tracing: a forecast of what the maps can do, not of the game.
//
// Glitter: board 1's Glitter A (the session-6 verdict, board 2's Glitter B left lid) against the same sizes, cover and colours
// with glitter flakes 2's tilts and surfaces (B's right lid), and the reference model reproduced (board 2's Glitter A). Shimmer: *Shimmer · strong* (experiment
// 017's preset) as Satin, shimmer-grain-1 (a copy of the retired generator, checked against its pinned bytes) and
// shimmer-grain-2 (what Build compiles now).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { compilePreset } from "../../projects/xf-studio/authoring/tests/fixtures/eye-region";
import { compileGlitterPreset, preparePackageCollection } from "../../projects/xf-studio/authoring/tests/fixtures/eye-exporter";
import { plateUvWindow, type UvWindow } from "../../projects/xf-studio/authoring/src/engines/layered-makeup/plate-uv-window";
import { facetedMipChain } from "../../projects/xf-studio/authoring/src/engines/layered-makeup/route-mip-chains";
import { mipDimensions } from "../../projects/xf-studio/authoring/src/engines/layered-makeup/flat-mip-chain";
import { sinRad, turn } from "../../projects/xf-studio/authoring/src/engines/layered-makeup/shimmer-grain";
import { components } from "../../projects/xf-studio/authoring/src/features/eye-makeup/verify/glitter-checks";
import { encodePng } from "../../projects/xf-studio/authoring/src/png";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "../..");
const png = process.argv.includes("--png"), out = join(here, "generated");
/** The built-in plate's stored UV0 bounds (game 2.31), as tests/plate-uv-window.test.ts records them. */
const BUILT_IN = { uMin: 0.273193359375, uMax: 0.7265625, vMin: 0.67626953125, vMax: 0.8212890625 };
const WINDOW: UvWindow = plateUvWindow(BUILT_IN);
const MM_U = 569, MM_V = 405;
/** Estimated screen pixel footprints on the lid [hypothesis], as experiment 030: a creator eye close-up and face framing. */
const FRAMINGS = [{ id: "eye-close-up", mmPerPixel: .1 }, { id: "face-framing", mmPerPixel: .22 }] as const;
/** Glitter adds a macro framing at one 4096-window texel per pixel (knowledge/glitter-in-game.md §3's close-up estimate, ≈ 16 px/mm). */
const GLITTER_FRAMINGS = [{ id: "macro", mmPerPixel: .065 }, ...FRAMINGS] as const;
type Rect = [number, number, number, number];
const srgbDecode = (v: number) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
const unorm = (b: number) => b / 255 * 2 - 1;
const gate = (sine: number) => Math.max(0, Math.min(1, 50 - 50 * Math.sqrt(Math.max(0, 1 - sine * sine))));
const mean = (xs: ArrayLike<number>) => { let s = 0; for (let i = 0; i < xs.length; i++) s += xs[i]; return xs.length ? s / xs.length : 0; };
const cv = (xs: ArrayLike<number>) => { const m = mean(xs); let s = 0; for (let i = 0; i < xs.length; i++) s += (xs[i] - m) ** 2; return m > 0 ? Math.sqrt(s / xs.length) / m : 0; };
const r3 = (v: number) => +v.toFixed(3), r4 = (v: number) => +v.toFixed(4);

// ---- Maps: a complete chain per channel over a width × height window ----
interface Maps {
  width: number; height: number; levels: { width: number; height: number }[];
  normal: Uint8Array[]; roughness: Uint8Array[]; metalness: Uint8Array[]; diffuse: Uint8Array[];
  /** NormalAlphaTex (the Glitter route's flake mask), or null where the decal uses the diffuse alpha. */
  mask: Uint8Array[] | null;
}
function sample(m: Maps, level: number, x: number, y: number, out: Float64Array) {
  // Bilinear at one level; x, y in level-0 texel units. out: nx, ny, rough, metal, alpha, r, g, b (linear), mask.
  const { width: w, height: h } = m.levels[level], fx = x * w / m.width - .5, fy = y * h / m.height - .5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
  out.fill(0);
  for (let k = 0; k < 4; k++) {
    const dx = k & 1, dy = k >> 1, wt = (dx ? ax : 1 - ax) * (dy ? ay : 1 - ay);
    const t = ((y0 + dy + h) % h) * w + ((x0 + dx + w) % w), d = m.diffuse[level];
    out[0] += wt * unorm(m.normal[level][t * 2]); out[1] += wt * unorm(m.normal[level][t * 2 + 1]);
    out[2] += wt * m.roughness[level][t] / 255; out[3] += wt * m.metalness[level][t] / 255;
    out[4] += wt * d[t * 4 + 3] / 255;
    out[5] += wt * srgbDecode(d[t * 4] / 255); out[6] += wt * srgbDecode(d[t * 4 + 1] / 255); out[7] += wt * srgbDecode(d[t * 4 + 2] / 255);
    out[8] += wt * (m.mask ? m.mask[level][t] / 255 : d[t * 4 + 3] / 255);
  }
}
function ggx(r: number, nh: number, nl: number, nv: number) {
  const a = Math.max(.04, r) ** 2, a2 = a * a, d = a2 / (Math.PI * (nh * nh * (a2 - 1) + 1) ** 2);
  const k = a / 2, g = nl / (nl * (1 - k) + k) * (nv / (nv * (1 - k) + k));
  return d * g / (4 * nl * nv);
}
const A = new Float64Array(9), B = new Float64Array(9), S = new Float64Array(9);
/** Luminance of one pixel: light direction `l` (null: environment only), view `v`. */
function shade(m: Maps, x: number, y: number, lod: number, l: number[] | null, v: number[]) {
  const l0 = Math.max(0, Math.min(m.levels.length - 1, Math.floor(lod))), l1 = Math.min(m.levels.length - 1, l0 + 1), f = Math.max(0, Math.min(1, lod - l0));
  sample(m, l0, x, y, A); sample(m, l1, x, y, B);
  for (let i = 0; i < 9; i++) S[i] = A[i] * (1 - f) + B[i] * f;
  const sine = Math.hypot(S[0], S[1]), z = Math.sqrt(Math.max(0, 1 - sine * sine)), alpha = gate(sine) * S[8];
  let nx = S[0] * alpha, ny = S[1] * alpha, nz = 1 + (z - 1) * alpha;
  const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
  const rough = S[2], metal = S[3], albedo = [S[5], S[6], S[7]], lum = [.2126, .7152, .0722];
  let total = 0;
  for (let c = 0; c < 3; c++) {
    const f0 = .04 * (1 - metal) + albedo[c] * metal;
    let value: number;
    if (!l) value = albedo[c] * (1 - metal) + f0; // uniform environment of radiance 1
    else {
      const hx = l[0] + v[0], hy = l[1] + v[1], hz = l[2] + v[2], hl = Math.hypot(hx, hy, hz);
      const nl = Math.max(0, nx * l[0] + ny * l[1] + nz * l[2]), nv = Math.max(1e-3, nx * v[0] + ny * v[1] + nz * v[2]);
      const nh = Math.max(0, (nx * hx + ny * hy + nz * hz) / hl), vh = Math.max(0, (v[0] * hx + v[1] * hy + v[2] * hz) / hl);
      const fresnel = f0 + (1 - f0) * (1 - vh) ** 5;
      const spec = nl > 0 ? Math.min(100, (ggx(rough * .966, nh, nl, nv) + ggx(rough * 1.597, nh, nl, nv)) * fresnel) * nl * Math.PI : 0;
      value = albedo[c] * (1 - metal) * nl + spec;
    }
    total += lum[c] * value;
  }
  return total;
}
const dir = (elevationDeg: number, azimuthDeg: number) => {
  const e = elevationDeg * Math.PI / 180, a = azimuthDeg * Math.PI / 180;
  return [Math.sin(e) * Math.cos(a), Math.sin(e) * Math.sin(a), Math.cos(e)];
};
/** A frontal view of `rect` at one framing: pixel → level-0 texel coordinates, and the lod. */
function frame(m: Maps, rect: Rect, mmPerPixel: number) {
  const pw = Math.round((rect[2] - rect[0]) * MM_U / mmPerPixel), ph = Math.round((rect[3] - rect[1]) * MM_V / mmPerPixel);
  const texelU = (WINDOW.u1 - WINDOW.u0) / m.width * MM_U, texelV = (WINDOW.v1 - WINDOW.v0) / m.height * MM_V;
  const lod = Math.log2(Math.max(mmPerPixel / texelU, mmPerPixel / texelV));
  const tx = new Float64Array(pw * ph), ty = new Float64Array(pw * ph);
  for (let py = 0; py < ph; py++) for (let px = 0; px < pw; px++) {
    const u = rect[0] + (px + .5) * mmPerPixel / MM_U, v = rect[1] + (py + .5) * mmPerPixel / MM_V;
    tx[py * pw + px] = (u - WINDOW.u0) / (WINDOW.u1 - WINDOW.u0) * m.width; ty[py * pw + px] = (v - WINDOW.v0) / (WINDOW.v1 - WINDOW.v0) * m.height;
  }
  return { pw, ph, lod, tx, ty };
}
type Frame = ReturnType<typeof frame>;
function render(m: Maps, f: Frame, l: number[] | null, v = [0, 0, 1]) {
  const img = new Float64Array(f.pw * f.ph);
  for (let i = 0; i < img.length; i++) img[i] = shade(m, f.tx[i], f.ty[i], f.lod, l, v);
  return img;
}

// ---- Temporal filter forecast (knowledge/glitter-in-game.md §1, `m_simpleTemporal`) ----
const PQ = { m1: 2610 / 16384, m2: 2523 / 4096 * 128, c1: 3424 / 4096, c2: 2413 / 4096 * 32, c3: 2392 / 4096 * 32 };
/** SMPTE ST 2084 of a luminance in nits, and back. */
const pqEncode = (nits: number) => { const a = (Math.max(0, nits) / 10000) ** PQ.m1; return ((PQ.c1 + PQ.c2 * a) / (1 + PQ.c3 * a)) ** PQ.m2; };
const pqDecode = (e: number) => { const a = e ** (1 / PQ.m2); return 10000 * (Math.max(0, a - PQ.c1) / (PQ.c2 - PQ.c3 * a)) ** (1 / PQ.m1); };
/** Steady state of history clamped to the cross mean ± 1σ (PQ) with 5 % of the current frame: a stable image's temporal output. */
function temporal(img: Float64Array, w: number, h: number) {
  const e = img.map(v => pqEncode(v * 100)), outImg = new Float64Array(img.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const taps = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => e[Math.min(h - 1, Math.max(0, y + dy)) * w + Math.min(w - 1, Math.max(0, x + dx))]);
    const mu = mean(taps), sd = Math.sqrt(mean(taps.map(t => (t - mu) ** 2))), c = e[y * w + x];
    const clamped = Math.min(mu + sd, Math.max(mu - sd, c));
    outImg[y * w + x] = pqDecode(.05 * c + .95 * clamped) / 100;
  }
  return outImg;
}

function toPng(img: Float64Array, w: number, h: number, scale: number) {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const t = img[i] * scale / (1 + img[i] * scale), s = Math.round(255 * (t <= .0031308 ? t * 12.92 : 1.055 * t ** (1 / 2.4) - .055));
    data.set([s, s, s, 255], i * 4);
  }
  return encodePng({ width: w, height: h, data }, { alpha: false });
}

// ================= Glitter =================
const board = JSON.parse(readFileSync(join(root, "experiments/021-glitter-board/glitter-board.collection.json"), "utf8"));
const plan = preparePackageCollection(board).plan;
const LEFT: Rect = [.300, .211, .444, .248], RIGHT: Rect = [1 - .444, .211, 1 - .300, .248];
/** A lid's fully covered interior (the feather is 0.004; flakes are measured away from the edge). */
const inset = (r: Rect, d = .006): Rect => [r[0] + d, r[1] + d, r[2] - d, r[3] - d];
function glitterMaps(name: string): Maps {
  const preset = plan.presets.find(p => p.name === name)!;
  const chains = compileGlitterPreset(preset.recipe, preset.diagnostics!.glitter!, WINDOW);
  return { width: chains.width, height: chains.height, levels: mipDimensions(chains.width, chains.height), normal: chains.normal, roughness: chains.roughness,
    metalness: chains.metalness, diffuse: chains.diffuse, mask: chains.flakes };
}
const SWEEP = (() => { const out: { e: number; a: number }[] = []; for (let e = 10; e <= 70; e += 10) for (let a = 0; a < 360; a += 15) out.push({ e, a }); return out; })();
const VIEWS = [0, 15, 30];

function glitterStats(m: Maps, rect: Rect) {
  const r = inset(rect), { width: W } = m;
  // Flakes: connected components of the level-0 mask (≥ ½) wholly inside the interior; the texels of each.
  const x0 = Math.ceil((r[0] - WINDOW.u0) / (WINDOW.u1 - WINDOW.u0) * W), x1 = Math.floor((r[2] - WINDOW.u0) / (WINDOW.u1 - WINDOW.u0) * W);
  const y0 = Math.ceil((r[1] - WINDOW.v0) / (WINDOW.v1 - WINDOW.v0) * m.height), y1 = Math.floor((r[3] - WINDOW.v0) / (WINDOW.v1 - WINDOW.v0) * m.height);
  const cw = x1 - x0, ch = y1 - y0, crop = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) crop[y * cw + x] = m.mask![0][(y0 + y) * W + x0 + x] >= 128 ? 1 : 0;
  const flakes = components(crop, { width: cw, height: ch }).filter(c => c.length >= 2);
  const owner = new Int32Array(cw * ch).fill(-1);
  flakes.forEach((list, i) => { for (const t of list) owner[t] = i; });
  // Texture: flake texels whose normal mode 1 fades (weight below 1), and the tilt distribution.
  let faded = 0, flakeTexels = 0; const tilts: number[] = [];
  for (const list of flakes) for (const t of list) {
    const gx = (y0 + Math.floor(t / cw)) * W + x0 + (t % cw), sine = Math.hypot(unorm(m.normal[0][gx * 2]), unorm(m.normal[0][gx * 2 + 1]));
    flakeTexels++; if (gate(sine) < 1) faded++; tilts.push(Math.asin(Math.min(1, sine)) * 180 / Math.PI);
  }
  tilts.sort((a, b) => a - b);
  const result: Record<string, unknown> = {
    flakes: flakes.length, flakeCover: r4(flakeTexels / (cw * ch)),
    fadedFlakeTexelShare: r4(faded / flakeTexels), flakeTiltDeg: { p10: r3(tilts[Math.floor(.1 * tilts.length)]), median: r3(tilts[Math.floor(.5 * tilts.length)]), p90: r3(tilts[Math.floor(.9 * tilts.length)]) },
  };
  const images: { name: string; img: Float64Array; w: number; h: number; scale: number }[] = [];
  for (const framing of GLITTER_FRAMINGS) {
    const f = frame(m, r, framing.mmPerPixel);
    const pixelFlake = new Int32Array(f.pw * f.ph);
    for (let i = 0; i < pixelFlake.length; i++) {
      const cx = Math.floor(f.tx[i]) - x0, cy = Math.floor(f.ty[i]) - y0;
      pixelFlake[i] = cx >= 0 && cy >= 0 && cx < cw && cy < ch ? owner[cy * cw + cx] : -1;
    }
    const base: number[] = [];
    for (let i = 0; i < pixelFlake.length; i++) if (pixelFlake[i] < 0) base.push(i);
    // Environment only: what shows whatever the lights do.
    const env = render(m, f, null), envFlake = mean(Array.from(pixelFlake.keys()).filter(i => pixelFlake[i] >= 0).map(i => env[i])), envBase = mean(base.map(i => env[i]));
    const entry: Record<string, unknown> = { lod: r3(f.lod), staticContrast: r3(cv(env)), staticFlakeToBase: r3(envFlake / envBase) };
    if (framing.id !== "face-framing") {
      // Per flake and light: mean luminance; a flake flashes when it is more than 5 × the base's mean under the same light.
      const n = flakes.length, profile = new Float64Array(n * SWEEP.length), flash = new Uint8Array(n * SWEEP.length), baseProfile = new Float64Array(SWEEP.length);
      const sums = new Float64Array(n), counts = new Float64Array(n);
      SWEEP.forEach(({ e, a }, k) => {
        const img = render(m, f, dir(e, a));
        sums.fill(0); counts.fill(0);
        for (let i = 0; i < img.length; i++) { const o = pixelFlake[i]; if (o >= 0) { sums[o] += img[i]; counts[o]++; } }
        const b = mean(base.map(i => img[i])); baseProfile[k] = b;
        for (let o = 0; o < n; o++) { const v = counts[o] ? sums[o] / counts[o] : 0; profile[o * SWEEP.length + k] = v; flash[o * SWEEP.length + k] = v > 5 * b ? 1 : 0; }
        if (png && framing.id === "eye-close-up" && (k === 49 || k === 50)) images.push({ name: `close-up-light-${e}-${a}`, img, w: f.pw, h: f.ph, scale: 1 });
      });
      const perLight = SWEEP.map((_, k) => { let s = 0; for (let o = 0; o < n; o++) s += flash[o * SWEEP.length + k]; return s / n; });
      let ever = 0, lightsPerFlake = 0, twinkle = 0, pairs = 0;
      for (let o = 0; o < n; o++) {
        let any = 0;
        for (let k = 0; k < SWEEP.length; k++) {
          any += flash[o * SWEEP.length + k];
          // Neighbouring lights: 15° apart in azimuth at the same elevation.
          const next = SWEEP[k].a + 15 < 360 ? k + 1 : k - 23; // 24 azimuths per elevation
          if (flash[o * SWEEP.length + k] || flash[o * SWEEP.length + next]) { pairs++; if (flash[o * SWEEP.length + k] !== flash[o * SWEEP.length + next]) twinkle++; }
        }
        if (any) ever++; lightsPerFlake += any / SWEEP.length;
      }
      // Where each flake is brightest: in the row of lights where the skin's own highlight is (the base's brightest elevation,
      // the lowest for a frontal view), a flake just brightens with the lid, as paint on it would; anywhere else it flashes on its own.
      let top = 0; for (let k = 1; k < SWEEP.length; k++) if (baseProfile[k] > baseProfile[top]) top = k;
      let withSkin = 0;
      for (let o = 0; o < n; o++) {
        let best = 0; for (let k = 1; k < SWEEP.length; k++) if (profile[o * SWEEP.length + k] > profile[o * SWEEP.length + best]) best = k;
        if (SWEEP[best].e === SWEEP[top].e) withSkin++;
      }
      // View sweep with a fixed light (45° elevation, azimuth 0): the share of flakes whose flash state changes as the camera moves.
      const viewFlash = VIEWS.map(deg => {
        const vv = dir(deg, 180), img = render(m, f, dir(45, 0), vv);
        sums.fill(0); counts.fill(0);
        for (let i = 0; i < img.length; i++) { const o = pixelFlake[i]; if (o >= 0) { sums[o] += img[i]; counts[o]++; } }
        const b = mean(base.map(i => img[i]));
        return Array.from({ length: n }, (_, o) => counts[o] && sums[o] / counts[o] > 5 * b ? 1 : 0);
      });
      let viewChanged = 0, viewAny = 0;
      for (let o = 0; o < n; o++) { if (viewFlash.some(s => s[o])) { viewAny++; if (!viewFlash.every(s => s[o] === viewFlash[0][o])) viewChanged++; } }
      Object.assign(entry, {
        /** Mean share of flakes flashing under one light, and the most under any single light (a sheet flashes all at once). */
        flashingShareMean: r4(mean(perLight)), flashingSharePeak: r4(Math.max(...perLight)),
        /** Share of flakes that flash under at least one of the 168 lights. */
        everFlashed: r4(ever / n),
        /** Mean share of the 168 lights under which a flake flashes: low and above zero is an individual flash. */
        lightsPerFlake: r4(lightsPerFlake / n),
        /** Of flake–light pairs flashing at one of two lights 15° apart, the share that flash at only one: twinkle. */
        twinkle15deg: r4(twinkle / Math.max(1, pairs)),
        /** Share of flakes brightest in the row of lights where the skin's own highlight is (the base's brightest elevation). */
        peakWithSkinHighlight: r4(withSkin / n),
        /** Of flakes flashing in any of three views (0°, 15°, 30°) under a fixed light, the share whose state changes with the view. */
        viewTwinkle: r4(viewChanged / Math.max(1, viewAny)),
      });
    } else {
      // Face framing: flashing pixels (more than 5 × the image mean) under each light, with and without the temporal clamp.
      let raw = 0, clamped = 0;
      for (const { e, a } of SWEEP.filter((_, k) => k % 6 === 0)) {
        const img = render(m, f, dir(e, a)), t = temporal(img, f.pw, f.ph), mi = mean(img);
        let a1 = 0, a2 = 0; for (let i = 0; i < img.length; i++) { if (img[i] > 5 * mi) a1++; if (t[i] > 5 * mi) a2++; }
        raw += a1 / img.length; clamped += a2 / img.length;
      }
      const lights = SWEEP.filter((_, k) => k % 6 === 0).length;
      Object.assign(entry, { flashingPixels: r4(raw / lights), flashingPixelsAfterTemporal: r4(clamped / lights) });
      if (png) { const img = render(m, f, dir(40, 45)); images.push({ name: "face-framing-light-40-45", img, w: f.pw, h: f.ph, scale: 1 },
        { name: "face-framing-light-40-45-temporal", img: temporal(img, f.pw, f.ph), w: f.pw, h: f.ph, scale: 1 }); }
    }
    if (png && framing.id === "eye-close-up") images.push({ name: "close-up-environment", img: env, w: f.pw, h: f.ph, scale: 4 });
    result[framing.id] = entry;
  }
  return { result, images };
}

const glitter: Record<string, unknown> = {};
if (png) mkdirSync(out, { recursive: true });
for (const [id, preset, rect] of [["board-1", "Glitter B · 1 vs 2", LEFT], ["board-1-sizes-flakes-2-normals", "Glitter B · 1 vs 2", RIGHT], ["reference", "Glitter A · reference", LEFT]] as const) {
  const m = glitterMaps(preset), { result, images } = glitterStats(m, rect);
  glitter[id] = { preset, lid: rect === LEFT ? "left" : "right", ...result };
  for (const { name, img, w, h, scale } of images) writeFileSync(join(out, `glitter-${id}-${name}.png`), toPng(img, w, h, scale));
  console.log(id, JSON.stringify(glitter[id]));
}

// ================= Shimmer =================
// Retired shimmer-grain-1, copied (hash, keys and settings) to measure what session 6 saw; checked against its pinned bytes.
function fmix(h: number) { h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); return (h ^ (h >>> 16)) | 0; }
const ANCHOR = fmix(2077), drawKey = (seed: number, salt: number) => Math.imul((fmix(seed) ^ ANCHOR) ^ (seed + salt), 0x9e3779b1);
function hash(x: number, y: number, key: number) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y ^ 0x5bd1e995, 0x165667b1) ^ key;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
const toByte = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
function grain1(x: number, y: number, p: { density: number; tilt: number; seed: number }): [number, number] {
  const share = .4 * p.density, low = 12 * Math.PI / 180, high = (12 + 18 * p.tilt) * Math.PI / 180;
  if (hash(x, y, drawKey(p.seed, 1)) >= share) return [0, 0];
  const s = sinRad(low + (high - low) * hash(x, y, drawKey(p.seed, 2))), [c, sn] = turn(hash(x, y, drawKey(p.seed, 3)));
  return [c * s, sn * s];
}
const GRAIN_1_SURFACE = [toByte(.32), toByte(.3)];
// Self-check against shimmer-grain-1's pinned digests (tests/shimmer-grain.test.ts history): default settings, built-in window.
const grain1Pinned = (() => {
  const n = 2048 * 512, normal = new Uint8Array(n * 2), surface = new Uint8Array(n * 2);
  for (let t = 0; t < n; t++) {
    const [gx, gy] = grain1(t % 2048, Math.floor(t / 2048), { density: .65, tilt: .65, seed: 2077 });
    normal[t * 2] = toByte(gx * .5 + .5); normal[t * 2 + 1] = toByte(gy * .5 + .5); surface[t * 2] = GRAIN_1_SURFACE[0]; surface[t * 2 + 1] = GRAIN_1_SURFACE[1];
  }
  const sha = (a: Uint8Array) => createHash("sha256").update(a).digest("hex").slice(0, 16);
  return sha(normal) === "5f38f9d6460ae113" && sha(surface) === "7c5adbbb5f47446e";
})();

const shimmerCollection = JSON.parse(readFileSync(join(root, "experiments/017-plate-depth/depth-candidate.collection.json"), "utf8"));
const strong = shimmerCollection.presets.find((p: { name: string }) => p.name === "Shimmer · strong");
const SW = 2048, SH = 512;
const STRIPES: { id: string; rect: Rect; full: Rect; flakes?: { density: number; tilt: number; seed: number } }[] = [
  { id: "satin", rect: [.304, .216, .344, .244], full: [.300, .212, .346, .248] },
  { id: "fine", rect: [.352, .216, .392, .244], full: [.346, .212, .394, .248], flakes: { density: .65, tilt: .65, seed: 2077 } },
  { id: "strong", rect: [.400, .216, .440, .244], full: [.394, .212, .444, .248], flakes: { density: .8, tilt: 1, seed: 2078 } },
];
const compiled = compilePreset(strong.recipe, { kind: "window", width: SW, height: SH, window: WINDOW });
const texelUv = (x: number, y: number) => [WINDOW.u0 + (x + .5) / SW * (WINDOW.u1 - WINDOW.u0), WINDOW.v0 + (y + .5) / SH * (WINDOW.v1 - WINDOW.v0)];
const inside = (r: Rect, u: number, v: number) => u >= r[0] && u < r[2] && v >= r[1] && v < r[3];
const now = { diffuse: compiled.maps.diffuse!, roughness: compiled.maps.roughness!, metalness: compiled.maps.metalness!, normal: compiled.maps.normal! };
const built1 = { diffuse: now.diffuse, roughness: now.roughness.slice(), metalness: now.metalness.slice(), normal: now.normal.slice() };
for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
  const [u, v] = texelUv(x, y), stripe = STRIPES.find(s => s.flakes && inside(s.full, u, v));
  if (!stripe) continue;
  const t = y * SW + x, [gx, gy] = grain1(x, y, stripe.flakes!);
  built1.normal[t * 2] = toByte(gx * .5 + .5); built1.normal[t * 2 + 1] = toByte(gy * .5 + .5); built1.roughness[t] = GRAIN_1_SURFACE[0]; built1.metalness[t] = GRAIN_1_SURFACE[1];
}
function shimmerMaps(maps: typeof now): Maps {
  const chain = facetedMipChain(maps.diffuse, maps.roughness, maps.metalness, maps.normal, SW, SH);
  return { width: SW, height: SH, levels: mipDimensions(SW, SH), normal: chain.normal as Uint8Array[], roughness: chain.roughness as Uint8Array[],
    metalness: chain.metalness as Uint8Array[], diffuse: chain.diffuse as Uint8Array[], mask: null };
}
const PROFILE_DEG = [0, 8, 16, 24, 32];
function shimmerStats(m: Maps, name: string) {
  const res: Record<string, unknown> = {};
  for (const stripe of STRIPES) {
    const entry: Record<string, unknown> = {};
    for (const framing of FRAMINGS) {
      const f = frame(m, stripe.rect, framing.mmPerPixel);
      const near = render(m, f, dir(8, 0)), oblique = render(m, f, dir(35, 30)), moved = render(m, f, dir(35, 40)), env = render(m, f, null);
      const nearT = temporal(near, f.pw, f.ph), obliqueT = temporal(oblique, f.pw, f.ph);
      const pinpoints = (img: Float64Array) => { const mi = mean(img); let k = 0; for (const v of img) if (v > 3 * mi) k++; return k / img.length; };
      entry[framing.id] = {
        lod: r3(f.lod), staticContrast: r3(cv(env)),
        /** Pixel-to-pixel speckle inside the near-mirror highlight (a smooth vinyl gloss has none), before and after the temporal clamp. */
        speckleNearMirror: r3(cv(near)), speckleNearMirrorAfterTemporal: r3(cv(nearT)),
        /** Share of pixels brighter than 3 × the stripe mean under an oblique light (pinpoints), before and after the clamp. */
        pinpoints: r4(pinpoints(oblique)), pinpointsAfterTemporal: r4(pinpoints(obliqueT)),
        twinkle10deg: r3(mean(oblique.map((v, i) => Math.abs(v - moved[i]))) / Math.max(1e-9, mean(oblique))),
        sheenProfile: PROFILE_DEG.map(deg => r4(mean(render(m, f, dir(deg, 0))))),
      };
      if (png && framing.id === "eye-close-up" && stripe.id !== "satin") {
        writeFileSync(join(out, `shimmer-${name}-${stripe.id}-close-up-near.png`), toPng(near, f.pw, f.ph, 1));
        writeFileSync(join(out, `shimmer-${name}-${stripe.id}-close-up-near-temporal.png`), toPng(nearT, f.pw, f.ph, 1));
        writeFileSync(join(out, `shimmer-${name}-${stripe.id}-close-up-oblique.png`), toPng(oblique, f.pw, f.ph, 1));
      }
    }
    res[stripe.id] = entry;
  }
  return res;
}
const shimmer = { grain1EqualsPinnedBytes: grain1Pinned, lightsDeg: { near: "8° off the normal", oblique: "35° off, azimuth 30° (moved: 40°)" },
  profileLightOffNormalDeg: PROFILE_DEG, "shimmer-grain-1": shimmerStats(shimmerMaps(built1), "grain-1"), "shimmer-grain-2": shimmerStats(shimmerMaps(now), "grain-2") };
console.log(JSON.stringify(shimmer, null, 1));

const result = {
  window: { glitter: "4096 × 1024", shimmer: "2048 × 512", plate: "built-in (game 2.31)" }, framings: FRAMINGS,
  glitter: { sweep: "168 lights: elevation 10–70° in 10° steps, azimuth every 15°; flash = flake mean luminance > 5 × the base's mean under that light", views: VIEWS, ...glitter },
  shimmer,
};
writeFileSync(join(here, "result.json"), JSON.stringify(result, null, 2) + "\n");
