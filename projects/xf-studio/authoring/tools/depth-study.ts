// Run on the isolated /build/depth-study.html page; never reads/writes workspace or library data.
import * as THREE from "three";
import { createScene } from "../src/scene";
import { initialRecipe } from "../src/engines/layered-makeup/recipe";
import { extendSkin } from "../src/skin";
import { previewClipPlanes, previewNearPlane } from "../src/camera-depth";

const run = document.getElementById("run") as HTMLButtonElement;
const output = document.getElementById("output")!;
run.onclick = async () => {
  run.disabled = true;
  try {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 8;
    const context = canvas.getContext("2d")!; context.fillStyle = "white"; context.fillRect(0, 0, 8, 8);
    const v = await createScene(document.getElementById("stage")!, [canvas]);
    v.renderer.setAnimationLoop(null); v.renderer.setPixelRatio(1); v.renderer.setSize(640, 640);
    v.camera.aspect = 1; v.controls.enableDamping = false;
    v.updateLayer(0, initialRecipe().layers[0]);
    v.setCharacterDetails(null);
    v.scene.environment = null;
    v.scene.traverse(o => { if (o instanceof THREE.Light) o.visible = false; });
    v.scene.traverse(o => { if (o instanceof THREE.Mesh && o !== v.head && o !== v.plates[0]) o.visible = false; });
    const red = new THREE.MeshStandardMaterial({ color: 0, emissive: 0xff0000, toneMapped: false });
    v.head.material = red; extendSkin(v.head, red);
    const green = v.materials[0]; green.map = null; green.color.set(0); green.emissive.set(0x00ff00);
    green.toneMapped = false; green.transparent = false; green.needsUpdate = true;
    v.renderer.setClearColor(0); const gl = v.renderer.getContext();
    const results: unknown[] = [];
    const capture = (near: number) => {
      v.camera.near = near; v.camera.updateProjectionMatrix();
      // Through the viewport's own display: the canvas has no depth buffer of its own (linear-display.ts).
      v.lighting.render(v.camera);
      const pixels = new Uint8Array(640 * 640 * 4); gl.readPixels(0, 0, 640, 640, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    for (const eye of [5, 9]) for (const time of [0, 2.4, 5.7]) for (const distance of [.2, .55, 1.2, 1.95, 3.07, 3.5]) {
      v.eyeShape(eye); v.setIdle(true); v.idle?.seek(time); v.scene.updateMatrixWorld(true);
      for (const angle of [0, 25]) {
        v.camera.fov = distance <= .2 ? 60 : distance === .55 ? 30 : 10;
        const rad = THREE.MathUtils.degToRad(angle);
        v.camera.position.set(Math.sin(rad) * distance, 1.67, .005 - Math.cos(rad) * distance);
        v.camera.lookAt(0, 1.67, .005); v.camera.updateMatrixWorld(true);
        const referenceNear = distance > 1.2 ? distance - .6 : .05;
        const reference = capture(referenceNear), candidates = [
          { mode: "previous", near: .001 }, { mode: "fixed-5mm", near: .005 },
          { mode: "fixed-10mm", near: .01 }, { mode: "fixed-20mm", near: .02 },
          { mode: "adaptive", near: previewNearPlane(distance) },
          { mode: "camera-envelope", near: previewClipPlanes(distance, distance).near },
        ].map(({ mode, near }) => {
          const pixels = capture(near); let missing = 0, extra = 0, referencePixels = 0;
          for (let p = 0; p < pixels.length; p += 4) {
            const expected = reference[p + 1] > 200 && reference[p] < 10;
            const actual = pixels[p + 1] > 200 && pixels[p] < 10;
            if (expected) referencePixels++;
            if (expected && !actual) missing++;
            if (!expected && actual) extra++;
          }
          if (!referencePixels) throw Error("Empty reference image; invalid depth study");
          return { mode, near, missing, extra, referencePixels };
        });
        results.push({ eye, time, distance, angle, fov: v.camera.fov, referenceNear, candidates });
      }
      output.textContent = `Sampling ${results.length} camera/pose cases…`;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const result = { three: THREE.REVISION, depthBits: gl.getParameter(gl.DEPTH_BITS), results };
    output.textContent = JSON.stringify(result, null, 2);
    Object.assign(window, { depthStudyResult: result });
  } catch (e) { output.textContent = String(e); console.error(e); }
};
