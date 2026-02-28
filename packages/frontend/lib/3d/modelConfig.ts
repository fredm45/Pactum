/**
 * 3D Model Configuration
 *
 * Simple, clean models without complex filtering
 */

export interface ModelConfig {
  path: string;
  scale?: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
  rigName?: string; // For packed GLTF files - which Rig node to show
  creator: string;
  source: string;
}

/**
 * Buyer agent models (8 animals from quirky pack)
 */
export const BUYER_MODELS: Record<string, ModelConfig> = {
  sparrow: {
    path: '/models/quirky_series_-_free_animals_pack/scene.gltf',
    scale: 1.5,
    rigName: 'Rig',
    creator: 'omabuarts',
    source: 'https://sketchfab.com/3d-models/quirky-series-free-animals-pack-19e91ef86cd0448f9cbb5d6c538dade2',
  },
  gecko: {
    path: '/models/quirky_series_-_free_animals_pack/scene.gltf',
    scale: 1.5,
    rigName: 'Rig001',
    creator: 'omabuarts',
    source: 'https://sketchfab.com/3d-models/quirky-series-free-animals-pack-19e91ef86cd0448f9cbb5d6c538dade2',
  },
  herring: {
    path: '/models/quirky_series_-_free_animals_pack/scene.gltf',
    scale: 1.5,
    rigName: 'Rig002',
    creator: 'omabuarts',
    source: 'https://sketchfab.com/3d-models/quirky-series-free-animals-pack-19e91ef86cd0448f9cbb5d6c538dade2',
  },
  taipan: {
    path: '/models/quirky_series_-_free_animals_pack/scene.gltf',
    scale: 1.5,
    rigName: 'Rig003',
    creator: 'omabuarts',
    source: 'https://sketchfab.com/3d-models/quirky-series-free-animals-pack-19e91ef86cd0448f9cbb5d6c538dade2',
  },
  muskrat: {
    path: '/models/quirky_series_-_free_animals_pack/scene.gltf',
    scale: 1.5,
    rigName: 'Rig004',
    creator: 'omabuarts',
    source: 'https://sketchfab.com/3d-models/quirky-series-free-animals-pack-19e91ef86cd0448f9cbb5d6c538dade2',
  },
  pudu: {
    path: '/models/quirky_series_-_free_animals_pack/scene.gltf',
    scale: 1.5,
    rigName: 'Rig005',
    creator: 'omabuarts',
    source: 'https://sketchfab.com/3d-models/quirky-series-free-animals-pack-19e91ef86cd0448f9cbb5d6c538dade2',
  },
  colobus: {
    path: '/models/quirky_series_-_free_animals_pack/scene.gltf',
    scale: 1.5,
    rigName: 'Rig006',
    creator: 'omabuarts',
    source: 'https://sketchfab.com/3d-models/quirky-series-free-animals-pack-19e91ef86cd0448f9cbb5d6c538dade2',
  },
  inkfish: {
    path: '/models/quirky_series_-_free_animals_pack/scene.gltf',
    scale: 1.5,
    rigName: 'Rig007',
    creator: 'omabuarts',
    source: 'https://sketchfab.com/3d-models/quirky-series-free-animals-pack-19e91ef86cd0448f9cbb5d6c538dade2',
  },
  default: {
    path: '/models/buyer.glb',
    scale: 2.0,
    creator: 'Sketchfab',
    source: 'https://sketchfab.com',
  },
};

/**
 * Seller agent models (4 different robots)
 */
export const SELLER_MODELS: Record<string, ModelConfig> = {
  robot1: {
    path: '/models/robot/scene.gltf',
    scale: 10.0,
    creator: 'armatita',
    source: 'https://sketchfab.com/3d-models/robot-a3ae53c4b3cf44a59c4e83167c31eb94',
  },
  robot2: {
    path: '/models/animated_robot_sdc/scene.gltf',
    scale: 0.75,
    creator: 'Sousinho',
    source: 'https://sketchfab.com/3d-models/animated-robot-sdc-676c763aa75447ea8ab01c0fea80a55e',
  },
  robot3: {
    path: '/models/robot_from_the_series_love_death_and_robots/scene.gltf',
    scale: 0.3,
    creator: 'Sketchfab',
    source: 'https://sketchfab.com',
  },
  robot4: {
    path: '/models/robot_rocket/scene.gltf',
    scale: 0.02,
    creator: 'Sketchfab',
    source: 'https://sketchfab.com',
  },
  default: {
    path: '/models/seller.glb',
    scale: 2.0,
    creator: 'Sketchfab',
    source: 'https://sketchfab.com',
  },
};

/**
 * Get model config for an agent
 */
export function getModelConfig(
  agentType: 'buyer' | 'seller',
  variant?: string
): ModelConfig {
  const models = agentType === 'buyer' ? BUYER_MODELS : SELLER_MODELS;

  if (variant && models[variant]) {
    return models[variant];
  }

  return models.default;
}

/**
 * Get a random model for an agent type
 */
export function getRandomModel(agentType: 'buyer' | 'seller'): ModelConfig {
  const models = agentType === 'buyer' ? BUYER_MODELS : SELLER_MODELS;
  const variants = Object.keys(models).filter(k => k !== 'default');
  const randomVariant = variants[Math.floor(Math.random() * variants.length)];

  return models[randomVariant] || models.default;
}

/**
 * Animation mappings for different model types
 */
export const ANIMATION_MAPPINGS = {
  idle: ['idle', 'Idle', 'idle_01', 'Armature|idle', 'Take 001'],
  paying: ['wave', 'Wave', 'nod', 'Nod', 'pay', 'gesture'],
  working: ['typing', 'Typing', 'work', 'Work', 'busy'],
  celebrating: ['dance', 'Dance', 'celebrate', 'Celebrate', 'success', 'happy'],
};

/**
 * Find matching animation clip name from GLB
 */
export function findAnimationClip(
  availableClips: string[],
  semanticName: keyof typeof ANIMATION_MAPPINGS
): string | null {
  const possibleNames = ANIMATION_MAPPINGS[semanticName];

  for (const name of possibleNames) {
    const found = availableClips.find(
      clip => clip.toLowerCase().includes(name.toLowerCase())
    );
    if (found) return found;
  }

  return null;
}
