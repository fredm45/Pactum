# Draco Decoder Setup

The Draco decoder is required to load compressed GLB models.

## Option 1: Use CDN (Recommended for now)

Update the modelLoader.ts to use CDN path:

```typescript
const dracoPath = 'https://www.gstatic.com/draco/versioned/decoders/1.5.6/';
```

This is already configured as a fallback in the code.

## Option 2: Copy from node_modules after installing three

After running `npm install` in the frontend directory:

```bash
# Find three.js directory
cd packages/frontend

# Copy decoder files (adjust path based on your three version)
cp -r node_modules/three/examples/jsm/libs/draco/gltf/* public/draco/

# Or use the draco3d package
# (The draco3d package is mainly for compression, not for the decoder)
```

## Option 3: Download Manually

Download from the official Draco repository:

```bash
# Clone the repo
git clone https://github.com/google/draco.git /tmp/draco

# Copy decoder files
cp /tmp/draco/javascript/draco_decoder.js public/draco/
cp /tmp/draco/javascript/draco_decoder.wasm public/draco/
cp /tmp/draco/javascript/draco_wasm_wrapper.js public/draco/
```

## Current Status

The code is configured to use the Google CDN as a fallback, so the 3D scene should work without local decoder files.

For production, it's recommended to host the decoder files locally for better performance and reliability.

## Verification

To verify the decoder is working:
1. Open browser console
2. Look for "[ModelLoader] Loading..." messages
3. Check for any Draco-related errors
4. If using CDN, you should see requests to gstatic.com
