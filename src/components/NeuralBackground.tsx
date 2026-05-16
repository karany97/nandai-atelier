// Subtle 3D background — animated point cloud + a slow gold ring.
// Sits behind everything and listens to the global streaming state so the
// particles drift faster while the AI is generating.

import { Suspense, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../lib/store';

function PointCloud({ active }: { active: boolean }) {
  const ref = useRef<THREE.Points>(null);
  const count = 1400;
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Spherical shell of points
      const r = 5 + Math.random() * 2.5;
      const phi = Math.acos(2 * Math.random() - 1);
      const theta = 2 * Math.PI * Math.random();
      arr[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.55;
      arr[i * 3 + 2] = r * Math.cos(phi);
    }
    return arr;
  }, []);
  useFrame((_s, dt) => {
    if (!ref.current) return;
    const speed = active ? 0.18 : 0.045;
    ref.current.rotation.y += dt * speed;
    ref.current.rotation.x = Math.sin(performance.now() * 0.00015) * 0.18;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.022}
        sizeAttenuation
        color={active ? '#f0c265' : '#9b7a4a'}
        transparent opacity={active ? 0.85 : 0.55}
        depthWrite={false}
      />
    </points>
  );
}

function GoldRing() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_s, dt) => { if (ref.current) ref.current.rotation.z += dt * 0.08; });
  return (
    <mesh ref={ref} rotation={[Math.PI / 2.3, 0.6, 0]}>
      <torusGeometry args={[3.4, 0.012, 16, 200]} />
      <meshBasicMaterial color="#caa15a" transparent opacity={0.35} />
    </mesh>
  );
}

export function NeuralBackground() {
  const streaming = useStore((s) => !!s.streamingMsgId);
  return (
    <div className="fixed inset-0 -z-10 pointer-events-none">
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 0, 9], fov: 50 }}
        gl={{ antialias: true, alpha: true }}
      >
        {/* No <color attach="background"> — alpha=true lets the themed body bg show through. */}
        <Suspense fallback={null}>
          <PointCloud active={streaming} />
          <GoldRing />
        </Suspense>
      </Canvas>
      {/* Vignette + soft gold flare */}
      <div className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(60% 60% at 25% 30%, hsl(42 80% 60% / 0.10), transparent 60%),' +
            'radial-gradient(60% 60% at 80% 80%, hsl(350 50% 50% / 0.14), transparent 60%),' +
            'radial-gradient(120% 120% at 50% 50%, transparent 50%, hsl(225 22% 4% / 0.6) 100%)',
        }}
      />
    </div>
  );
}
