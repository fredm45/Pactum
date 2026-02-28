'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { ModelLoader, type AgentType } from '@/lib/3d/modelLoader';
import { getModelConfig } from '@/lib/3d/modelConfig';
import {
  AnimationController,
  type AnimationState,
} from '@/lib/3d/animationController';

export interface Agent3DCharacterProps {
  agentId: string;
  name: string;
  type: AgentType;
  position: [number, number, number];
  animationState?: AnimationState;
  scene: THREE.Scene;
  onLoaded?: () => void;
  onError?: (error: Error) => void;
}

export function Agent3DCharacter({
  agentId,
  name,
  type,
  position,
  animationState = 'idle',
  scene,
  onLoaded,
  onError,
}: Agent3DCharacterProps) {
  const modelRef = useRef<THREE.Group | null>(null);
  const animationControllerRef = useRef<AnimationController | null>(null);
  const labelRef = useRef<CSS2DObject | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const hasCalledOnLoaded = useRef(false);

  // Load model and setup
  useEffect(() => {
    let isMounted = true;

    const loadModel = async () => {
      try {
        // Select model based on agent ID
        let modelConfig;

        if (type === 'buyer') {
          // Map agent IDs to specific animals
          const animalMap: Record<string, string> = {
            'animal-sparrow': 'sparrow',
            'animal-gecko': 'gecko',
            'animal-herring': 'herring',
            'animal-taipan': 'taipan',
            'animal-muskrat': 'muskrat',
            'animal-pudu': 'pudu',
            'animal-colobus': 'colobus',
            'animal-inkfish': 'inkfish',
          };

          const variant = animalMap[agentId] || 'gecko';
          modelConfig = getModelConfig('buyer', variant);
        } else {
          // Map seller IDs to specific robots
          const robotMap: Record<string, string> = {
            'robot-1': 'robot1',
            'robot-2': 'robot2',
            'robot-3': 'robot3',
            'robot-4': 'robot4',
          };

          const variant = robotMap[agentId] || 'robot1';
          modelConfig = getModelConfig('seller', variant);
        }

        const { scene: modelScene, animations, mixer} = await ModelLoader.loadModel(type, modelConfig);

        if (!isMounted) {
          // Cleanup if component unmounted during load
          modelScene.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.geometry?.dispose();
              if (Array.isArray(child.material)) {
                child.material.forEach((m) => m.dispose());
              } else {
                child.material?.dispose();
              }
            }
          });
          return;
        }

        // Position model
        // X,Z from props, Y already set by modelLoader config (if any)
        const yOffset = modelScene.position.y;
        modelScene.position.set(position[0], position[1] + yOffset, position[2]);

        // Add to scene
        scene.add(modelScene);
        modelRef.current = modelScene;

        // Setup animation controller
        const controller = new AnimationController(mixer, animations);
        animationControllerRef.current = controller;

        // Create label (only if not already created)
        if (!labelRef.current) {
          const labelDiv = document.createElement('div');
          labelDiv.className = 'agent-label';
          labelDiv.style.cssText = `
            background: rgba(0, 0, 0, 0.7);
            color: ${type === 'buyer' ? '#4a90e2' : '#f39c12'};
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
            white-space: nowrap;
            pointer-events: none;
            border: 1px solid ${type === 'buyer' ? '#4a90e2' : '#f39c12'};
          `;
          labelDiv.textContent = name;

          const label = new CSS2DObject(labelDiv);
          // Higher label for seller (robots are taller)
          const labelHeight = type === 'seller' ? 3.5 : 2.5;
          label.position.set(0, labelHeight, 0);
          modelScene.add(label);
          labelRef.current = label;
        }

        setIsLoaded(true);

        // Only call onLoaded once
        if (!hasCalledOnLoaded.current) {
          hasCalledOnLoaded.current = true;
          onLoaded?.();
        }
      } catch (error) {
        console.error(`[Agent3DCharacter] Failed to load model for ${agentId}:`, error);
        onError?.(error as Error);
      }
    };

    loadModel();

    return () => {
      isMounted = false;

      // Cleanup label
      if (labelRef.current) {
        const labelElement = labelRef.current.element;
        if (labelElement && labelElement.parentNode) {
          labelElement.parentNode.removeChild(labelElement);
        }
        labelRef.current = null;
      }

      // Cleanup model
      if (modelRef.current) {
        scene.remove(modelRef.current);

        // Dispose geometries and materials
        modelRef.current.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry?.dispose();
            if (Array.isArray(child.material)) {
              child.material.forEach((m) => m.dispose());
            } else {
              child.material?.dispose();
            }
          }
        });
      }

      if (animationControllerRef.current) {
        animationControllerRef.current.dispose();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, type, scene]); // position excluded - it's an array and causes re-runs; name/callbacks are stable

  // Update animation state
  useEffect(() => {
    if (isLoaded && animationControllerRef.current) {
      animationControllerRef.current.playState(animationState);
    }
  }, [animationState, isLoaded]);

  // Update animation mixer (called from parent's render loop)
  const update = useCallback((delta: number) => {
    if (animationControllerRef.current) {
      animationControllerRef.current.update(delta);
    }
  }, []);

  // Expose update method to parent
  useEffect(() => {
    if (isLoaded && modelRef.current) {
      (modelRef.current as any).updateAnimation = update;
    }
  }, [isLoaded, update]);

  return null;
}
