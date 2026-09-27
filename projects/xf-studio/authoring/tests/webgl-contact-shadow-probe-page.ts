/**
 * Browser page for tests/webgl-contact-shadow.test.ts (bundled there, run in headless Chrome with a real WebGL 2 context): the character
 * contact shadows (contact-shadow.ts, PREV-148) on a synthetic crease, with no shadow maps.
 *
 * The scene, seen from 0.3 m in front: a skin plane facing the camera and, standing on it along y at x = 0, a skin ridge 3 mm tall and
 * 1 mm thick (a fold's lip). A spot light low on the +x side grazes the plane at about 20°, so the ridge hides the plane for about 8 mm on
 * its −x side: a crease far finer than a shadow map's bias and penumbra. Results land in `window.probe` as plain numbers.
 */
import * as THREE from "three";
import { contactShadowUniforms, createContactShadows, setContactShadows } from "../src/contact-shadow";
import { createSkinMaterial, skinParameters } from "../src/skin-material";

export type ContactProbe = {
  ok: boolean; errors: string[]; failure?: string; renderer: string;
  /** Mean luminance behind the ridge (hidden side) over the mean on its lit side, per case. */
  flagged: number; unflagged: number; off: number;
  /** Flagged lights the prepass found in each case. */
  count: { flagged: number; unflagged: number };
};
const probe: ContactProbe = { ok: false, errors: [], renderer: "", flagged: -1, unflagged: -1, off: -1, count: { flagged: -1, unflagged: -1 } };
(window as unknown as { probe?: ContactProbe }).probe = undefined;

const W = 256, H = 128;
function texture(rgba: number[], colour = false) {
  const t = new THREE.DataTexture(new Uint8Array(rgba), 1, 1);
  if (colour) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

try {
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  document.body.append(canvas);
  const context = canvas.getContext("webgl2", { alpha: false, antialias: false, preserveDrawingBuffer: true })!;
  const info = context.getExtension("WEBGL_debug_renderer_info");
  probe.renderer = info ? String(context.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown";
  const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    probe.errors.push(`${gl.getProgramInfoLog(program) ?? ""} ${gl.getShaderInfoLog(vertex) ?? ""} ${gl.getShaderInfoLog(fragment) ?? ""}`.trim() || "shader error");
  };
  // About 6 cm across: the 8 mm hidden band spans about 34 px.
  const camera = new THREE.PerspectiveCamera(6, W / H, 0.05, 2);
  camera.position.set(0, 0, 0.3);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  const scene = new THREE.Scene();
  const light = new THREE.SpotLight(0xffffff, 40, 0, Math.PI / 8, 0, 0);
  light.position.set(0.94, 0, 0.342);
  light.target.position.set(0, 0, 0);
  scene.add(light, light.target);
  const flat = () => texture([128, 128, 255, 255]);
  const skin = createSkinMaterial({ albedo: texture([200, 150, 120, 255], true), normal: flat(), roughness: texture([255, 0, 0, 255]),
    detailNormal: flat(), microDetail: flat(), tintMask: texture([0, 0, 0, 255]), secondary: texture([0, 0, 0, 0]) },
    skinParameters({ scalars: {}, colours: {}, skinProfiles: {} })).material;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.04), skin);
  const ridgeGeometry = new THREE.BoxGeometry(0.001, 0.04, 0.003);
  ridgeGeometry.translate(0, 0, 0.0015);
  const ridge = new THREE.Mesh(ridgeGeometry, skin);
  plane.castShadow = ridge.castShadow = true;
  scene.add(plane, ridge);
  scene.updateMatrixWorld(true);

  const contact = createContactShadows(renderer);
  const gl = renderer.getContext(), pixels = new Uint8Array(W * H * 4);
  const lin = (b: number) => { const c = b / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  // x of a world point on the plane in canvas pixels.
  const column = (x: number) => Math.round((new THREE.Vector3(x, 0, 0).project(camera).x * 0.5 + 0.5) * W);
  const band = (x0: number, x1: number) => {
    let sum = 0, n = 0;
    for (let y = H / 2 - 20; y < H / 2 + 20; y++) for (let x = column(x0); x < column(x1); x++) {
      const i = (y * W + x) * 4; sum += 0.2126 * lin(pixels[i]!) + 0.7152 * lin(pixels[i + 1]!) + 0.0722 * lin(pixels[i + 2]!); n++;
    }
    return sum / Math.max(1, n);
  };
  const frame = (prepare: boolean) => {
    if (prepare) contact.prepare(scene, camera); else contact.off();
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    // Hidden side: 2–6 mm behind the ridge (−x); lit side: 2–6 mm in front of it.
    return band(-0.006, -0.002) / Math.max(1e-6, band(0.002, 0.006));
  };
  setContactShadows(light, true);
  probe.flagged = frame(true);
  probe.count.flagged = contactShadowUniforms.xfsContactCount.value;
  probe.off = frame(false);
  setContactShadows(light, false);
  probe.unflagged = frame(true);
  probe.count.unflagged = contactShadowUniforms.xfsContactCount.value;
  const glError = gl.getError();
  if (glError !== gl.NO_ERROR) probe.errors.push(`WebGL error ${glError}`);
  contact.dispose();
  probe.ok = true;
} catch (error) {
  probe.failure = String((error as Error)?.stack ?? error);
}
(window as unknown as { probe?: ContactProbe }).probe = probe;
