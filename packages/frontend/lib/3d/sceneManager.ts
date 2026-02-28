import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

export interface SceneConfig {
  maxAgents?: number;
  cameraDistance?: number;
  enableShadows?: boolean;
  antialias?: boolean;
}

export class SceneManager {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  public cssRenderer: CSS2DRenderer;
  public controls: OrbitControls;

  private animationFrameId: number | null = null;
  private container: HTMLElement;
  private onRenderCallbacks: ((delta: number) => void)[] = [];
  private clock: THREE.Clock;
  private fpsArray: number[] = [];
  private lastFPSLog = 0;

  constructor(container: HTMLElement, config: SceneConfig = {}) {
    this.container = container;
    this.clock = new THREE.Clock();

    // Initialize scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);
    this.scene.fog = new THREE.Fog(0x1a1a2e, 50, 200);

    // Initialize camera
    const aspect = container.clientWidth / container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
    this.camera.position.set(0, 15, config.cameraDistance || 30);
    this.camera.lookAt(0, 0, 0);

    // Initialize WebGL renderer with performance optimizations
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    this.renderer = new THREE.WebGLRenderer({
      antialias: config.antialias !== false && !isMobile,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = config.enableShadows || false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // Initialize CSS2D renderer for labels
    this.cssRenderer = new CSS2DRenderer();
    this.cssRenderer.setSize(container.clientWidth, container.clientHeight);
    this.cssRenderer.domElement.style.position = 'absolute';
    this.cssRenderer.domElement.style.top = '0';
    this.cssRenderer.domElement.style.pointerEvents = 'none';
    container.appendChild(this.cssRenderer.domElement);

    // Initialize OrbitControls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 50;
    this.controls.maxPolarAngle = Math.PI / 2;
    this.controls.target.set(0, 0, 0);

    // Disable zoom on mouse wheel to prevent scroll hijacking
    // Users can still zoom with pinch or right-click drag
    this.controls.enableZoom = true;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };

    // Only enable zoom when mouse is over the canvas
    let isMouseOver = false;

    this.renderer.domElement.addEventListener('mouseenter', () => {
      isMouseOver = true;
      this.controls.enableZoom = true;
    });

    this.renderer.domElement.addEventListener('mouseleave', () => {
      isMouseOver = false;
      this.controls.enableZoom = false;
    });

    // Prevent wheel zoom unless mouse is over canvas
    this.renderer.domElement.addEventListener('wheel', (e) => {
      if (!isMouseOver) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, { passive: false });

    // Setup lighting
    this.setupLighting();

    // Handle window resize
    window.addEventListener('resize', this.handleResize);
  }

  private setupLighting(): void {
    // Ambient light for overall illumination
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    // Directional light for shadows and highlights
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = true;
    directionalLight.shadow.camera.near = 0.1;
    directionalLight.shadow.camera.far = 100;
    directionalLight.shadow.camera.left = -30;
    directionalLight.shadow.camera.right = 30;
    directionalLight.shadow.camera.top = 30;
    directionalLight.shadow.camera.bottom = -30;
    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
    this.scene.add(directionalLight);

    // Hemisphere light for natural ambient
    const hemisphereLight = new THREE.HemisphereLight(0x87ceeb, 0x444444, 0.4);
    this.scene.add(hemisphereLight);

    // Point lights for accent
    const pointLight1 = new THREE.PointLight(0x4a90e2, 0.5, 50);
    pointLight1.position.set(10, 10, 10);
    this.scene.add(pointLight1);

    const pointLight2 = new THREE.PointLight(0xf39c12, 0.5, 50);
    pointLight2.position.set(-10, 10, -10);
    this.scene.add(pointLight2);
  }

  private handleResize = (): void => {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
    this.cssRenderer.setSize(width, height);
  };

  public addRenderCallback(callback: (delta: number) => void): void {
    this.onRenderCallbacks.push(callback);
  }

  public removeRenderCallback(callback: (delta: number) => void): void {
    const index = this.onRenderCallbacks.indexOf(callback);
    if (index > -1) {
      this.onRenderCallbacks.splice(index, 1);
    }
  }

  private animate = (): void => {
    this.animationFrameId = requestAnimationFrame(this.animate);

    const delta = this.clock.getDelta();

    // Update controls
    this.controls.update();

    // Execute render callbacks
    for (const callback of this.onRenderCallbacks) {
      callback(delta);
    }

    // Render scene
    this.renderer.render(this.scene, this.camera);
    this.cssRenderer.render(this.scene, this.camera);

    // FPS monitoring (development only)
    if (process.env.NODE_ENV === 'development') {
      this.monitorFPS(delta);
    }
  };

  private monitorFPS(delta: number): void {
    const fps = 1 / delta;
    this.fpsArray.push(fps);

    // Log average FPS every 3 seconds
    const now = Date.now();
    if (now - this.lastFPSLog > 3000) {
      const avgFPS = this.fpsArray.reduce((a, b) => a + b, 0) / this.fpsArray.length;
      console.log(`[SceneManager] Average FPS: ${avgFPS.toFixed(1)}`);
      this.fpsArray = [];
      this.lastFPSLog = now;
    }
  }

  public start(): void {
    if (!this.animationFrameId) {
      this.animate();
    }
  }

  public stop(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  public dispose(): void {
    this.stop();
    window.removeEventListener('resize', this.handleResize);

    // Dispose renderer
    this.renderer.dispose();

    // Remove DOM elements
    this.container.removeChild(this.renderer.domElement);
    this.container.removeChild(this.cssRenderer.domElement);

    // Dispose controls
    this.controls.dispose();

    // Clear scene
    this.scene.clear();
  }

  public add(object: THREE.Object3D): void {
    this.scene.add(object);
  }

  public remove(object: THREE.Object3D): void {
    this.scene.remove(object);
  }

  public getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  public getScene(): THREE.Scene {
    return this.scene;
  }
}
