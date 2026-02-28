/**
 * split-animals.mjs
 *
 * Splits the packed "Quirky Series - Free Animals Pack" GLTF into 8 individual
 * GLB files, one per animal. Each GLB contains only that animal's mesh, skeleton,
 * skin, material, texture, and animation channels.
 *
 * Usage: node scripts/split-animals.mjs
 * Output: public/models/animals/<name>.glb
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.join(__dirname, '..', 'public', 'models');
const SRC_DIR = path.join(MODELS_DIR, 'quirky_series_-_free_animals_pack');
const OUT_DIR = path.join(MODELS_DIR, 'animals');

// ── Animal definitions ─────────────────────────────────────────────────
// rigNode: the top-level Rig node index in the original GLTF
const ANIMALS = [
  { name: 'sparrow',  rigNode: 4   },
  { name: 'gecko',    rigNode: 20  },
  { name: 'herring',  rigNode: 34  },
  { name: 'taipan',   rigNode: 49  },
  { name: 'muskrat',  rigNode: 63  },
  { name: 'pudu',     rigNode: 79  },
  { name: 'colobus',  rigNode: 94  },
  { name: 'inkfish',  rigNode: 110 },
];

// ── Load source GLTF + binary buffer ───────────────────────────────────
console.log('Loading source GLTF...');
const gltf = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'scene.gltf'), 'utf-8'));
const binBuffer = fs.readFileSync(path.join(SRC_DIR, 'scene.bin'));

// Load all texture images into memory
const imageBuffers = gltf.images.map(img => {
  return fs.readFileSync(path.join(SRC_DIR, img.uri));
});

fs.mkdirSync(OUT_DIR, { recursive: true });

// ── Helpers ─────────────────────────────────────────────────────────────

/** Collect all descendant node indices (inclusive) for a subtree. */
function collectDescendants(nodeIdx) {
  const result = [nodeIdx];
  const n = gltf.nodes[nodeIdx];
  if (n.children) {
    for (const c of n.children) {
      result.push(...collectDescendants(c));
    }
  }
  return result;
}

/**
 * Build a GLB file from a new GLTF JSON object and a combined binary buffer.
 * GLB format: 12-byte header + JSON chunk + BIN chunk
 */
function buildGLB(json, bin) {
  const jsonStr = JSON.stringify(json);
  // JSON chunk must be padded to 4-byte alignment with spaces (0x20)
  const jsonPadded = jsonStr + ' '.repeat((4 - (jsonStr.length % 4)) % 4);
  const jsonBuf = Buffer.from(jsonPadded, 'utf-8');
  // BIN chunk must be padded to 4-byte alignment with zeros
  const binPadLen = (4 - (bin.length % 4)) % 4;
  const binPadded = Buffer.concat([bin, Buffer.alloc(binPadLen)]);

  const totalLength = 12 + 8 + jsonBuf.length + 8 + binPadded.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546C67, 0); // magic: "glTF"
  header.writeUInt32LE(2, 4);          // version: 2
  header.writeUInt32LE(totalLength, 8);

  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonChunkHeader.writeUInt32LE(0x4E4F534A, 4); // type: "JSON"

  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(binPadded.length, 0);
  binChunkHeader.writeUInt32LE(0x004E4942, 4);  // type: "BIN\0"

  return Buffer.concat([header, jsonChunkHeader, jsonBuf, binChunkHeader, binPadded]);
}

// ── Process each animal ────────────────────────────────────────────────

for (const animal of ANIMALS) {
  console.log(`\nProcessing ${animal.name}...`);

  const rigDescendants = collectDescendants(animal.rigNode);
  const rigDescSet = new Set(rigDescendants);

  // Find the mesh node within this rig subtree
  let meshNodeIdx = null;
  let meshIdx = null;
  let skinIdx = null;
  for (const d of rigDescendants) {
    const n = gltf.nodes[d];
    if (n.mesh !== undefined) {
      meshNodeIdx = d;
      meshIdx = n.mesh;
      skinIdx = n.skin;
      break;
    }
  }

  if (meshIdx === null) {
    console.log(`  WARNING: No mesh found for ${animal.name}, skipping`);
    continue;
  }

  const mesh = gltf.meshes[meshIdx];
  const materialIdx = mesh.primitives[0].material;
  const material = gltf.materials[materialIdx];

  console.log(`  Mesh: ${meshIdx}, Skin: ${skinIdx}, Material: ${materialIdx} (${material.name})`);

  // ── Collect needed accessors ──
  // We need: mesh primitive accessors, skin IBM accessor, animation sampler accessors
  const neededAccessors = new Set();
  const neededImages = new Set();

  // Mesh primitive accessors
  for (const prim of mesh.primitives) {
    for (const attrAcc of Object.values(prim.attributes)) {
      neededAccessors.add(attrAcc);
    }
    if (prim.indices !== undefined) neededAccessors.add(prim.indices);
    // Morph targets
    if (prim.targets) {
      for (const target of prim.targets) {
        for (const acc of Object.values(target)) {
          neededAccessors.add(acc);
        }
      }
    }
  }

  // Skin inverse bind matrices
  const skin = gltf.skins[skinIdx];
  if (skin.inverseBindMatrices !== undefined) {
    neededAccessors.add(skin.inverseBindMatrices);
  }

  // Animation channels targeting nodes in this rig
  const anim = gltf.animations[0];
  const relevantChannels = [];
  const relevantSamplerIndices = new Set();
  for (const ch of anim.channels) {
    if (rigDescSet.has(ch.target.node)) {
      relevantChannels.push(ch);
      relevantSamplerIndices.add(ch.sampler);
    }
  }

  for (const si of relevantSamplerIndices) {
    const sampler = anim.samplers[si];
    neededAccessors.add(sampler.input);
    neededAccessors.add(sampler.output);
  }

  console.log(`  Accessors: ${neededAccessors.size}, Anim channels: ${relevantChannels.length}`);

  // ── Collect material textures/images ──
  const textureIdx = material.pbrMetallicRoughness?.baseColorTexture?.index;
  let imageIdx = null;
  if (textureIdx !== undefined) {
    imageIdx = gltf.textures[textureIdx].source;
    neededImages.add(imageIdx);
  }

  // ── Build accessor → new index mapping ──
  const sortedAccessors = [...neededAccessors].sort((a, b) => a - b);
  const accMap = new Map();
  sortedAccessors.forEach((oldIdx, newIdx) => accMap.set(oldIdx, newIdx));

  // ── Build node mapping ──
  // We need to include:
  // 1. A scene root node (we'll use the Rig node as the scene root)
  // 2. All descendants of the rig
  // We'll also need to include the Sketchfab_model → fbx → Object_2 → RootNode hierarchy
  // Actually, let's keep it simple: put just the Rig node and its subtree.
  // But the Rig node itself at the top level as the single scene root.

  const sortedNodes = [...rigDescendants].sort((a, b) => a - b);
  const nodeMap = new Map();
  sortedNodes.forEach((oldIdx, newIdx) => nodeMap.set(oldIdx, newIdx));

  // ── Build new bufferViews + binary data ──
  // Instead of trying to share bufferViews (which have byteStride), we create
  // one new bufferView per accessor approach. But we need to respect bufferView
  // sharing (multiple accessors can share one bufferView with different byteOffsets).
  //
  // Strategy: group accessors by their bufferView. For each group, copy the
  // bufferView data once, and adjust accessor byteOffsets relative to the new BV.

  const bvGroups = new Map(); // oldBvIdx -> [oldAccIdx, ...]
  for (const accIdx of sortedAccessors) {
    const acc = gltf.accessors[accIdx];
    const bvIdx = acc.bufferView;
    if (!bvGroups.has(bvIdx)) bvGroups.set(bvIdx, []);
    bvGroups.get(bvIdx).push(accIdx);
  }

  const newBufferViews = [];
  const bvMap = new Map(); // oldBvIdx -> newBvIdx
  const binaryChunks = [];
  let currentOffset = 0;

  // Sort bufferView groups by original index for determinism
  const sortedBvGroups = [...bvGroups.entries()].sort((a, b) => a[0] - b[0]);

  for (const [oldBvIdx, accIndices] of sortedBvGroups) {
    const oldBv = gltf.bufferViews[oldBvIdx];

    // Compute the minimal byte range needed for the accessors in this group
    const componentSizes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
    const typeCounts = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

    let minOffset = Infinity;
    let maxEnd = 0;

    for (const accIdx of accIndices) {
      const acc = gltf.accessors[accIdx];
      const accByteOffset = acc.byteOffset || 0;
      const componentSize = componentSizes[acc.componentType];
      const typeCount = typeCounts[acc.type];

      let accByteLength;
      if (oldBv.byteStride) {
        // Interleaved: last element starts at offset + (count-1)*stride, plus one element size
        accByteLength = (acc.count - 1) * oldBv.byteStride + typeCount * componentSize;
      } else {
        accByteLength = acc.count * typeCount * componentSize;
      }

      minOffset = Math.min(minOffset, accByteOffset);
      maxEnd = Math.max(maxEnd, accByteOffset + accByteLength);
    }

    // Copy the byte range from the original buffer
    const bvBaseOffset = oldBv.byteOffset || 0;
    const srcStart = bvBaseOffset + minOffset;
    const srcEnd = bvBaseOffset + maxEnd;
    const data = binBuffer.subarray(srcStart, srcEnd);

    // Pad to 4-byte alignment
    const padLen = (4 - (currentOffset % 4)) % 4;
    if (padLen > 0) {
      binaryChunks.push(Buffer.alloc(padLen));
      currentOffset += padLen;
    }

    const newBv = {
      buffer: 0,
      byteOffset: currentOffset,
      byteLength: data.length,
    };
    if (oldBv.byteStride) newBv.byteStride = oldBv.byteStride;
    if (oldBv.target) newBv.target = oldBv.target;

    bvMap.set(oldBvIdx, { newBvIdx: newBufferViews.length, offsetAdjust: minOffset });
    newBufferViews.push(newBv);
    binaryChunks.push(Buffer.from(data)); // copy
    currentOffset += data.length;
  }

  // ── Build new accessors ──
  const newAccessors = sortedAccessors.map(oldIdx => {
    const acc = { ...gltf.accessors[oldIdx] };
    const bvInfo = bvMap.get(acc.bufferView);
    acc.bufferView = bvInfo.newBvIdx;
    // Adjust byteOffset relative to the slice we took
    const oldByteOffset = acc.byteOffset || 0;
    const adjustedOffset = oldByteOffset - bvInfo.offsetAdjust;
    if (adjustedOffset > 0) {
      acc.byteOffset = adjustedOffset;
    } else {
      delete acc.byteOffset;
    }
    return acc;
  });

  // ── Build new nodes ──
  const newNodes = sortedNodes.map(oldIdx => {
    const node = { ...gltf.nodes[oldIdx] };
    // Remap children
    if (node.children) {
      node.children = node.children
        .filter(c => nodeMap.has(c))
        .map(c => nodeMap.get(c));
      if (node.children.length === 0) delete node.children;
    }
    // Remap mesh
    if (node.mesh !== undefined) {
      node.mesh = 0; // we only have one mesh
    }
    // Remap skin
    if (node.skin !== undefined) {
      node.skin = 0; // we only have one skin
    }
    return node;
  });

  // ── Build new mesh ──
  const newMesh = JSON.parse(JSON.stringify(mesh));
  for (const prim of newMesh.primitives) {
    for (const [attr, accIdx] of Object.entries(prim.attributes)) {
      prim.attributes[attr] = accMap.get(accIdx);
    }
    if (prim.indices !== undefined) {
      prim.indices = accMap.get(prim.indices);
    }
    prim.material = 0; // single material
    if (prim.targets) {
      for (const target of prim.targets) {
        for (const [attr, accIdx] of Object.entries(target)) {
          target[attr] = accMap.get(accIdx);
        }
      }
    }
  }

  // ── Build new skin ──
  const newSkin = {
    joints: skin.joints.map(j => nodeMap.get(j)),
  };
  if (skin.skeleton !== undefined) {
    newSkin.skeleton = nodeMap.get(skin.skeleton);
  }
  if (skin.inverseBindMatrices !== undefined) {
    newSkin.inverseBindMatrices = accMap.get(skin.inverseBindMatrices);
  }
  if (skin.name) newSkin.name = skin.name;

  // ── Build new animation ──
  // Remap sampler indices
  const sortedSamplerIndices = [...relevantSamplerIndices].sort((a, b) => a - b);
  const samplerMap = new Map();
  sortedSamplerIndices.forEach((oldIdx, newIdx) => samplerMap.set(oldIdx, newIdx));

  const newSamplers = sortedSamplerIndices.map(oldIdx => {
    const s = gltf.animations[0].samplers[oldIdx];
    return {
      input: accMap.get(s.input),
      output: accMap.get(s.output),
      interpolation: s.interpolation,
    };
  });

  const newChannels = relevantChannels.map(ch => ({
    sampler: samplerMap.get(ch.sampler),
    target: {
      node: nodeMap.get(ch.target.node),
      path: ch.target.path,
    },
  }));

  const newAnimation = {
    name: animal.name,
    channels: newChannels,
    samplers: newSamplers,
  };

  // ── Build new material ──
  const newMaterial = JSON.parse(JSON.stringify(material));
  // Remap texture index to 0
  if (newMaterial.pbrMetallicRoughness?.baseColorTexture) {
    newMaterial.pbrMetallicRoughness.baseColorTexture.index = 0;
  }

  // ── Build new texture ──
  const newTexture = { source: 0 };
  if (gltf.textures[textureIdx]?.sampler !== undefined) {
    newTexture.sampler = 0;
  }

  // ── Build new image (embedded in GLB as bufferView) ──
  const imgData = imageBuffers[imageIdx];
  // Pad binary to 4 bytes before adding image
  const imgPadLen = (4 - (currentOffset % 4)) % 4;
  if (imgPadLen > 0) {
    binaryChunks.push(Buffer.alloc(imgPadLen));
    currentOffset += imgPadLen;
  }

  const imgBvIdx = newBufferViews.length;
  newBufferViews.push({
    buffer: 0,
    byteOffset: currentOffset,
    byteLength: imgData.length,
  });
  binaryChunks.push(imgData);
  currentOffset += imgData.length;

  const newImage = {
    mimeType: 'image/png',
    bufferView: imgBvIdx,
  };

  // ── Build new sampler ──
  const newTexSampler = gltf.samplers ? { ...gltf.samplers[0] } : {};

  // ── Assemble final GLTF JSON ──
  const newGltf = {
    asset: { version: '2.0', generator: 'split-animals.mjs' },
    scene: 0,
    scenes: [{ name: animal.name, nodes: [0] }], // root is the Rig node (index 0)
    nodes: newNodes,
    meshes: [newMesh],
    skins: [newSkin],
    animations: [newAnimation],
    materials: [newMaterial],
    textures: [newTexture],
    images: [newImage],
    samplers: [newTexSampler],
    accessors: newAccessors,
    bufferViews: newBufferViews,
    buffers: [{ byteLength: currentOffset }],
  };

  // Combine binary chunks
  const combinedBin = Buffer.concat(binaryChunks);

  // Build and write GLB
  const glb = buildGLB(newGltf, combinedBin);
  const outPath = path.join(OUT_DIR, `${animal.name}.glb`);
  fs.writeFileSync(outPath, glb);
  const sizeMB = (glb.length / (1024 * 1024)).toFixed(2);
  console.log(`  Written: ${outPath} (${sizeMB} MB)`);
}

console.log('\nDone! All 8 animals exported.');
