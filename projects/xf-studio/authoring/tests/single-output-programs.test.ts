import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * Every program the Studio draws writes one output, into a target with one colour attachment (profiles phase 4a-v-c, experiment 043 §12).
 * ANGLE on Direct3D 11 links a program for its first output only and builds one that writes several again at its first draw, on the GPU
 * process's main thread, presenting no frame meanwhile: 1–6 s for a skin scatter variant on real data. A pass that needs several targets
 * draws once per target instead (skin-scatter.ts, layered-material.ts, plate-composite.ts).
 */
const SRC = resolve(import.meta.dir, "../src");
const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? sources(join(dir, entry.name)) : entry.name.endsWith(".ts") ? [join(dir, entry.name)] : []);

test("no shader declares an output past location 0, and no render target has more than one colour attachment", () => {
  const found: string[] = [];
  for (const file of sources(SRC)) {
    const text = readFileSync(file, "utf8"), name = relative(SRC, file).replaceAll("\\", "/");
    text.split("\n").forEach((line, i) => {
      if (/layout\s*\(\s*location\s*=\s*[1-9]/.test(line) || /gl_FragData\s*\[\s*[1-9]/.test(line)) found.push(`${name}:${i + 1} a second output`);
      if (/WebGLMultipleRenderTargets|\bdrawBuffers\s*\(/.test(line)) found.push(`${name}:${i + 1} several draw buffers`);
    });
    // A render target made with several textures (`count`), wherever its options are written.
    for (const match of text.matchAll(/new THREE\.WebGL(?:Array|3D)?RenderTarget\(([^;]*?)\)\s*[;,)]/gs))
      if (/\bcount\s*:\s*(?!1\b)\d/.test(match[1]!)) found.push(`${name}: a render target with several colour attachments`);
  }
  expect(found).toEqual([]);
});

test("the scan finds what it guards against", () => {
  const sample = "layout( location = 2 ) out highp vec4 x;\nconst t = new THREE.WebGLRenderTarget(4, 4, { count: 3, depthBuffer: false });";
  expect(/layout\s*\(\s*location\s*=\s*[1-9]/.test(sample)).toBe(true);
  expect([...sample.matchAll(/new THREE\.WebGL(?:Array|3D)?RenderTarget\(([^;]*?)\)\s*[;,)]/gs)].some(match => /\bcount\s*:\s*(?!1\b)\d/.test(match[1]!))).toBe(true);
});
