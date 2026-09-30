import * as THREE from "three";
import { expect, it, vi } from "vitest";
import { FlameSceneDepth } from "./FlameSceneDepth";

const fixture = (
  source: THREE.WebGLRenderTarget | null = new THREE.WebGLRenderTarget(800, 600),
) => {
  const draw = {},
    read = {};
  const gl = {
    DRAW_FRAMEBUFFER_BINDING: 1,
    READ_FRAMEBUFFER_BINDING: 2,
    READ_FRAMEBUFFER: 3,
    DEPTH_BUFFER_BIT: 4,
    NEAREST: 5,
    getParameter: vi.fn((key: number) => (key === 1 ? draw : read)),
    bindFramebuffer: vi.fn(),
    blitFramebuffer: vi.fn(),
  };
  const renderer = {
    getRenderTarget: () => source,
    getContext: () => gl,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    setRenderTarget: vi.fn(),
    render: vi.fn(),
  };
  return { gl, renderer, source, read, api: renderer as unknown as THREE.WebGLRenderer };
};

it("copies depth only, restores the caller's framebuffer, and reuses resized storage", () => {
  const f = fixture();
  const depth = new FlameSceneDepth();
  depth.capture(f.api);
  const target = depth.target;
  expect(depth.ready).toBe(true);
  expect(f.renderer.render).not.toHaveBeenCalled();
  expect(f.gl.blitFramebuffer).toHaveBeenCalledWith(0, 0, 800, 600, 0, 0, 800, 600, 4, 5);
  expect(f.renderer.setRenderTarget).toHaveBeenLastCalledWith(f.source, 0, 0);
  expect(f.gl.bindFramebuffer).toHaveBeenLastCalledWith(3, f.read);
  f.source!.setSize(400, 300);
  depth.capture(f.api);
  expect(depth.target).toBe(target);
  expect(depth.target?.width).toBe(400);
  const dispose = vi.spyOn(target!, "dispose");
  depth.dispose();
  expect(dispose).toHaveBeenCalledOnce();
  expect(depth.ready).toBe(false);
  expect(depth.target).toBeNull();
});

it("restores renderer state even if a copy fails", () => {
  const f = fixture();
  const depth = new FlameSceneDepth();
  f.gl.blitFramebuffer.mockImplementation(() => {
    throw new Error("copy failed");
  });
  expect(() => depth.capture(f.api)).toThrow("copy failed");
  expect(f.renderer.setRenderTarget).toHaveBeenLastCalledWith(f.source, 0, 0);
  expect(f.gl.bindFramebuffer).toHaveBeenLastCalledWith(3, f.read);
  expect(depth.ready).toBe(false);
  depth.dispose();
});

it("does not copy from browser-owned or depthless framebuffers", () => {
  for (const source of [null, new THREE.WebGLRenderTarget(800, 600, { depthBuffer: false })]) {
    const f = fixture(source);
    const depth = new FlameSceneDepth();
    depth.capture(f.api);
    expect(f.gl.blitFramebuffer).not.toHaveBeenCalled();
    expect(depth.ready).toBe(false);
  }
});

it("matches stencil and floating-point source depth formats", () => {
  for (const stencil of [false, true]) {
    const source = new THREE.WebGLRenderTarget(800, 600, { stencilBuffer: stencil });
    source.depthTexture = new THREE.DepthTexture(
      800,
      600,
      stencil ? THREE.UnsignedInt248Type : THREE.FloatType,
    );
    const f = fixture(source);
    const depth = new FlameSceneDepth();
    depth.capture(f.api);
    expect(depth.target?.depthTexture?.type).toBe(source.depthTexture.type);
    expect(depth.target?.depthTexture?.format).toBe(
      stencil ? THREE.DepthStencilFormat : THREE.DepthFormat,
    );
    depth.dispose();
  }
});
