# 3D Agent Visualization Setup Guide

## Overview

The 3D agent visualization is now integrated into the Pactum homepage. This guide covers setup, testing, and troubleshooting.

## Implementation Status

### ✅ Completed

- [x] Three.js scene manager with performance optimizations
- [x] Model loader with Draco compression support and caching
- [x] Animation controller with state machine
- [x] React components (Agent3DScene, Agent3DCharacter)
- [x] Homepage integration with dynamic import
- [x] Real-time data polling (3-second interval)
- [x] Mobile responsive (2D fallback)
- [x] TypeScript types and error handling
- [x] Build successful

### ⚠️ Pending

- [ ] Download actual 3D models (buyer.glb, seller.glb)
- [ ] Test with real agent data
- [ ] Performance testing and optimization
- [ ] Add Agent type field to database (optional)

## Quick Start

### 1. Start Development Server

```bash
cd packages/frontend
npm run dev
```

Visit http://localhost:3000

### 2. Expected Behavior (Without Models)

Without 3D models, you'll see:
- Loading screen
- Error messages in console: "Failed to load /models/buyer.glb"
- Mobile users see 2D fallback grid

This is normal! Continue to step 3 to add models.

### 3. Add 3D Models

**CRITICAL**: The visualization requires 3D models to work.

#### Quick Option: Use Sample Models

Download sample GLB models:
1. Visit: https://github.com/KhronosGroup/glTF-Sample-Models/tree/master/2.0
2. Download any animated model (e.g., `RobotExpressive`)
3. Rename to `buyer.glb` and `seller.glb`
4. Place in `packages/frontend/public/models/`

#### Recommended: Custom Models

See `public/models/README.md` for detailed instructions:
- Where to find models (Sketchfab, Mixamo)
- Model requirements (< 2MB, < 10K polygons)
- Compression instructions
- Animation naming conventions

### 4. Verify Models

```bash
# Check files exist
ls -lh packages/frontend/public/models/

# Should show:
# buyer.glb
# seller.glb
```

### 5. Test in Browser

1. Open http://localhost:3000
2. Open browser console (F12)
3. Look for:
   - `[ModelLoader] Loading /models/buyer.glb`
   - `[ModelLoader] Loaded /models/buyer.glb in XXXms`
   - `[SceneManager] Average FPS: XX.X`

## Architecture

### Directory Structure

```
packages/frontend/
├── lib/3d/
│   ├── sceneManager.ts          # Three.js scene initialization
│   ├── modelLoader.ts           # GLB loading with caching
│   └── animationController.ts   # Animation state machine
├── components/visualization/
│   ├── Agent3DScene.tsx         # Main 3D scene component
│   └── Agent3DCharacter.tsx     # Individual agent renderer
└── public/
    ├── models/                  # GLB model files
    │   ├── buyer.glb
    │   └── seller.glb
    └── draco/                   # Draco decoder (optional)
```

### Data Flow

```
Registry API (polling every 3s)
  ↓
React Query Cache
  ↓
Agent3DScene (detect changes)
  ↓
Agent3DCharacter (render + animate)
  ↓
Three.js Scene (60 FPS)
```

### Animation States

- **idle**: Default waiting state
- **paying**: Buyer making payment (triggered on total_reviews increase)
- **working**: Seller processing task (triggered on avg_rating change)
- **celebrating**: Transaction complete (triggered on new review)

## Performance Optimizations

### Implemented

1. **Model Loading**
   - Object pooling (reuse models)
   - Draco compression (70% file size reduction)
   - Progressive loading (200ms intervals)
   - Caching (load once, clone many)

2. **Rendering**
   - Limited to 10 agents max
   - Frustum culling (auto by Three.js)
   - Pixel ratio capped at 2x
   - Animation limiting (max 3 simultaneous)

3. **React**
   - useMemo for agent processing
   - useCallback for handlers
   - Dynamic import (no SSR)
   - Throttled updates

4. **Mobile**
   - Device detection
   - 2D fallback for mobile
   - Disabled antialias on mobile

### Performance Targets

- **FPS**: 60 (monitored in console)
- **Load Time**: < 2s for initial render
- **Memory**: < 200MB
- **Model Size**: < 1MB per GLB (after compression)

### Monitoring

Check browser console for:
```
[SceneManager] Average FPS: 60.0
[ModelLoader] Loaded /models/buyer.glb in 450ms
[ModelLoader] Preloaded all models in 920ms
[AnimationController] Max simultaneous animations reached
```

## Troubleshooting

### Models Not Loading

**Error**: `Failed to fetch /models/buyer.glb`

**Solutions**:
1. Verify files exist: `ls public/models/`
2. Check file names exactly match: `buyer.glb`, `seller.glb`
3. Restart dev server: `npm run dev`
4. Check browser network tab for 404 errors

### Low FPS (< 30)

**Symptoms**: Choppy animation, console shows low FPS

**Solutions**:
1. Reduce model poly count (use gltf-pipeline)
2. Limit agents: Edit `MAX_AGENTS` in `Agent3DScene.tsx`
3. Disable shadows: Set `enableShadows: false` in sceneManager config
4. Compress textures: Use 512x512 instead of 2K/4K

### TypeScript Errors

**Error**: Type mismatches

**Solutions**:
1. Run: `npm run build` to check for errors
2. Update types in `lib/api.ts` if Agent interface changes
3. Check import paths use `@/` alias

### Animations Not Playing

**Symptoms**: Models load but don't animate

**Solutions**:
1. Check animation names in GLB match expected names:
   - `idle`, `paying`, `working`, `celebrating`
2. Edit mapping in `lib/3d/animationController.ts` (line 58-64)
3. Use Three.js Editor to inspect GLB: https://threejs.org/editor/

### Mobile Not Showing 2D Fallback

**Symptoms**: Blank screen on mobile

**Solutions**:
1. Check `isMobile` detection in `Agent3DScene.tsx`
2. Verify browser console for errors
3. Test responsive design at different widths

## Testing Checklist

### Desktop Testing

- [ ] Homepage loads without errors
- [ ] 3D scene renders in hero section
- [ ] Models load progressively (check console)
- [ ] FPS stays at 60 (check console)
- [ ] Camera controls work (mouse drag, zoom)
- [ ] Agent labels appear on hover
- [ ] Data refreshes every 3 seconds

### Mobile Testing

- [ ] 2D fallback grid displays
- [ ] Agent cards show name and state
- [ ] No console errors
- [ ] Page loads quickly

### Performance Testing

```bash
# Run Lighthouse audit
npm run build
npm start
# Open Chrome DevTools > Lighthouse > Run audit
```

**Target Scores**:
- Performance: > 80
- Accessibility: > 90
- Best Practices: > 90

### Load Testing

```bash
# Simulate multiple agents
# Edit MAX_AGENTS in Agent3DScene.tsx to test scaling
```

## Configuration

### Adjust Agent Limit

Edit `packages/frontend/components/visualization/Agent3DScene.tsx`:

```typescript
const MAX_AGENTS = 10; // Change to desired limit
```

### Adjust Polling Interval

```typescript
const POLL_INTERVAL = 3000; // Change to desired ms
```

### Disable 3D Scene (Temporary)

Edit `packages/frontend/app/page.tsx`:

```typescript
// Comment out the 3D section:
{/* <section className="w-full h-[60vh]...">
  <Agent3DScene />
</section> */}
```

### Change Camera Settings

Edit `packages/frontend/lib/3d/sceneManager.ts`:

```typescript
this.camera.position.set(0, 15, 30); // Adjust camera position
this.controls.minDistance = 10;      // Adjust zoom limits
this.controls.maxDistance = 50;
```

## Adding Agent Type Field (Optional)

Currently, agent type (buyer/seller) is inferred from category.

To add explicit `type` field:

### 1. Update Database Schema

```sql
-- In Supabase SQL editor
ALTER TABLE agents
ADD COLUMN type TEXT DEFAULT 'seller'
CHECK (type IN ('buyer', 'seller'));
```

### 2. Update TypeScript Types

Edit `packages/frontend/lib/api.ts`:

```typescript
export interface Agent {
  agent_id: string
  name: string
  type?: 'buyer' | 'seller'  // Add this
  // ... rest of fields
}
```

### 3. Update Inference Logic

Edit `packages/frontend/components/visualization/Agent3DScene.tsx`:

```typescript
function inferAgentType(agent: Agent): AgentType {
  // Use explicit type if available
  if (agent.type) {
    return agent.type;
  }

  // Fallback to category inference
  // ... existing logic
}
```

## Next Steps

### Short Term (MVP)

1. Download and compress 3D models
2. Test with real agent data
3. Verify performance (60 FPS target)
4. Mobile testing

### Medium Term

1. Add click handlers → navigate to agent detail page
2. Add hover tooltips with agent info
3. Implement WebSocket for real-time updates (instead of polling)
4. Add more animation states

### Long Term

1. Agent-to-agent interactions (connecting lines, dialogues)
2. Transaction visualizations (particle effects)
3. 3D scene editor for custom layouts
4. VR/AR support

## Resources

### Three.js
- Docs: https://threejs.org/docs/
- Examples: https://threejs.org/examples/
- Editor: https://threejs.org/editor/

### 3D Models
- Sketchfab: https://sketchfab.com/
- Mixamo: https://www.mixamo.com/
- Poly Haven: https://polyhaven.com/
- Quaternius: https://quaternius.com/

### Tools
- glTF Viewer: https://gltf-viewer.donmccurdy.com/
- glTF Report: https://gltf.report/
- gltf-pipeline: https://github.com/CesiumGS/gltf-pipeline

## Support

If you encounter issues:

1. Check browser console for errors
2. Review this guide's Troubleshooting section
3. Verify models are correctly formatted (use Three.js Editor)
4. Test with sample models first
5. Check performance targets are being met

## Summary

The 3D visualization is fully implemented and ready for testing. The only missing piece is the actual 3D models. Once you add `buyer.glb` and `seller.glb` to `public/models/`, the visualization will come to life!

**Critical Next Step**: Download and add 3D models following `public/models/README.md`.
