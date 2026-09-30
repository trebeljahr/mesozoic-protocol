import * as THREE from "three";

/** Copies already-rendered opaque depth; never renders the scene again. */
export class FlameSceneDepth {
  target: THREE.WebGLRenderTarget | null = null;
  ready = false;
  private readonly size = new THREE.Vector2();

  capture(renderer: THREE.WebGLRenderer) {
    this.ready = false;
    const source = renderer.getRenderTarget();
    // Browser-owned default buffers can use an opaque platform depth format.
    // Plain canvases retain hardware depth testing; the game always renders
    // through the composer's known-format offscreen target.
    if (!source?.depthBuffer) return;
    const gl = renderer.getContext();
    if (!("blitFramebuffer" in gl)) return;
    const webgl = gl as WebGL2RenderingContext;
    const stencil = source.stencilBuffer;
    const type =
      source.depthTexture?.type ?? (stencil ? THREE.UnsignedInt248Type : THREE.UnsignedIntType);
    this.size.set(source.width, source.height);
    if (
      !this.target ||
      this.target.stencilBuffer !== stencil ||
      this.target.depthTexture?.type !== type
    ) {
      this.dispose();
      const depth = new THREE.DepthTexture(this.size.x, this.size.y, type);
      depth.format = stencil ? THREE.DepthStencilFormat : THREE.DepthFormat;
      this.target = new THREE.WebGLRenderTarget(this.size.x, this.size.y, {
        // Unused R8 color attachment keeps the framebuffer portable and small.
        format: THREE.RedFormat,
        depthBuffer: true,
        stencilBuffer: stencil,
        depthTexture: depth,
      });
      this.target.texture.name = "FlameSceneDepth.UnusedColor";
      depth.name = "FlameSceneDepth";
    }
    this.target.setSize(this.size.x, this.size.y);
    const sourceFramebuffer = webgl.getParameter(webgl.DRAW_FRAMEBUFFER_BINDING);
    const previousRead = webgl.getParameter(webgl.READ_FRAMEBUFFER_BINDING);
    const cubeFace = renderer.getActiveCubeFace();
    const mipLevel = renderer.getActiveMipmapLevel();
    try {
      renderer.setRenderTarget(this.target);
      webgl.bindFramebuffer(webgl.READ_FRAMEBUFFER, sourceFramebuffer);
      webgl.blitFramebuffer(
        0,
        0,
        this.size.x,
        this.size.y,
        0,
        0,
        this.size.x,
        this.size.y,
        webgl.DEPTH_BUFFER_BIT,
        webgl.NEAREST,
      );
      this.ready = true;
    } finally {
      // setRenderTarget restores Three's framebuffer/viewport state. Restore
      // the raw READ binding too; do not leave its state cache out of sync.
      renderer.setRenderTarget(source, cubeFace, mipLevel);
      webgl.bindFramebuffer(webgl.READ_FRAMEBUFFER, previousRead);
    }
  }

  dispose() {
    this.target?.dispose();
    this.target = null;
    this.ready = false;
  }
}
