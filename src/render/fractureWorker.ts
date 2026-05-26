/// <reference lib="webworker" />
import * as THREE from "three";
import { Brush, Evaluator, INTERSECTION } from "three-bvh-csg";
import { mergeVertices } from "three-stdlib";

// Voronoi fracture runs entirely off the main thread. The host posts a
// baked, indexed `position` buffer; we run the N×N CSG and post back the
// per-chunk geometry as raw typed arrays via transferables so the main
// thread never blocks on the work and never copies the result buffers.

export type FractureWorkerRequest = {
  jobId: number;
  positions: Float32Array;
  indices: Uint32Array | Uint16Array;
  numSeeds: number;
  seed: number;
};

export type FractureWorkerChunk = {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array | Uint16Array;
  origin: [number, number, number];
  radius: number;
};

export type FractureWorkerResponse =
  | { jobId: number; ok: true; chunks: FractureWorkerChunk[] }
  | { jobId: number; ok: false; error: string };

const halfspaceBrush = (plane: THREE.Plane, big: number): Brush => {
  const box = new THREE.BoxGeometry(big, big, big);
  box.translate(0, 0, big / 2);
  const z = plane.normal.clone().normalize();
  const up = Math.abs(z.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const x = new THREE.Vector3().crossVectors(up, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  const basis = new THREE.Matrix4().makeBasis(x, y, z);
  box.applyMatrix4(basis);
  const p = z.clone().multiplyScalar(-plane.constant);
  box.translate(p.x, p.y, p.z);
  const welded = mergeVertices(box, 1e-5);
  return new Brush(welded);
};

const mkRng = (seed: number): (() => number) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const buildSourceBrush = (positions: Float32Array, indices: Uint32Array | Uint16Array): Brush => {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  g.computeVertexNormals();
  const brush = new Brush(g);
  brush.updateMatrixWorld();
  return brush;
};

const extractChunk = (geometry: THREE.BufferGeometry): FractureWorkerChunk | null => {
  const pos = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos || pos.count === 0) return null;

  const cbox = new THREE.Box3().setFromBufferAttribute(pos);
  const cCenter = cbox.getCenter(new THREE.Vector3());
  const cSize = cbox.getSize(new THREE.Vector3());
  geometry.translate(-cCenter.x, -cCenter.y, -cCenter.z);
  geometry.computeVertexNormals();

  const newPos = geometry.getAttribute("position") as THREE.BufferAttribute;
  const newNorm = geometry.getAttribute("normal") as THREE.BufferAttribute;
  // Three-bvh-csg outputs un-indexed geometry; generate a trivial index
  // so the receiver can keep the BufferGeometry indexed (cheaper draw +
  // matches the rest of the engine's mesh format).
  const idx = geometry.getIndex();
  const indexArr: Uint32Array | Uint16Array = idx
    ? new Uint32Array(idx.array as ArrayLike<number>)
    : (() => {
        const n = newPos.count;
        const a = new Uint32Array(n);
        for (let k = 0; k < n; k++) a[k] = k;
        return a;
      })();

  return {
    positions: new Float32Array(newPos.array as ArrayLike<number>),
    normals: new Float32Array(newNorm.array as ArrayLike<number>),
    indices: indexArr,
    origin: [cCenter.x, cCenter.y, cCenter.z],
    radius: Math.max(cSize.x, cSize.y, cSize.z) * 0.5 || 0.05,
  };
};

const doFracture = (req: FractureWorkerRequest): FractureWorkerChunk[] => {
  const { positions, indices, numSeeds, seed } = req;
  if (positions.length === 0) return [];

  const rng = mkRng(seed);
  const sourceBrush = buildSourceBrush(positions, indices);

  const bbox = new THREE.Box3();
  const tmp = new THREE.Vector3();
  for (let i = 0; i < positions.length; i += 3) {
    tmp.set(positions[i], positions[i + 1], positions[i + 2]);
    bbox.expandByPoint(tmp);
  }
  const size = bbox.getSize(new THREE.Vector3());
  const big = Math.max(size.x, size.y, size.z, 0.01) * 12;

  const seeds: THREE.Vector3[] = [];
  for (let i = 0; i < numSeeds; i++) {
    const fx = (rng() + rng()) * 0.5;
    const fy = (rng() + rng()) * 0.5;
    const fz = (rng() + rng()) * 0.5;
    seeds.push(
      new THREE.Vector3(
        bbox.min.x + fx * size.x,
        bbox.min.y + fy * size.y,
        bbox.min.z + fz * size.z,
      ),
    );
  }

  const evaluator = new Evaluator();
  evaluator.useGroups = false;
  evaluator.attributes = ["position", "normal"];

  const chunks: FractureWorkerChunk[] = [];
  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i];
    let cell: Brush = sourceBrush;
    let aborted = false;
    for (let j = 0; j < seeds.length; j++) {
      if (j === i) continue;
      const s2 = seeds[j];
      const normal = s.clone().sub(s2);
      const nlen = normal.length();
      if (nlen < 1e-6) continue;
      normal.multiplyScalar(1 / nlen);
      const point = s.clone().add(s2).multiplyScalar(0.5);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point);
      const hs = halfspaceBrush(plane, big);
      const out = new Brush(new THREE.BufferGeometry());
      try {
        evaluator.evaluate(cell, hs, INTERSECTION, out);
      } catch (_e) {
        aborted = true;
        break;
      }
      const pos = out.geometry.getAttribute("position");
      if (!pos || pos.count === 0) {
        aborted = true;
        break;
      }
      cell = out;
    }
    if (aborted) continue;

    const chunk = extractChunk(cell.geometry);
    if (chunk) chunks.push(chunk);
  }
  return chunks;
};

self.addEventListener("message", (ev: MessageEvent<FractureWorkerRequest>) => {
  const req = ev.data;
  try {
    const chunks = doFracture(req);
    const transferables: ArrayBuffer[] = [];
    for (const c of chunks) {
      transferables.push(c.positions.buffer, c.normals.buffer, c.indices.buffer);
    }
    const response: FractureWorkerResponse = { jobId: req.jobId, ok: true, chunks };
    (self as DedicatedWorkerGlobalScope).postMessage(response, transferables);
  } catch (e) {
    const response: FractureWorkerResponse = {
      jobId: req.jobId,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
    (self as DedicatedWorkerGlobalScope).postMessage(response);
  }
});
