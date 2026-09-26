import { expect, test } from "bun:test";
import { layerRenderQueue } from "../src/layer-render-queue";
import { initialRecipe } from "./fixtures/eye-region";

test("deferred masks follow edited layers through selection/reordering and discard replaced objects", () => {
  let layers = initialRecipe().layers;
  const frames: (() => void)[] = [], rendered: string[] = [];
  const schedule = layerRenderQueue(() => layers, run => frames.push(run), index => rendered.push(layers[index].id));
  const a = layers[0], b = layers[1];
  schedule(a); schedule(a); schedule(b);
  layers.reverse();
  expect(frames).toHaveLength(1); frames.shift()!();
  expect(rendered).toEqual([a.id, b.id]);
  schedule(a); layers = structuredClone(layers); frames.shift()!();
  expect(rendered).toHaveLength(2);
  schedule(layers[0]); frames.shift()!();
  expect(rendered[2]).toBe(layers[0].id);
  schedule(undefined); expect(frames).toHaveLength(0);
});
