'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface AgentModel {
  id: string;
  label: string;
  path: string;
  scale: number;
  color: string;
  pos: [number, number]; // [x, z]
  type: 'animal' | 'robot';
  faceY?: number;
  description?: string;
  category?: string;
  price?: string;
  keywords?: string[]; // product keywords for query bubbles
}

/** Real seller data fetched from API */
export interface SellerData {
  wallet: string;
  description: string;
  items: { name: string; description: string; price: number; type: string }[];
}

// Robots: Z = -40 (close behind desk), evenly spaced
const ROBOT_Z = -40;
const ROBOT_SPACING = 100;

// Default robot model templates (visual appearance only, data filled from API)
const ROBOT_TEMPLATES: Omit<AgentModel, 'label' | 'description' | 'category' | 'price' | 'keywords'>[] = [
  { id: 'robot1', path: '/models/robot/scene.gltf',             scale: 36.0, color: '#f39c12', pos: [-1.0 * ROBOT_SPACING, ROBOT_Z], type: 'robot', faceY: 0 },
  { id: 'robot2', path: '/models/animated_robot_sdc/scene.gltf', scale: 18.0, color: '#f39c12', pos: [0, ROBOT_Z],                    type: 'robot', faceY: -Math.PI / 2 },
  { id: 'robot4', path: '/models/robot_rocket/scene.gltf',       scale: 14.0, color: '#f39c12', pos: [1.0 * ROBOT_SPACING, ROBOT_Z],  type: 'robot', faceY: 0 },
];

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/** Extract keywords from item names/descriptions for query bubbles */
function extractItemKeywords(items: SellerData['items']): string[] {
  const kw: string[] = [];
  for (const item of items) {
    kw.push(item.name + '?');
    // pull a few meaningful words from description
    const words = item.description
      .split(/[\s,;.!?]+/)
      .filter(w => w.length > 3)
      .filter(w => !['this', 'that', 'with', 'from', 'your', 'will', 'have', 'been', 'their', 'about', 'which', 'would', 'there', 'these', 'into', 'than', 'them', 'other', 'some', 'beautiful', 'delivered'].includes(w.toLowerCase()))
      .slice(0, 2);
    kw.push(...words.map(w => w + '?'));
  }
  return [...new Set(kw)];
}

/** Build ROBOTS array from real seller data, falling back to defaults */
function buildRobots(sellers: SellerData[]): AgentModel[] {
  return ROBOT_TEMPLATES.map((tmpl, i) => {
    const seller = sellers[i];
    if (seller) {
      const hasItems = seller.items.length > 0;
      const firstItem = seller.items[0];
      return {
        ...tmpl,
        label: shortAddr(seller.wallet),
        description: seller.description,
        category: hasItems ? firstItem.type : 'agent',
        price: hasItems ? `$${firstItem.price} USDC` : '',
        keywords: hasItems ? extractItemKeywords(seller.items) : ['Hello?', 'Services?'],
      };
    }
    // No seller for this slot — show placeholder
    return {
      ...tmpl,
      label: 'Available Slot',
      description: 'This slot is available for a new seller agent.',
      category: 'vacant',
      price: '',
      keywords: ['Hello?', 'Anyone?'],
    };
  });
}

// Fallback for when API hasn't loaded yet
const DEFAULT_ROBOTS: AgentModel[] = buildRobots([]);

// Animals: all 8, but only first 3 visible initially; rest spawn over time
const ANIMAL_Z = 80;
const ANIMAL_SPACING = 26;
const ANIMALS: AgentModel[] = [
  { id: 'sparrow', label: '', path: '/models/animals/sparrow.glb', scale: 0.15, color: '#4a90e2', pos: [-3.5 * ANIMAL_SPACING, ANIMAL_Z], type: 'animal' },
  { id: 'gecko',   label: '', path: '/models/animals/gecko.glb',   scale: 0.15, color: '#4a90e2', pos: [-2.5 * ANIMAL_SPACING, ANIMAL_Z], type: 'animal' },
  { id: 'herring', label: '', path: '/models/animals/herring.glb', scale: 0.15, color: '#4a90e2', pos: [-1.5 * ANIMAL_SPACING, ANIMAL_Z], type: 'animal' },
  { id: 'taipan',  label: '', path: '/models/animals/taipan.glb',  scale: 0.15, color: '#4a90e2', pos: [-0.5 * ANIMAL_SPACING, ANIMAL_Z], type: 'animal' },
  { id: 'muskrat', label: '', path: '/models/animals/muskrat.glb', scale: 0.15, color: '#4a90e2', pos: [ 0.5 * ANIMAL_SPACING, ANIMAL_Z], type: 'animal' },
  { id: 'pudu',    label: '', path: '/models/animals/pudu.glb',    scale: 0.15, color: '#4a90e2', pos: [ 1.5 * ANIMAL_SPACING, ANIMAL_Z], type: 'animal' },
  { id: 'colobus', label: '', path: '/models/animals/colobus.glb', scale: 0.15, color: '#4a90e2', pos: [ 2.5 * ANIMAL_SPACING, ANIMAL_Z], type: 'animal' },
  { id: 'inkfish', label: '', path: '/models/animals/inkfish.glb', scale: 0.15, color: '#4a90e2', pos: [ 3.5 * ANIMAL_SPACING, ANIMAL_Z], type: 'animal' },
];

const INITIAL_ANIMAL_COUNT = 3;
const MAX_ANIMAL_COUNT = 8;
const SPAWN_MIN_INTERVAL = 8;
const SPAWN_MAX_INTERVAL = 15;

// Animal roaming bounds — keep animals in front of desk (Z > 30)
const ROAM_MIN_X = -120;
const ROAM_MAX_X = 120;
const ROAM_MIN_Z = 35;
const ROAM_MAX_Z = 140;
// Desk collision zone — animals must stay in front of this Z line
const DESK_FRONT_Z = 40;
const ROAM_SPEED = 5;

// Interaction timing
const INTERACTION_MIN_INTERVAL = 10;
const INTERACTION_MAX_INTERVAL = 20;
const APPROACH_SPEED = 12;
const APPROACH_TARGET_Z = 45; // stop in front of desk
const MONEY_CHANCE = 0.2; // 20% chance of $ after interaction

// Fallback query keywords
const FALLBACK_KEYWORDS = [
  'Search?', 'Translate?', 'Analyze?', 'Summarize?',
  'Help?', 'Price?', 'Data?', 'Report?', 'Advice?', 'Info?',
];

type InteractionState = 'roaming' | 'approaching' | 'querying' | 'response' | 'departing';

interface AgentState {
  mixer: THREE.AnimationMixer;
  model: THREE.Group;
  labelAnchor: THREE.Group;
  labelDiv: HTMLDivElement;
  labelHeight: number;
  type: 'animal' | 'robot';
  modelIndex: number; // index in ALL_MODELS
  spawned: boolean; // whether visible in scene
  // Roaming
  direction: number;
  targetX: number;
  targetZ: number;
  stateTimer: number;
  // Interaction state machine
  interactionState: InteractionState;
  interactionTarget: number; // index in agentData of target robot
  interactionTimer: number;
  // Original position (to return after interaction)
  homeX: number;
  homeZ: number;
  // Consumer hash ID (shown only during interaction)
  consumerId: string;
}

function generateConsumerId(): string {
  const hex = Array.from({ length: 20 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
  return `0x${hex.slice(0, 4)}...${hex.slice(-4)}`;
}

interface RobotInfo {
  label: string;
  description: string;
  category: string;
  price: string;
  wallet?: string;
}

interface Agent3DSceneProps {
  sellers?: SellerData[];
}

export function Agent3DScene({ sellers }: Agent3DSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const [loadedCount, setLoadedCount] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [selectedRobot, setSelectedRobot] = useState<RobotInfo | null>(null);
  const selectedRobotRef = useRef<RobotInfo | null>(null);
  const sellersRef = useRef<SellerData[]>([]);
  // Store robot label divs for dynamic updates when sellers data arrives
  const robotLabelDivsRef = useRef<HTMLDivElement[]>([]);

  useEffect(() => {
    setIsMobile(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
  }, []);

  // Keep sellersRef in sync and update robot labels when data arrives
  useEffect(() => {
    if (sellers && sellers.length > 0) {
      sellersRef.current = sellers;
      // Update robot label texts dynamically
      const robots = buildRobots(sellers);
      robotLabelDivsRef.current.forEach((div, i) => {
        if (div && robots[i]) {
          div.textContent = robots[i].label;
        }
      });
    }
  }, [sellers]);

  useEffect(() => {
    if (!containerRef.current || isMobile) return;
    if (initializedRef.current) return;
    initializedRef.current = true;
    const container = containerRef.current;

    // Use fixed model list — robot labels are updated dynamically via sellersRef
    const ALL_MODELS = [...ANIMALS, ...DEFAULT_ROBOTS];

    // --- Renderer ---
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    // --- CSS2D Renderer (for labels + bubbles) ---
    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(container.clientWidth, container.clientHeight);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0';
    labelRenderer.domElement.style.pointerEvents = 'none';
    container.appendChild(labelRenderer.domElement);

    // --- Scene ---
    const scene = new THREE.Scene();

    // Sky gradient via background sphere
    const skyGeo = new THREE.SphereGeometry(500, 32, 15);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(0x87CEEB) },
        bottomColor: { value: new THREE.Color(0xE0F0FF) },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition).y;
          gl_FragColor = vec4(mix(bottomColor, topColor, max(h, 0.0)), 1.0);
        }
      `,
      side: THREE.BackSide,
    });
    scene.add(new THREE.Mesh(skyGeo, skyMat));

    // Fog to blend ground edges into sky
    scene.fog = new THREE.Fog(0xD5CCBC, 350, 600);

    // Ground plane — procedural terrain shader (dirt + patchy grass)
    const GROUND_Y = -0.5;
    const groundGeo = new THREE.CircleGeometry(500, 64);
    const groundMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      lights: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.lights,
        {
          dirtColor:  { value: new THREE.Color(0xb5a889) },
          grassColor: { value: new THREE.Color(0x7a9455) },
          dryColor:   { value: new THREE.Color(0xa89b6e) },
        },
      ]),
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 dirtColor;
        uniform vec3 grassColor;
        uniform vec3 dryColor;
        varying vec2 vUv;
        varying vec3 vWorldPos;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }
        float fbm(vec2 p) {
          float v = 0.0;
          v += 0.5 * noise(p); p *= 2.0;
          v += 0.25 * noise(p); p *= 2.0;
          v += 0.125 * noise(p);
          return v;
        }

        void main() {
          vec2 wp = vWorldPos.xz;
          float n = fbm(wp * 0.05);
          float detail = fbm(wp * 0.2);
          float grassMask = smoothstep(0.35, 0.55, n + detail * 0.2);

          vec3 base = mix(dirtColor, dryColor, detail);
          vec3 color = mix(base, grassColor, grassMask * 0.6);
          color *= 0.85 + 0.15 * noise(wp * 0.3);

          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = GROUND_Y;
    scene.add(ground);

    // --- Sky walls (4 sides) ---
    const WALL_SIZE = 300;
    const WALL_HEIGHT = 200;
    const wallGeo = new THREE.PlaneGeometry(WALL_SIZE * 2, WALL_HEIGHT);
    const wallMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      uniforms: {
        topColor: { value: new THREE.Color(0x87CEEB) },
        bottomColor: { value: new THREE.Color(0xD5CCBC) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        varying vec2 vUv;
        void main() {
          vec3 color = mix(bottomColor, topColor, vUv.y);
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    const wallFront = new THREE.Mesh(wallGeo, wallMat);
    wallFront.position.set(0, WALL_HEIGHT / 2 + GROUND_Y, WALL_SIZE);
    wallFront.rotation.y = Math.PI;
    scene.add(wallFront);
    const wallBack = new THREE.Mesh(wallGeo, wallMat);
    wallBack.position.set(0, WALL_HEIGHT / 2 + GROUND_Y, -WALL_SIZE);
    scene.add(wallBack);
    const wallLeft = new THREE.Mesh(wallGeo, wallMat);
    wallLeft.position.set(-WALL_SIZE, WALL_HEIGHT / 2 + GROUND_Y, 0);
    wallLeft.rotation.y = Math.PI / 2;
    scene.add(wallLeft);
    const wallRight = new THREE.Mesh(wallGeo, wallMat);
    wallRight.position.set(WALL_SIZE, WALL_HEIGHT / 2 + GROUND_Y, 0);
    wallRight.rotation.y = -Math.PI / 2;
    scene.add(wallRight);

    // --- Camera ---
    const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 1200);
    camera.position.set(0, 100, 220);
    camera.lookAt(0, 0, 20);

    // --- Orbit Controls ---
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, 10);
    controls.maxPolarAngle = Math.PI / 2.1;
    controls.maxDistance = 280;
    controls.minDistance = 30;

    // --- Lights ---
    scene.add(new THREE.AmbientLight(0xffffff, 1.0));
    const sunLight = new THREE.DirectionalLight(0xfffde8, 1.2);
    sunLight.position.set(50, 100, 50);
    scene.add(sunLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(-30, 40, -30);
    scene.add(fillLight);

    // --- State ---
    const mixers: THREE.AnimationMixer[] = [];
    const agentData: AgentState[] = [];
    let loaded = 0;
    const loader = new GLTFLoader();
    let spawnedCount = INITIAL_ANIMAL_COUNT;
    let spawnTimer = SPAWN_MIN_INTERVAL + Math.random() * (SPAWN_MAX_INTERVAL - SPAWN_MIN_INTERVAL);
    let interactionTimer = INTERACTION_MIN_INTERVAL + Math.random() * (INTERACTION_MAX_INTERVAL - INTERACTION_MIN_INTERVAL);

    // Track active CSS2D overlays for cleanup
    // delayFrames: count render frames before making visible (avoids top-left flash)
    const activeBubbles: { obj: CSS2DObject; div: HTMLDivElement; timer: number; anchor: THREE.Group; removeAnchor?: boolean; delayFrames: number; animClass: string }[] = [];

    // --- Helper: create query bubble ---
    function showQueryBubble(anchor: THREE.Group, text: string, yOffset: number) {
      const div = document.createElement('div');
      div.style.cssText = `
        background: rgba(255,255,255,0.95);
        color: #333;
        padding: 6px 12px;
        border-radius: 12px;
        font-size: 13px;
        font-weight: 600;
        white-space: nowrap;
        font-family: sans-serif;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        width: fit-content;
        visibility: hidden;
      `;
      div.textContent = text;
      const obj = new CSS2DObject(div);
      obj.position.set(0, yOffset + 5, 0);
      anchor.add(obj);
      activeBubbles.push({ obj, div, timer: 3.5, anchor, delayFrames: 3, animClass: 'popIn' });
    }

    // --- Helper: create $ symbol above a robot ---
    function showMoneySymbol(robotAgent: AgentState) {
      const div = document.createElement('div');
      div.style.cssText = `
        color: #22c55e;
        font-size: 28px;
        font-weight: 900;
        font-family: sans-serif;
        text-shadow: 0 0 8px rgba(34,197,94,0.5);
        width: fit-content;
        visibility: hidden;
      `;
      div.textContent = '$';
      const anchor = new THREE.Group();
      anchor.position.set(
        robotAgent.model.position.x,
        robotAgent.labelHeight + 5,
        robotAgent.model.position.z,
      );
      scene.add(anchor);
      const obj = new CSS2DObject(div);
      obj.position.set(0, 0, 0);
      anchor.add(obj);
      activeBubbles.push({ obj, div, timer: 2.5, anchor, removeAnchor: true, delayFrames: 3, animClass: 'floatUp' });
    }

    // --- Inject CSS animations ---
    // IMPORTANT: Cannot use 'transform' in keyframes because CSS2DRenderer
    // overwrites element.style.transform every frame for positioning.
    // Use individual CSS properties (scale, opacity) instead.
    const styleEl = document.createElement('style');
    styleEl.textContent = `
      @keyframes popIn {
        0% { scale: 0; opacity: 0; }
        60% { scale: 1.15; }
        100% { scale: 1; opacity: 1; }
      }
      @keyframes floatUp {
        0% { margin-top: 0; opacity: 1; }
        70% { opacity: 1; }
        100% { margin-top: -40px; opacity: 0; }
      }
      @keyframes cardSlideIn {
        0% { opacity: 0; transform: translateY(-10px); }
        100% { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(styleEl);

    // --- Load desk ---
    loader.load('/models/new_analityks_desk_tz_4/scene.gltf', (gltf) => {
      const desk = gltf.scene;

      desk.scale.set(60, 15, 40);
      desk.position.set(0, 0, 0);
      desk.updateMatrixWorld(true);
      const deskBox = new THREE.Box3().setFromObject(desk);
      desk.position.y = GROUND_Y - deskBox.min.y;
      scene.add(desk);
      loaded++;
      setLoadedCount(loaded);
    });

    // --- Load all models ---
    ALL_MODELS.forEach((model, modelIndex) => {
      const isAnimal = model.type === 'animal';
      const animalIndex = isAnimal ? modelIndex : -1;
      // Animals beyond initial count spawn from edge later
      const initiallyVisible = !isAnimal || animalIndex < INITIAL_ANIMAL_COUNT;
      const spawnFromEdge = isAnimal && animalIndex >= INITIAL_ANIMAL_COUNT;

      // Spawn position: initial animals use their preset pos, later ones enter from Z=160
      const spawnX = spawnFromEdge
        ? ROAM_MIN_X + Math.random() * (ROAM_MAX_X - ROAM_MIN_X)
        : model.pos[0];
      const spawnZ = spawnFromEdge ? 160 : model.pos[1];

      loader.load(model.path, (gltf) => {
        const modelScene = gltf.scene;

        // Hide Sketchfab UI icon meshes
        modelScene.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.computeBoundingBox();
            const meshBox = child.geometry.boundingBox;
            if (meshBox) {
              const center = new THREE.Vector3();
              meshBox.getCenter(center);
              if (Math.abs(center.x) > 5000 || Math.abs(center.y) > 5000 || Math.abs(center.z) > 5000) {
                child.visible = false;
              }
            }
          }
        });

        modelScene.scale.setScalar(model.scale);
        modelScene.position.set(spawnX, 0, spawnZ);

        modelScene.updateMatrixWorld(true);
        const box = new THREE.Box3();
        modelScene.traverse((child) => {
          if (child instanceof THREE.Mesh && child.visible) {
            box.union(new THREE.Box3().setFromObject(child));
          }
        });
        if (box.isEmpty()) box.setFromObject(modelScene);

        const yShift = GROUND_Y - box.min.y;
        modelScene.position.y = yShift;
        modelScene.updateMatrixWorld(true);

        const labelBox = new THREE.Box3();
        modelScene.traverse((child) => {
          if (child instanceof THREE.Mesh && child.visible) {
            labelBox.union(new THREE.Box3().setFromObject(child));
          }
        });
        if (labelBox.isEmpty()) labelBox.setFromObject(modelScene);
        const labelHeight = labelBox.max.y + 3;

        // Animation
        const mixer = new THREE.AnimationMixer(modelScene);
        mixers.push(mixer);
        const clips = gltf.animations;

        if (clips.length > 0) {
          if (model.id === 'robot2') {
            const action = mixer.clipAction(clips[0]);
            action.timeScale = 0.7;
            action.play();
          } else {
            mixer.clipAction(clips[0]).play();
          }
        }

        // Label anchor
        const labelAnchor = new THREE.Group();
        labelAnchor.position.set(spawnX, labelHeight, spawnZ);
        const div = document.createElement('div');

        if (isAnimal) {
          // Animals: completely invisible when roaming — no DOM element shown
          div.style.cssText = `display:none; font-family:sans-serif;`;
        } else {
          // Robots: always visible label, clickable
          div.style.cssText = `
            background: rgba(0,0,0,0.7);
            color: ${model.color};
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
            white-space: nowrap;
            border: 1px solid ${model.color};
            font-family: sans-serif;
            pointer-events: auto;
            cursor: pointer;
            transition: background 0.2s;
          `;
          const robotSlotIndex = modelIndex - ANIMALS.length;
          div.textContent = model.label;
          // Store ref for dynamic label updates
          robotLabelDivsRef.current[robotSlotIndex] = div;
          div.addEventListener('mouseenter', () => {
            div.style.background = 'rgba(0,0,0,0.9)';
          });
          div.addEventListener('mouseleave', () => {
            div.style.background = 'rgba(0,0,0,0.7)';
          });
          div.addEventListener('click', (e) => {
            e.stopPropagation();
            // Read latest sellers data from ref
            const currentSellers = sellersRef.current;
            const currentRobots = currentSellers.length > 0 ? buildRobots(currentSellers) : DEFAULT_ROBOTS;
            const robot = currentRobots[robotSlotIndex];
            const seller = currentSellers[robotSlotIndex];
            const info: RobotInfo = {
              label: robot?.label ?? model.label,
              description: robot?.description ?? model.description ?? '',
              category: robot?.category ?? model.category ?? '',
              price: robot?.price ?? model.price ?? '',
              wallet: seller?.wallet,
            };
            selectedRobotRef.current = info;
            setSelectedRobot(info);
          });
        }

        const label = new CSS2DObject(div);
        label.position.set(0, 0, 0);
        labelAnchor.add(label);
        scene.add(labelAnchor);

        // Hide non-spawned animals
        if (!initiallyVisible) {
          modelScene.visible = false;
          labelAnchor.visible = false;
        }

        scene.add(modelScene);

        if (model.type === 'robot') {
          modelScene.rotation.y = model.faceY ?? 0;
        } else {
          modelScene.rotation.y = Math.random() * Math.PI * 2;
        }

        agentData[modelIndex] = {
          mixer,
          model: modelScene,
          labelAnchor,
          labelDiv: div,
          labelHeight,
          type: model.type,
          modelIndex,
          spawned: initiallyVisible,
          direction: modelScene.rotation.y,
          targetX: spawnX + (Math.random() - 0.5) * 40,
          targetZ: (isAnimal ? ROAM_MIN_Z + Math.random() * (ROAM_MAX_Z - ROAM_MIN_Z) : spawnZ),
          stateTimer: 2 + Math.random() * 5,
          interactionState: 'roaming',
          interactionTarget: -1,
          interactionTimer: 0,
          homeX: spawnX,
          homeZ: isAnimal ? ROAM_MIN_Z + Math.random() * (ROAM_MAX_Z - ROAM_MIN_Z) : spawnZ,
          consumerId: '',
        };

        loaded++;
        setLoadedCount(loaded);
      });
    });

    // --- Get robot indices in agentData ---
    function getRobotIndices(): number[] {
      return agentData
        .filter(a => a && a.type === 'robot')
        .map(a => a.modelIndex);
    }

    // --- Get roaming animal indices ---
    function getRoamingAnimals(): number[] {
      return agentData
        .filter(a => a && a.type === 'animal' && a.spawned && a.interactionState === 'roaming')
        .map(a => a.modelIndex);
    }

    // --- Trigger interaction ---
    function triggerInteraction() {
      const roaming = getRoamingAnimals();
      const robots = getRobotIndices();
      if (roaming.length === 0 || robots.length === 0) return;

      const animalIdx = roaming[Math.floor(Math.random() * roaming.length)];
      const robotIdx = robots[Math.floor(Math.random() * robots.length)];
      const animal = agentData[animalIdx];
      if (!animal) return;

      // Generate consumer ID and show it with full styling
      animal.consumerId = generateConsumerId();
      animal.labelDiv.style.cssText = `
        background: rgba(0,0,0,0.7);
        color: #4a90e2;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
        white-space: nowrap;
        border: 1px solid #4a90e2;
        font-family: monospace;
        width: fit-content;
      `;
      animal.labelDiv.textContent = animal.consumerId;

      // Set target to approach robot
      const robot = agentData[robotIdx];
      if (!robot) return;
      animal.interactionState = 'approaching';
      animal.interactionTarget = robotIdx;
      // Approach: go to robot's X, but stop at Z = APPROACH_TARGET_Z
      animal.targetX = robot.model.position.x + (Math.random() - 0.5) * 20;
      animal.targetZ = APPROACH_TARGET_Z;
      animal.interactionTimer = 0;
    }

    // --- Animation loop ---
    const clock = new THREE.Clock();
    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      const delta = clock.getDelta();

      // --- Spawn timer: add animals over time ---
      if (spawnedCount < MAX_ANIMAL_COUNT) {
        spawnTimer -= delta;
        if (spawnTimer <= 0) {
          // Find next unspawned animal
          for (let i = 0; i < ANIMALS.length; i++) {
            const agent = agentData[i];
            if (agent && !agent.spawned) {
              agent.spawned = true;
              agent.model.visible = true;
              agent.labelAnchor.visible = true;
              spawnedCount++;
              break;
            }
          }
          spawnTimer = SPAWN_MIN_INTERVAL + Math.random() * (SPAWN_MAX_INTERVAL - SPAWN_MIN_INTERVAL);
        }
      }

      // --- Interaction timer: trigger new interactions ---
      interactionTimer -= delta;
      if (interactionTimer <= 0) {
        triggerInteraction();
        interactionTimer = INTERACTION_MIN_INTERVAL + Math.random() * (INTERACTION_MAX_INTERVAL - INTERACTION_MIN_INTERVAL);
      }

      // --- Update bubble lifetime (cleanup only; visibility handled after render) ---
      for (let i = activeBubbles.length - 1; i >= 0; i--) {
        const b = activeBubbles[i];
        if (b.delayFrames > 0) continue; // still waiting for render positioning
        b.timer -= delta;
        if (b.timer <= 0) {
          b.anchor.remove(b.obj);
          if (b.removeAnchor) scene.remove(b.anchor);
          activeBubbles.splice(i, 1);
        }
      }

      // --- Update agents ---
      agentData.forEach((agent) => {
        if (!agent || !agent.spawned) return;

        if (agent.type === 'animal') {
          switch (agent.interactionState) {
            case 'roaming': {
              // Normal roaming — no label, avoid desk
              const dx = agent.targetX - agent.model.position.x;
              const dz = agent.targetZ - agent.model.position.z;
              const dist = Math.sqrt(dx * dx + dz * dz);

              if (dist < 2) {
                agent.stateTimer -= delta;
                if (agent.stateTimer <= 0) {
                  agent.targetX = ROAM_MIN_X + Math.random() * (ROAM_MAX_X - ROAM_MIN_X);
                  agent.targetZ = ROAM_MIN_Z + Math.random() * (ROAM_MAX_Z - ROAM_MIN_Z);
                  agent.stateTimer = 3 + Math.random() * 6;
                }
              } else {
                const moveSpeed = ROAM_SPEED * delta;
                const step = Math.min(moveSpeed, dist);
                agent.model.position.x += (dx / dist) * step;
                agent.model.position.z += (dz / dist) * step;

                // Clamp Z to stay out of desk zone
                if (agent.model.position.z < DESK_FRONT_Z) {
                  agent.model.position.z = DESK_FRONT_Z;
                }

                const targetAngle = Math.atan2(dx, dz);
                let angleDiff = targetAngle - agent.model.rotation.y;
                while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                agent.model.rotation.y += angleDiff * Math.min(delta * 3, 1);
              }
              break;
            }

            case 'approaching': {
              // Run toward robot's desk area — stop in front of desk
              const dx = agent.targetX - agent.model.position.x;
              const dz = agent.targetZ - agent.model.position.z;
              const dist = Math.sqrt(dx * dx + dz * dz);

              if (dist < 3) {
                // Arrived — show query bubble with product-specific keywords
                agent.interactionState = 'querying';
                agent.interactionTimer = 3.0 + Math.random() * 2.0; // 3-5s
                const targetRobot = agentData[agent.interactionTarget];
                const robotSlot = targetRobot ? targetRobot.modelIndex - ANIMALS.length : -1;
                // Read latest sellers to get real product keywords
                const currentSellers = sellersRef.current;
                const currentRobots = currentSellers.length > 0 ? buildRobots(currentSellers) : DEFAULT_ROBOTS;
                const robotInfo = robotSlot >= 0 ? currentRobots[robotSlot] : null;
                const keywords = robotInfo?.keywords && robotInfo.keywords.length > 0
                  ? robotInfo.keywords
                  : FALLBACK_KEYWORDS;
                const keyword = keywords[Math.floor(Math.random() * keywords.length)];
                showQueryBubble(agent.labelAnchor, keyword, 5);
              } else {
                const step = Math.min(APPROACH_SPEED * delta, dist);
                agent.model.position.x += (dx / dist) * step;
                agent.model.position.z += (dz / dist) * step;

                // Clamp — never enter desk zone
                if (agent.model.position.z < DESK_FRONT_Z) {
                  agent.model.position.z = DESK_FRONT_Z;
                }

                const targetAngle = Math.atan2(dx, dz);
                let angleDiff = targetAngle - agent.model.rotation.y;
                while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                agent.model.rotation.y += angleDiff * Math.min(delta * 5, 1);
              }
              break;
            }

            case 'querying': {
              // Wait for bubble to show
              agent.interactionTimer -= delta;
              if (agent.interactionTimer <= 0) {
                agent.interactionState = 'response';
                agent.interactionTimer = 3.0 + Math.random() * 3.0; // 3-6s linger
                // 20% chance to show $ on the robot
                if (Math.random() < MONEY_CHANCE) {
                  const robot = agentData[agent.interactionTarget];
                  if (robot) {
                    showMoneySymbol(robot);
                  }
                }
              }
              break;
            }

            case 'response': {
              // Wait for response/money animation
              agent.interactionTimer -= delta;
              if (agent.interactionTimer <= 0) {
                // Depart: hide consumer ID completely, head back to roaming area
                agent.interactionState = 'departing';
                agent.labelDiv.style.cssText = 'display:none; font-family:sans-serif;';
                agent.labelDiv.textContent = '';
                agent.consumerId = '';
                agent.targetX = ROAM_MIN_X + Math.random() * (ROAM_MAX_X - ROAM_MIN_X);
                agent.targetZ = ROAM_MIN_Z + Math.random() * (ROAM_MAX_Z - ROAM_MIN_Z);
              }
              break;
            }

            case 'departing': {
              // Run back to roaming area — avoid desk
              const dx = agent.targetX - agent.model.position.x;
              const dz = agent.targetZ - agent.model.position.z;
              const dist = Math.sqrt(dx * dx + dz * dz);

              if (dist < 3) {
                agent.interactionState = 'roaming';
                agent.interactionTarget = -1;
                agent.stateTimer = 3 + Math.random() * 6;
              } else {
                const step = Math.min(APPROACH_SPEED * delta, dist);
                agent.model.position.x += (dx / dist) * step;
                agent.model.position.z += (dz / dist) * step;

                // Don't cut through desk — clamp Z
                if (agent.model.position.z < DESK_FRONT_Z) {
                  agent.model.position.z = DESK_FRONT_Z;
                }

                const targetAngle = Math.atan2(dx, dz);
                let angleDiff = targetAngle - agent.model.rotation.y;
                while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                agent.model.rotation.y += angleDiff * Math.min(delta * 5, 1);
              }
              break;
            }
          }

          // Update label position to follow animal
          agent.labelAnchor.position.set(
            agent.model.position.x,
            agent.labelHeight,
            agent.model.position.z,
          );
        }
        // Robots: no movement
      });

      mixers.forEach((m) => m.update(delta));
      controls.update();
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);

      // --- After render: make delayed bubbles visible (CSS2DRenderer has now positioned them) ---
      for (const b of activeBubbles) {
        if (b.delayFrames > 0) {
          b.delayFrames--;
          if (b.delayFrames === 0) {
            b.div.style.visibility = 'visible';
            b.div.style.animation = `${b.animClass} ${b.animClass === 'popIn' ? '0.3s' : '2s'} ease-out ${b.animClass === 'floatUp' ? 'forwards' : ''}`;
          }
        }
      }
    };
    animate();

    // --- Resize ---
    const onResize = () => {
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
      labelRenderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      mixers.forEach(m => m.stopAllAction());
      while (scene.children.length > 0) scene.remove(scene.children[0]);
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      if (container.contains(labelRenderer.domElement)) container.removeChild(labelRenderer.domElement);
      if (document.head.contains(styleEl)) document.head.removeChild(styleEl);
      initializedRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

  if (isMobile) {
    return (
      <div className="w-full h-full bg-gradient-to-b from-gray-900 to-gray-800 flex items-center justify-center">
        <p className="text-gray-400">3D visualization optimized for desktop</p>
      </div>
    );
  }

  const categoryColors: Record<string, string> = {
    search: '#3b82f6',
    translation: '#8b5cf6',
    analytics: '#ef4444',
    physical: '#f59e0b',
    digital: '#3b82f6',
    agent: '#6b7280',
    vacant: '#374151',
  };

  return (
    <div className="relative w-full h-full">
      {loadedCount < ANIMALS.length + ROBOT_TEMPLATES.length + 1 && (
        <div className="absolute top-4 right-4 bg-black/70 text-white px-4 py-2 rounded-lg text-sm z-10">
          Loading: {loadedCount}/{ANIMALS.length + ROBOT_TEMPLATES.length + 1}
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />

      {/* Robot info card */}
      {selectedRobot && (
        <div className="absolute top-4 right-4 z-20 w-72">
          <div
            style={{
              background: 'rgba(15, 15, 25, 0.92)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '12px',
              padding: '20px',
              color: '#fff',
              fontFamily: 'sans-serif',
              animation: 'cardSlideIn 0.25s ease-out',
            }}
          >
            <button
              onClick={() => setSelectedRobot(null)}
              style={{
                position: 'absolute',
                top: '12px',
                right: '14px',
                background: 'none',
                border: 'none',
                color: 'rgba(255,255,255,0.5)',
                fontSize: '18px',
                cursor: 'pointer',
                lineHeight: 1,
                padding: '4px',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; }}
            >
              ✕
            </button>

            {/* Seller address */}
            {selectedRobot.wallet && (
              <div style={{ fontSize: '11px', fontFamily: 'monospace', color: 'rgba(255,255,255,0.4)', marginBottom: '8px' }}>
                {selectedRobot.wallet}
              </div>
            )}

            <div style={{ fontSize: '16px', fontWeight: 700, marginBottom: '8px' }}>
              {selectedRobot.label}
            </div>

            <span
              style={{
                display: 'inline-block',
                background: categoryColors[selectedRobot.category] ?? '#666',
                color: '#fff',
                padding: '2px 10px',
                borderRadius: '9999px',
                fontSize: '11px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '12px',
              }}
            >
              {selectedRobot.category}
            </span>

            <p style={{ fontSize: '13px', lineHeight: 1.5, color: 'rgba(255,255,255,0.75)', margin: '12px 0' }}>
              {selectedRobot.description}
            </p>

            {selectedRobot.price && (
              <div
                style={{
                  borderTop: '1px solid rgba(255,255,255,0.1)',
                  paddingTop: '12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.45)' }}>Price</span>
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#22c55e' }}>{selectedRobot.price}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
