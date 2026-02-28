'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export default function Test3D() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });

    renderer.setSize(window.innerWidth, window.innerHeight);
    containerRef.current.appendChild(renderer.domElement);

    // 添加光照
    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(5, 5, 5);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0x404040));

    camera.position.set(0, 2, 10);
    camera.lookAt(0, 0, 0);

    const loader = new GLTFLoader();

    // 加载动物包
    console.log('[Test3D] Loading animal pack...');
    loader.load(
      '/models/quirky_series_-_free_animals_pack/scene.gltf',
      (gltf) => {
        console.log('[Test3D] Loaded successfully');
        console.log('[Test3D] Nodes:', gltf.scene.children.map((c: any) => c.name));

        // 列出所有节点
        gltf.scene.traverse((child) => {
          if (child.name) {
            console.log(`Node: ${child.name}, visible: ${child.visible}, type: ${child.type}`);
          }
        });

        // 只显示 Gecko - 隐藏其他 Rig
        const rigsToHide = ['Rig.002', 'Rig.003', 'Rig.004', 'Rig.005', 'Rig.006', 'Rig.007'];
        gltf.scene.traverse((child) => {
          // 隐藏其他 Rig 及其子节点
          const parentName = child.parent?.name || '';
          const shouldHide = rigsToHide.some(rig =>
            child.name.includes(rig) || parentName.includes(rig)
          );

          if (shouldHide) {
            child.visible = false;
            child.traverse((c) => c.visible = false);
          }

          console.log(`${child.name}: ${child.visible ? 'VISIBLE' : 'hidden'}`);
        });

        scene.add(gltf.scene);
      },
      (progress) => {
        console.log('[Test3D] Loading:', Math.round((progress.loaded / progress.total) * 100) + '%');
      },
      (error) => {
        console.error('[Test3D] Error:', error);
      }
    );

    // 渲染循环
    function animate() {
      requestAnimationFrame(animate);
      renderer.render(scene, camera);
    }
    animate();

    return () => {
      renderer.dispose();
      containerRef.current?.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div>
      <div ref={containerRef} />
      <div style={{ position: 'fixed', top: 10, left: 10, background: 'rgba(0,0,0,0.8)', color: 'white', padding: '10px' }}>
        <h3>3D Test Page</h3>
        <p>Check console (F12) for debug output</p>
      </div>
    </div>
  );
}
