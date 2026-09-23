import {
  initialRecipe,
  parseRecipe,
  curve,
  clamp,
  type Recipe,
  type Layer,
} from "./recipe";
import { createScene } from "./scene";
import { createSurfaceEditor } from "./surface-editor";
import { setupLibrary } from "./library-ui";
import { readSavedV, type SavedV } from "./save-reader";
import {
  canonicalFinish,
  defaultFlakes,
  finishLabel,
  finishDescription,
} from "./finish";
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
const status = (text: string) => {
  $("status").textContent = text;
};
// Stable draft keys preserve existing work across the XF Appearance Studio rename.
const storageKey = new URLSearchParams(location.search).has("verify")
  ? "eye-artistry.verification.v1"
  : "eye-artistry.recipe.v1";
let recipe = initialRecipe(),
  active = 0,
  selected = 0;
try {
  const saved = localStorage.getItem(storageKey);
  if (saved) recipe = parseRecipe(JSON.parse(saved));
} catch {
  status("Saved draft could not be loaded; using a fresh study.");
}
const history: string[] = [];
function checkpoint() {
  const s = JSON.stringify(recipe);
  if (history.at(-1) !== s) history.push(s);
  if (history.length > 80) history.shift();
}
const canvases = Array.from({ length: 4 }, () => {
  const c = document.createElement("canvas");
  c.width = c.height = 1024;
  return c;
});
const tinted = document.createElement("canvas");
tinted.width = tinted.height = 1024;
const uv = $<HTMLCanvasElement>("uv"),
  ctx = uv.getContext("2d")!;
const region = { u: 0.25, v: 0.17, w: 0.5, h: 0.215 };
const px = (u: number) => ((u - region.u) / region.w) * uv.width,
  py = (v: number) => ((v - region.v) / region.h) * uv.height;
let viewer: Awaited<ReturnType<typeof createScene>> | undefined;
let savedV: SavedV | undefined;
const current = () => recipe.layers[active];
function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(recipe));
    $("save-state").textContent = "Draft saved in this browser";
  } catch {
    $("save-state").textContent = "Browser storage unavailable — save a recipe";
  }
}
function drawUV() {
  ctx.clearRect(0, 0, uv.width, uv.height);
  ctx.fillStyle = "#253132";
  ctx.fillRect(0, 0, uv.width, uv.height);
  if (viewer) {
    const im = viewer.albedo.image as HTMLImageElement;
    ctx.globalAlpha = 0.55;
    ctx.drawImage(
      im,
      region.u * im.width,
      region.v * im.height,
      region.w * im.width,
      region.h * im.height,
      0,
      0,
      uv.width,
      uv.height,
    );
    ctx.globalAlpha = 1;
  }
  for (let i = 0; i < 4; i++)
    if (recipe.layers[i].enabled) {
      const t = tinted.getContext("2d")!;
      t.clearRect(0, 0, 1024, 1024);
      t.globalCompositeOperation = "source-over";
      t.drawImage(canvases[i], 0, 0);
      t.globalCompositeOperation = "source-in";
      t.fillStyle = recipe.layers[i].color;
      t.fillRect(0, 0, 1024, 1024);
      t.globalCompositeOperation = "source-over";
      ctx.drawImage(
        tinted,
        region.u * 1024,
        region.v * 1024,
        region.w * 1024,
        region.h * 1024,
        0,
        0,
        uv.width,
        uv.height,
      );
    }
  ctx.setLineDash([5, 7]);
  ctx.strokeStyle = "#c4ddca55";
  ctx.beginPath();
  ctx.moveTo(px(0.5), 0);
  ctx.lineTo(px(0.5), uv.height);
  ctx.stroke();
  ctx.setLineDash([]);
  const l = current(),
    path = curve(l.points);
  for (const mirrored of l.symmetry ? [false, true] : [false]) {
    ctx.strokeStyle = mirrored ? "#ead1e877" : "#f1dbee";
    ctx.lineWidth = 2;
    ctx.beginPath();
    path.forEach((p, i) => {
      const x = px(mirrored ? 1 - p.u : p.u),
        y = py(p.v);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
    if (!mirrored)
      l.points.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(px(p.u), py(p.v), i === selected ? 7 : 5, 0, Math.PI * 2);
        ctx.fillStyle = i === selected ? "#fff4fb" : "#a17d97";
        ctx.fill();
        ctx.strokeStyle = "#2b2a34";
        ctx.lineWidth = 2;
        ctx.stroke();
      });
  }
  const f = l.field,
    x = px(f.u),
    y = py(f.v),
    tx = px(f.u + f.du),
    ty = py(f.v + f.dv);
  ctx.strokeStyle = "#b1ebc9";
  ctx.fillStyle = "#b1ebc9";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(tx, ty);
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(tx - 5, ty - 5, 10, 10);
  ctx.fill();
  ctx.font = "18px Segoe UI";
  ctx.fillStyle = "#c6e2d0";
  ctx.fillText("FIELD", x + 12, y + 5);
}
function layerCards() {
  $("layers").replaceChildren();
  recipe.layers.forEach((l, i) => {
    const row = document.createElement("div");
    row.className = "layer" + (i === active ? " selected" : "");
    const button = document.createElement("button");
    button.setAttribute("aria-label", `Select ${l.name}`);
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = l.color;
    const label = document.createElement("span");
    label.className = "layer-name";
    label.append(document.createTextNode(l.name));
    const small = document.createElement("small");
    small.textContent = `0${i + 1} / ${finishLabel(l.finish)}`;
    label.append(small);
    button.append(swatch, label);
    button.onclick = () => {
      active = i;
      selected = 0;
      sync();
      drawUV();
    };
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = l.enabled;
    toggle.setAttribute("aria-label", `Show ${l.name}`);
    toggle.onchange = () => {
      checkpoint();
      l.enabled = toggle.checked;
      render(i);
    };
    row.append(button, toggle);
    $("layers").append(row);
  });
}
function sync() {
  const l = current();
  $("active-name").textContent = l.name;
  $("point-label").textContent = `Point ${selected + 1} / ${l.points.length}`;
  input("color").value = l.color;
  input("symmetry").checked = l.symmetry;
  $<HTMLSelectElement>("finish").value = canonicalFinish(l.finish);
  $("finish-note").textContent = finishDescription(l.finish);
  $("flake-controls").hidden = !["shimmer", "glitter"].includes(
    canonicalFinish(l.finish),
  );
  const flakes = l.flakes ?? defaultFlakes();
  for (const id of ["cells", "density", "tilt"] as const) {
    input("flake-" + id).value = String(flakes[id]);
    $("flake-" + id + "-value").textContent =
      id === "cells" ? String(flakes[id]) : `${Math.round(flakes[id] * 100)}%`;
  }
  for (const [id, value] of Object.entries({
    weight: l.points[selected].weight,
    feather: l.feather,
    radius: l.field.radius,
    opacity: l.opacity,
  })) {
    input(id).value = String(value);
    $(id + "-value").textContent =
      id === "feather" || id === "radius"
        ? `${(value * 100).toFixed(2)}% UV`
        : `${Math.round(value * 100)}%`;
  }
  $<HTMLButtonElement>("remove").disabled = l.points.length <= 3;
  $<HTMLButtonElement>("undo").disabled = history.length === 0;
  layerCards();
}
let lastRaster = 0;
const worker = new Worker("/build/raster-worker.js", { type: "module" }),
  queue = new Map<number, { version: number; layer: Layer }>(),
  versions = [0, 0, 0, 0];
let busy = false;
function dispatch() {
  if (busy || !queue.size) return;
  const [i, job] = queue.entries().next().value!;
  queue.delete(i);
  busy = true;
  worker.postMessage({ i, ...job, size: 1024 });
}
worker.onmessage = (
  e: MessageEvent<{
    i: number;
    version: number;
    data: Uint8ClampedArray<ArrayBuffer>;
    ms: number;
  }>,
) => {
  const { i, version, data, ms } = e.data;
  busy = false;
  if (version === versions[i]) {
    canvases[i]
      .getContext("2d")!
      .putImageData(new ImageData(data, 1024, 1024), 0, 0);
    viewer?.updateLayer(i, recipe.layers[i]);
    lastRaster = ms;
    drawUV();
    status(`Live mask · 1024² · ${Math.round(ms)} ms · layer ${i + 1}`);
  }
  dispatch();
};
worker.onerror = () =>
  status("Mask worker failed — reload the editor to recover.");
function render(i = active) {
  queue.set(i, {
    version: ++versions[i],
    layer: structuredClone(recipe.layers[i]),
  });
  dispatch();
  viewer?.updateLayer(i, recipe.layers[i]);
  persist();
  sync();
  drawUV();
}
let pending = false;
function schedule() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    render();
  });
}
function undo() {
  const s = history.pop();
  if (!s) return;
  recipe = parseRecipe(JSON.parse(s));
  selected = 0;
  for (let i = 0; i < 4; i++) render(i);
  sync();
}
$("undo").onclick = undo;
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "z") {
    e.preventDefault();
    undo();
  }
});
for (const id of ["weight", "feather", "radius", "opacity", "color"]) {
  const control = input(id);
  control.addEventListener("pointerdown", checkpoint);
  control.addEventListener("keydown", () => checkpoint());
  control.oninput = () => {
    const l = current();
    if (id === "color") l.color = control.value;
    else if (id === "weight") l.points[selected].weight = +control.value;
    else if (id === "radius") l.field.radius = +control.value;
    else if (id === "feather") l.feather = +control.value;
    else l.opacity = +control.value;
    schedule();
  };
}
input("symmetry").onchange = () => {
  checkpoint();
  current().symmetry = input("symmetry").checked;
  render();
};
$<HTMLSelectElement>("finish").onchange = () => {
  checkpoint();
  current().finish = $<HTMLSelectElement>("finish").value as Layer["finish"];
  render();
};
for (const id of ["cells", "density", "tilt"] as const) {
  const control = input("flake-" + id);
  control.addEventListener("pointerdown", checkpoint);
  control.addEventListener("keydown", checkpoint);
  control.oninput = () => {
    const l = current();
    l.flakes ??= defaultFlakes();
    l.flakes[id] = +control.value;
    schedule();
  };
}
$("clear-field").onclick = () => {
  checkpoint();
  current().field.du = current().field.dv = 0;
  render();
};
$("reset").onclick = () => {
  checkpoint();
  recipe.layers[active] = initialRecipe().layers[active];
  selected = 0;
  render();
};
$("remove").onclick = () => {
  if (current().points.length <= 3) return;
  checkpoint();
  current().points.splice(selected, 1);
  selected = Math.min(selected, current().points.length - 1);
  render();
};
const coord = (e: PointerEvent | MouseEvent) => {
  const b = uv.getBoundingClientRect();
  return {
    u: region.u + ((e.clientX - b.left) / b.width) * region.w,
    v: region.v + ((e.clientY - b.top) / b.height) * region.h,
  };
};
let drag: "point" | "field" | "origin" | undefined;
uv.onpointerdown = (e) => {
  const p = coord(e),
    l = current(),
    f = l.field;
  let nearest = Infinity,
    index = 0;
  l.points.forEach((q, i) => {
    const d = Math.hypot(px(q.u) - px(p.u), py(q.v) - py(p.v));
    if (d < nearest) {
      nearest = d;
      index = i;
    }
  });
  if (nearest < 22) {
    selected = index;
    drag = "point";
  } else if (
    Math.hypot(px(p.u) - px(f.u + f.du), py(p.v) - py(f.v + f.dv)) < 25
  )
    drag = "field";
  else if (Math.hypot(px(p.u) - px(f.u), py(p.v) - py(f.v)) < 22)
    drag = "origin";
  else return;
  checkpoint();
  uv.setPointerCapture(e.pointerId);
  sync();
  drawUV();
};
uv.onpointermove = (e) => {
  if (!drag) return;
  const p = coord(e),
    l = current();
  if (drag === "point") {
    l.points[selected].u = clamp(l.symmetry && p.u > 0.5 ? 1 - p.u : p.u);
    l.points[selected].v = clamp(p.v);
  } else if (drag === "origin") {
    l.field.u = clamp(p.u);
    l.field.v = clamp(p.v);
  } else {
    l.field.du = clamp(p.u - l.field.u, -0.1, 0.1);
    l.field.dv = clamp(p.v - l.field.v, -0.1, 0.1);
  }
  schedule();
};
uv.onpointerup = () => (drag = undefined);
uv.onpointercancel = () => (drag = undefined);
uv.ondblclick = (e) => {
  const l = current();
  if (l.points.length >= 24) return;
  checkpoint();
  const p = coord(e);
  l.points.splice(selected + 1, 0, { u: clamp(p.u), v: clamp(p.v), weight: 1 });
  selected++;
  render();
};
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("save").onclick = () => {
  download(
    new Blob([JSON.stringify(recipe, null, 2)], { type: "application/json" }),
    "xfas.recipe.json",
  );
  status("Recipe exported — editable shapes, colours and fields.");
};
$("load").onclick = () => input("file").click();
const lookLibrary = setupLibrary(() => recipe, (next) => {
  checkpoint();
  recipe = next;
  selected = 0;
  for (let i = 0; i < 4; i++) render(i);
});
input("file").onchange = async () => {
  const file = input("file").files?.[0];
  if (!file) return;
  try {
    if (file.size > 1_000_000) throw Error("Recipe is too large.");
    const next = parseRecipe(JSON.parse(await file.text()));
    checkpoint();
    recipe = next;
    lookLibrary.detach();
    selected = 0;
    for (let i = 0; i < 4; i++) render(i);
    status(`Opened ${file.name}`);
  } catch (error) {
    status(`Could not open recipe: ${(error as Error).message}`);
  }
  input("file").value = "";
};
$("export").onclick = () => {
  const layer = structuredClone(current()),
    bake = new Worker("/build/raster-worker.js", { type: "module" });
  $<HTMLButtonElement>("export").disabled = true;
  status("Baking 2048² mask…");
  bake.onmessage = (e) => {
    const c = document.createElement("canvas");
    c.width = c.height = 2048;
    c.getContext("2d")!.putImageData(
      new ImageData(e.data.data, 2048, 2048),
      0,
      0,
    );
    bake.terminate();
    $<HTMLButtonElement>("export").disabled = false;
    c.toBlob((blob) => {
      if (blob) {
        download(blob, `xfas-${layer.id}-alpha.png`);
        status("Exported 2048² white + alpha mask; palette remains separate.");
      }
    });
  };
  bake.onerror = () => {
    bake.terminate();
    $<HTMLButtonElement>("export").disabled = false;
    status("Mask export failed.");
  };
  bake.postMessage({
    i: 0,
    version: 0,
    layer: { ...layer, enabled: true },
    size: 2048,
  });
};
$("open-v").onclick = () => {
  if (!viewer) {
    status("Wait for the preview assets to finish loading.");
    return;
  }
  input("v-file").click();
};
input("v-file").onchange = async () => {
  const file = input("v-file").files?.[0];
  if (!file || !viewer) return;
  try {
    if (file.size > 128 * 1024 * 1024)
      throw Error("Save is larger than the supported limit.");
    status("Reading saved appearance locally…");
    const v = readSavedV(new Uint8Array(await file.arrayBuffer()));
    const result = viewer.applySavedV(v);
    savedV = v;
    $("v-details").textContent =
      result.matchedDetails.length === 2
        ? "Brows and lashes match the saved resource references; colours are approximate."
        : "Brows and lashes are reference styles, not a resolved match for this save.";
    $("v-card").hidden = false;
    $("v-summary").textContent =
      `${result.applied.length} facial regions applied. ${result.appearanceReferences} appearance references read. Game ${(v.gameVersion / 1000).toFixed(2)}.`;
    const eye = v.groups.head
      .find((g) => g.name === "character_customization")
      ?.morphs.find((m) => m.region === "eyes");
    if (eye) shape.value = String(Math.floor(Number(eye.target.slice(1)) / 10));
    status(
      "Saved facial shape applied. Remaining appearance assets still need resolving.",
    );
  } catch (error) {
    status(`Could not apply V: ${(error as Error).message}`);
  }
  input("v-file").value = "";
};
$("v-export").onclick = () => {
  if (savedV)
    download(
      new Blob([JSON.stringify(savedV, null, 2)], { type: "application/json" }),
      "v-appearance.json",
    );
};
const shape = $<HTMLSelectElement>("eye-shape");
for (let i = 0; i <= 21; i++) {
  const o = document.createElement("option");
  o.value = String(i);
  o.textContent = i ? `Eye shape ${String(i).padStart(2, "0")}` : "Base mesh";
  o.selected = i === 9;
  shape.append(o);
}
for (let i = 0; i < 4; i++) render(i);
sync();
try {
  viewer = await createScene($("viewport"), canvases);
  const surface = createSurfaceEditor(viewer, {
    layer: current,
    selected: () => selected,
    select: (i) => {
      selected = i;
      sync();
      drawUV();
    },
    begin: checkpoint,
    change: schedule,
    cancel: undo,
    message: status,
  });
  surface.setEnabled(input("surface-controls").checked);
  input("surface-controls").onchange = () =>
    surface.setEnabled(input("surface-controls").checked);
  for (let i = 0; i < 4; i++) viewer.updateLayer(i, recipe.layers[i]);
  $("loading").hidden = true;
  drawUV();
  $("front").onclick = () => viewer!.front();
  input("wire").onchange = () => viewer!.setWire(input("wire").checked);
  for (const name of ["brows", "lashes"]) {
    input(name).disabled = !viewer.details[name];
    input(name).checked = !!viewer.details[name];
    input(name).onchange = () => viewer!.setDetail(name, input(name).checked);
  }
  if (viewer.evidence.detailErrors.length)
    $("detail-note").textContent =
      `Some details unavailable: ${viewer.evidence.detailErrors.join("; ")}`;
  input("blink").oninput = () => {
    viewer!.setBlink(+input("blink").value);
    $("play").setAttribute("aria-pressed", "false");
    $("play").textContent = "▶ Blink";
  };
  $("play").onclick = () => {
    const on = $("play").getAttribute("aria-pressed") !== "true";
    $("play").setAttribute("aria-pressed", String(on));
    $("play").textContent = on ? "Ⅱ Pause" : "▶ Blink";
    viewer!.animateBlink(on);
  };
  shape.onchange = () => viewer!.eyeShape(+shape.value);
  input("exposure").oninput = () =>
    viewer!.setExposure(+input("exposure").value);
  input("light-angle").oninput = () =>
    viewer!.setLightAngle(+input("light-angle").value);
  input("normals").onchange = () =>
    viewer!.setNormals(input("normals").checked);
  viewer.renderer.domElement.addEventListener(
    "pointerdown",
    (e) => {
      if (!e.shiftKey) return;
      e.preventDefault();
      const uv = viewer!.pick(e);
      if (!uv) return;
      e.stopImmediatePropagation();
      checkpoint();
      const p = current().points[selected];
      p.u = current().symmetry && uv.x > 0.5 ? 1 - uv.x : uv.x;
      p.v = uv.y;
      render();
    },
    true,
  );
  // Read-only diagnostics for offline browser verification and future capture manifests.
  Object.assign(window, {
    eyeArtistryDiagnostics: () => ({
      ready: true,
      surface: surface.diagnostics(),
      recipe: structuredClone(recipe),
      assets: viewer!.evidence,
      details: Object.fromEntries(
        Object.entries(viewer!.details).map(([name, d]) => [
          name,
          {
            visible: d.root.visible,
            activeMorphs: d.meshes.map((m) =>
              Object.entries(m.morphTargetDictionary ?? {})
                .filter(([, i]) => m.morphTargetInfluences![i] > 0)
                .map(([n]) => n),
            ),
          },
        ]),
      ),
      lastRasterMs: lastRaster,
      savedV: savedV
        ? { gameVersion: savedV.gameVersion, evidence: savedV.evidence }
        : null,
      activeMorphs: Object.entries(viewer!.head.morphTargetDictionary!)
        .filter(([n, i]) => viewer!.head.morphTargetInfluences![i] > 0)
        .map(([n]) => n),
      renderer: {
        calls: viewer!.renderer.info.render.calls,
        triangles: viewer!.renderer.info.render.triangles,
      },
      materials: viewer!.materials.map((m) => ({
        color: m.color.getHexString(),
        roughness: m.roughness,
        metalness: m.metalness,
        clearcoat: m.clearcoat,
        iridescence: m.iridescence,
        normalMap: Boolean(m.normalMap),
        roughnessMap: Boolean(m.roughnessMap),
        metalnessMap: Boolean(m.metalnessMap),
        emissive: m.emissive.getHexString(),
      })),
    }),
  });
  status("Ready · actual head & expanded plate · all skin weights retained");
} catch (error) {
  $("loading").textContent = `Preview unavailable: ${(error as Error).message}`;
  status("Asset or renderer error — see the preview message.");
  console.error(error);
}
