import React, { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, ContactShadows, Environment } from '@react-three/drei';
import AvatarModel from './AvatarModel.jsx';

// Standalone 3D avatar viewer used in the customizer, lobby spotlight and
// scoreboards. Keep it lightweight (capped dpr, no heavy post).
export default function Avatar3D({ avatar, emotion = 'neutral', controls = false, size = 220, spin = true }) {
  return (
    <div style={{ width: size, height: size }}>
      <Canvas dpr={[1, 2]} camera={{ position: [0, 0.05, 5.6], fov: 40 }} gl={{ antialias: true, alpha: true }}>
        <ambientLight intensity={0.85} />
        <directionalLight position={[3, 5, 4]} intensity={1.1} />
        <directionalLight position={[-4, 2, -2]} intensity={0.5} color={'#9b6bff'} />
        <Suspense fallback={null}>
          <group position={[0, 0, 0]}>
            <AvatarModel avatar={avatar} emotion={emotion} />
          </group>
          <ContactShadows position={[0, -1.95, 0]} opacity={0.35} scale={6} blur={2.6} far={4} />
          <Environment preset="city" />
        </Suspense>
        {controls ? (
          <OrbitControls makeDefault target={[0, 0.05, 0]} enablePan={false} enableZoom={false} autoRotate={spin} autoRotateSpeed={2.2} minPolarAngle={Math.PI / 3} maxPolarAngle={Math.PI / 1.8} />
        ) : (
          <OrbitControls makeDefault target={[0, 0.05, 0]} enabled={false} autoRotate={spin} autoRotateSpeed={1.4} />
        )}
      </Canvas>
    </div>
  );
}
