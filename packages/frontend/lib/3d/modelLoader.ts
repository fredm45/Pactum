import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { getRandomModel, type ModelConfig } from './modelConfig';

export type AgentType = 'buyer' | 'seller';

export interface LoadedModel {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
  mixer: THREE.AnimationMixer;
}

export interface ModelLoaderConfig {
  enableDraco?: boolean;
  dracoPath?: string;
}

class ModelLoaderClass {
  private gltfLoader: GLTFLoader;
  private dracoLoader: DRACOLoader | null = null;

  constructor(config: ModelLoaderConfig = {}) {
    this.gltfLoader = new GLTFLoader();

    if (config.enableDraco !== false) {
      this.dracoLoader = new DRACOLoader();
      const dracoPath = config.dracoPath || 'https://www.gstatic.com/draco/versioned/decoders/1.5.6/';
      this.dracoLoader.setDecoderPath(dracoPath);
      this.gltfLoader.setDRACOLoader(this.dracoLoader);
    }
  }

  /**
   * Load a 3D model (no caching - always fresh, no cloning)
   */
  public async loadModel(type: AgentType, modelConfig?: ModelConfig): Promise<LoadedModel> {
    const config = modelConfig || getRandomModel(type);
    // Load directly, no cloning (cloning causes Rig filter to fail)
    return this.loadFromFile(config.path, config);
  }

  private loadFromFile(path: string, config?: ModelConfig): Promise<LoadedModel> {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        path,
        (gltf) => {
          const mixer = new THREE.AnimationMixer(gltf.scene);

          // Apply optimizations and Rig filtering
          this.optimizeModel(gltf.scene, config);

          // Apply scale/position/rotation
          this.applyTransforms(gltf.scene, config);

          resolve({
            scene: gltf.scene,
            animations: gltf.animations,
            mixer,
          });
        },
        undefined,
        (error) => {
          console.error(`[ModelLoader] Failed to load ${path}:`, error);
          reject(error);
        }
      );
    });
  }

  /**
   * Optimize model and apply Rig filtering for packed GLTFs
   */
  private optimizeModel(scene: THREE.Group, config?: ModelConfig): void {
    // STEP 1: For packed GLTFs, hide all Rig nodes except the target one
    if (config?.rigName) {
      const allRigs: string[] = [];
      const hiddenRigs: string[] = [];

      scene.traverse((child) => {
        if (child.name && child.name.match(/^Rig(\d+)?$/)) {
          allRigs.push(child.name);
          const shouldShow = child.name === config.rigName;
          child.visible = shouldShow;

          if (!shouldShow) {
            hiddenRigs.push(child.name);
            // Recursively hide all children
            child.traverse((c) => {
              c.visible = false;
            });
          }
        }
      });

      console.log(`[ModelLoader] Rig Filter - Target: ${config.rigName}, Found: [${allRigs.join(', ')}], Hidden: [${hiddenRigs.join(', ')}]`);
    }

    // STEP 2: For packed GLTFs, hide ALL other Rigs (including Rig008-Rig028)
    if (config?.rigName) {
      // Hide all Rig nodes that are not our target (this catches Rig008+ that weren't caught above)
      scene.traverse((child) => {
        if (child.name && child.name.match(/^Rig\d+$/)) {
          const shouldShow = child.name === config.rigName;
          if (!shouldShow) {
            child.visible = false;
            child.traverse((c) => c.visible = false);
          }
        }
      });
    }

    // STEP 3: Hide text meshes and UI elements
    scene.traverse((child) => {
      // Hide objects with action/shapekey/text in name
      if (child.name && (
        child.name.toLowerCase().includes('action') ||
        child.name.toLowerCase().includes('shapekey') ||
        child.name.toLowerCase().includes('text') ||
        child.name.toLowerCase().includes('morph')
      )) {
        child.visible = false;
        child.traverse((c) => c.visible = false);
      }
    });

    // STEP 3: Basic optimization
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;

        if (child.material) {
          const material = child.material as THREE.MeshStandardMaterial;
          material.needsUpdate = false;
        }

        if (child.geometry) {
          child.geometry.computeBoundingSphere();
        }
      }
    });
  }

  /**
   * Apply transformations to loaded model
   */
  private applyTransforms(scene: THREE.Group, config?: ModelConfig): void {
    if (config) {
      if (config.scale) {
        scene.scale.setScalar(config.scale);
      }
      if (config.position && config.position[1] !== 0) {
        scene.position.y = config.position[1];
      }
      if (config.rotation) {
        scene.rotation.set(...config.rotation);
      }
    }
  }

  /**
   * Preload models
   */
  public async preloadAll(): Promise<void> {
    const types: AgentType[] = ['buyer', 'seller'];

    for (const type of types) {
      await this.loadModel(type);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    if (this.dracoLoader) {
      this.dracoLoader.dispose();
    }
  }
}

// Export singleton instance
export const ModelLoader = new ModelLoaderClass({
  enableDraco: true,
  dracoPath: 'https://www.gstatic.com/draco/versioned/decoders/1.5.6/',
});

// Debug: expose to window
if (typeof window !== 'undefined') {
  (window as any).clearModelCache = () => {
    console.log('[ModelLoader] Clearing cache...');
    ModelLoader.dispose();
    console.log('[ModelLoader] Cache cleared. Reload page to see changes.');
  };
}
