import { test, expect } from "bun:test";
import * as THREE from "three";
import { IdleAnimation } from "../src/idle-animation";

test("facial movement composes before head rotation, with its own clock and exact restore", () => {
  const body = new THREE.Group(), head = new THREE.Bone(); head.name="Head";body.add(head);
  const facial = new THREE.Group(), faceHead = new THREE.Bone(), lip = new THREE.Bone();
  faceHead.name="Head";lip.name="lip";lip.position.x=1;faceHead.add(lip);facial.add(faceHead);
  const preview = new THREE.Group(), target = new THREE.Bone(); target.name="lip";target.position.x=1;
  preview.add(target);preview.updateMatrixWorld(true);
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/2);
  const bodyClip = new THREE.AnimationClip("body",.4,[new THREE.QuaternionKeyframeTrack("Head.quaternion",[0,.4],[...turn.toArray(),...turn.toArray()])]);
  const faceClip = new THREE.AnimationClip("face",2,[new THREE.VectorKeyframeTrack("lip.position",[0,1,2],[1,0,0,2,0,0,1,0,0])]);
  const idle = new IdleAnimation(body,bodyClip,[target],{lip:"Head"},{source:facial,clip:faceClip});
  idle.setEnabled(true);
  for(let i=0;i<7;i++) idle.update(.1);
  expect(target.position.x).toBeCloseTo(0,6);
  expect(target.position.y).toBeCloseTo(1.7,6); // Face does not reset at body's .4s loop.
  idle.seek(4.7); // Restore a workspace well beyond either loop's first cycle.
  expect(idle.time).toBe(4.7);
  expect(target.position.y).toBeCloseTo(1.7,6);
  idle.setEnabled(false);
  expect(target.position.toArray()).toEqual([1,0,0]);
  expect(target.quaternion.toArray()).toEqual([0,0,0,1]);
});

test("decoded motion follows inherited drivers, carries unskinned eyes and restores exactly", () => {
  const source = new THREE.Group(), driver = new THREE.Bone();
  driver.name = "Head"; driver.position.set(0,2,0); source.add(driver);
  const target = new THREE.Group(), lid = new THREE.Bone(), eyes = new THREE.Object3D();
  lid.name = "lid"; lid.position.set(1,2,0); eyes.name = "eyes"; eyes.position.set(0,2,1);
  target.add(lid,eyes); target.updateMatrixWorld(true);
  const clip = new THREE.AnimationClip("idle",2,[new THREE.VectorKeyframeTrack("Head.position",[0,1,2],[0,2,0, 0,3,0, 0,2,0])]);
  const idle = new IdleAnimation(source,clip,[lid,eyes],{lid:"Head",eyes:"Head"});
  expect(idle.unmapped).toEqual([]);
  const original = [lid.position.clone(),eyes.position.clone()];
  idle.setEnabled(true);
  for(let i=0;i<5;i++) idle.update(.1);
  expect(lid.position.y).toBeCloseTo(2.5,6);
  expect(eyes.position.y).toBeCloseTo(2.5,6);
  expect(lid.position.x).toBe(1);
  idle.setEnabled(false);
  expect(lid.position.toArray()).toEqual(original[0].toArray());
  expect(eyes.position.toArray()).toEqual(original[1].toArray());
  idle.update(.1);
  expect(lid.position.toArray()).toEqual(original[0].toArray());
  idle.setEnabled(true);
  expect(idle.time).toBe(0);
});

test("nested target bones receive a world transform once, and unmapped controls are reported", () => {
  const source = new THREE.Group(), driver = new THREE.Bone(); driver.name="Head"; source.add(driver);
  const target = new THREE.Group(), parent = new THREE.Bone(), child = new THREE.Bone(), unknown = new THREE.Bone();
  parent.name="face";child.name="lid";unknown.name="unknown";
  parent.position.x=2;child.position.x=1;parent.add(child);target.add(parent,unknown);target.updateMatrixWorld(true);
  const clip = new THREE.AnimationClip("idle",2,[new THREE.VectorKeyframeTrack("Head.position",[0,1,2],[0,0,0,0,1,0,0,0,0])]);
  const idle = new IdleAnimation(source,clip,[child,parent,unknown],{face:"Head",lid:"face"});
  expect(idle.unmapped).toEqual(["unknown"]);idle.setEnabled(true);idle.update(.1);
  expect(child.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(.1,6);
  expect(child.position.y).toBeCloseTo(0,6);
  expect(child.getWorldPosition(new THREE.Vector3()).x).toBeCloseTo(3,6);
});
