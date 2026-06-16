import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// THREE.Color parses "hsl(h, s%, l%)" (comma form), so use that here.
const c = (h, s = 70, l = 60) => `hsl(${h}, ${s}%, ${l}%)`;

// Emotion -> animation/pose parameters.
function emotionParams(emotion, t) {
  switch (emotion) {
    case 'cocky':
      return {
        bob: Math.sin(t * 1.2) * 0.04,
        tilt: 0.18 + Math.sin(t * 0.8) * 0.03,
        lean: -0.12,
        mouth: 'smug',
        brow: 'raised',
        scaleY: 1,
        shake: 0,
      };
    case 'happy':
      return { bob: Math.abs(Math.sin(t * 5)) * 0.18, tilt: Math.sin(t * 3) * 0.06, lean: 0, mouth: 'smile', brow: 'happy', scaleY: 1, shake: 0 };
    case 'hype':
      return { bob: Math.abs(Math.sin(t * 9)) * 0.32, tilt: Math.sin(t * 8) * 0.12, lean: 0, mouth: 'open', brow: 'happy', scaleY: 1, shake: 0 };
    case 'mad':
      return { bob: Math.sin(t * 10) * 0.03, tilt: 0, lean: 0.1, mouth: 'frown', brow: 'angry', scaleY: 0.96, shake: Math.sin(t * 30) * 0.04 };
    case 'sad':
      return { bob: -0.06 + Math.sin(t * 1.5) * 0.02, tilt: -0.12, lean: 0.18, mouth: 'sad', brow: 'sad', scaleY: 0.94, shake: 0 };
    case 'chill':
      return { bob: Math.sin(t * 1.4) * 0.07, tilt: Math.sin(t * 0.6) * 0.16, lean: 0.05, mouth: 'chill', brow: 'flat', scaleY: 1, shake: 0 };
    default:
      return { bob: Math.sin(t * 1.8) * 0.06, tilt: Math.sin(t * 1.1) * 0.05, lean: 0, mouth: 'smile', brow: 'flat', scaleY: 1, shake: 0 };
  }
}

function Mouth({ kind, color }) {
  const shapes = {
    smile: <torusGeometry args={[0.16, 0.04, 8, 24, Math.PI]} />,
    smug: <torusGeometry args={[0.13, 0.035, 8, 24, Math.PI * 0.7]} />,
    open: <sphereGeometry args={[0.12, 16, 16]} />,
    frown: <torusGeometry args={[0.16, 0.04, 8, 24, Math.PI]} />,
    sad: <torusGeometry args={[0.16, 0.04, 8, 24, Math.PI]} />,
    chill: <boxGeometry args={[0.22, 0.04, 0.04]} />,
  };
  const rot = kind === 'frown' || kind === 'sad' ? [0, 0, Math.PI] : [0, 0, 0];
  return (
    <mesh position={[0, -0.28, 0.92]} rotation={rot}>
      {shapes[kind] || shapes.smile}
      <meshStandardMaterial color={color} roughness={0.5} />
    </mesh>
  );
}

function Brow({ kind, x, hue }) {
  const rotZ = { angry: x > 0 ? 0.5 : -0.5, sad: x > 0 ? -0.4 : 0.4, raised: 0, happy: 0, flat: 0 }[kind] ?? 0;
  const y = kind === 'raised' ? 0.34 : 0.28;
  return (
    <mesh position={[x, y, 0.92]} rotation={[0, 0, rotZ]}>
      <boxGeometry args={[0.16, 0.04, 0.04]} />
      <meshStandardMaterial color={c(hue, 30, 25)} />
    </mesh>
  );
}

function Hat({ id, bodyHue }) {
  if (id === 'none') return null;
  const top = c((bodyHue + 40) % 360, 80, 55);
  switch (id) {
    case 'cap':
      return (
        <group position={[0, 0.95, 0]}>
          <mesh position={[0, 0, 0]}><sphereGeometry args={[0.78, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color={top} /></mesh>
          <mesh position={[0, -0.02, 0.6]} rotation={[-0.3, 0, 0]}><boxGeometry args={[0.7, 0.05, 0.5]} /><meshStandardMaterial color={top} /></mesh>
        </group>
      );
    case 'top':
      return (
        <group position={[0, 1.05, 0]}>
          <mesh><cylinderGeometry args={[0.55, 0.55, 0.7, 24]} /><meshStandardMaterial color={c(280, 30, 18)} /></mesh>
          <mesh position={[0, -0.35, 0]}><cylinderGeometry args={[0.85, 0.85, 0.06, 24]} /><meshStandardMaterial color={c(280, 30, 18)} /></mesh>
          <mesh position={[0, -0.2, 0]}><cylinderGeometry args={[0.56, 0.56, 0.12, 24]} /><meshStandardMaterial color={c(0, 80, 55)} /></mesh>
        </group>
      );
    case 'crown':
      return (
        <group position={[0, 1.0, 0]}>
          <mesh><cylinderGeometry args={[0.62, 0.62, 0.3, 8]} /><meshStandardMaterial color={c(48, 90, 55)} metalness={0.8} roughness={0.2} /></mesh>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <mesh key={i} position={[Math.cos((i / 8) * Math.PI * 2) * 0.58, 0.22, Math.sin((i / 8) * Math.PI * 2) * 0.58]}>
              <coneGeometry args={[0.09, 0.22, 6]} /><meshStandardMaterial color={c(48, 90, 60)} metalness={0.8} roughness={0.2} />
            </mesh>
          ))}
        </group>
      );
    case 'beanie':
      return (
        <group position={[0, 0.95, 0]}>
          <mesh><sphereGeometry args={[0.8, 24, 16, 0, Math.PI * 2, 0, Math.PI / 1.7]} /><meshStandardMaterial color={top} /></mesh>
          <mesh position={[0, 0.55, 0]}><sphereGeometry args={[0.14, 12, 12]} /><meshStandardMaterial color={c(0, 0, 95)} /></mesh>
        </group>
      );
    case 'party':
      return (
        <mesh position={[0, 1.35, 0]} rotation={[0, 0, 0]}>
          <coneGeometry args={[0.45, 1.0, 24]} />
          <meshStandardMaterial color={c(320, 85, 60)} />
        </mesh>
      );
    case 'wizard':
      return (
        <group position={[0, 1.3, 0]}>
          <mesh><coneGeometry args={[0.5, 1.2, 24]} /><meshStandardMaterial color={c(255, 60, 35)} /></mesh>
          <mesh position={[0, -0.55, 0]}><cylinderGeometry args={[0.85, 0.85, 0.05, 24]} /><meshStandardMaterial color={c(255, 60, 35)} /></mesh>
        </group>
      );
    case 'halo':
      return (
        <mesh position={[0, 1.15, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.5, 0.06, 12, 32]} />
          <meshStandardMaterial color={c(50, 100, 70)} emissive={c(50, 100, 60)} emissiveIntensity={0.8} />
        </mesh>
      );
    default:
      return null;
  }
}

function Accessory({ id, hue }) {
  switch (id) {
    case 'glasses':
    case 'shades': {
      const lens = id === 'shades' ? c(255, 10, 10) : c(200, 30, 70);
      return (
        <group position={[0, 0.08, 0.92]}>
          <mesh position={[-0.3, 0, 0]}><torusGeometry args={[0.2, 0.03, 8, 20]} /><meshStandardMaterial color={c(0, 0, 15)} /></mesh>
          <mesh position={[0.3, 0, 0]}><torusGeometry args={[0.2, 0.03, 8, 20]} /><meshStandardMaterial color={c(0, 0, 15)} /></mesh>
          <mesh position={[0, 0, -0.01]}><boxGeometry args={[0.2, 0.03, 0.03]} /><meshStandardMaterial color={c(0, 0, 15)} /></mesh>
          {id === 'shades' && (
            <>
              <mesh position={[-0.3, 0, 0.02]}><circleGeometry args={[0.18, 20]} /><meshStandardMaterial color={lens} /></mesh>
              <mesh position={[0.3, 0, 0.02]}><circleGeometry args={[0.18, 20]} /><meshStandardMaterial color={lens} /></mesh>
            </>
          )}
        </group>
      );
    }
    case 'mustache':
      return (
        <mesh position={[0, -0.12, 0.95]} rotation={[0, 0, Math.PI]}>
          <torusGeometry args={[0.16, 0.04, 8, 20, Math.PI]} />
          <meshStandardMaterial color={c(hue, 30, 20)} />
        </mesh>
      );
    case 'bowtie':
      return (
        <group position={[0, -1.05, 0.55]}>
          <mesh rotation={[0, 0, 0.4]}><coneGeometry args={[0.16, 0.3, 4]} /><meshStandardMaterial color={c(350, 80, 50)} /></mesh>
          <mesh rotation={[0, 0, -0.4 + Math.PI]}><coneGeometry args={[0.16, 0.3, 4]} /><meshStandardMaterial color={c(350, 80, 50)} /></mesh>
        </group>
      );
    case 'monocle':
      return (
        <mesh position={[0.3, 0.08, 0.93]}><torusGeometry args={[0.2, 0.025, 8, 24]} /><meshStandardMaterial color={c(48, 90, 55)} metalness={0.7} /></mesh>
      );
    case 'earrings':
      return (
        <>
          <mesh position={[-0.92, -0.2, 0.2]}><sphereGeometry args={[0.07, 12, 12]} /><meshStandardMaterial color={c(48, 90, 60)} metalness={0.8} roughness={0.2} /></mesh>
          <mesh position={[0.92, -0.2, 0.2]}><sphereGeometry args={[0.07, 12, 12]} /><meshStandardMaterial color={c(48, 90, 60)} metalness={0.8} roughness={0.2} /></mesh>
        </>
      );
    default:
      return null;
  }
}

export default function AvatarModel({ avatar, emotion = 'neutral' }) {
  const group = useRef();
  const a = avatar || {};
  const skin = c(a.skinHue ?? 28, 55, 65);
  const body = c(a.bodyHue ?? 260, 70, 58);
  const eye = c(a.eyeHue ?? 220, 70, 45);

  const faceScale = useMemo(() => {
    switch (a.face) {
      case 'oval': return [0.92, 1.12, 0.92];
      case 'square': return [1.05, 1.0, 1.0];
      case 'bean': return [1.1, 0.92, 1.0];
      default: return [1, 1, 1];
    }
  }, [a.face]);

  useFrame((state) => {
    if (!group.current) return;
    const t = state.clock.elapsedTime;
    const p = emotionParams(emotion, t);
    group.current.position.y = p.bob;
    group.current.rotation.z = p.tilt + p.shake;
    group.current.rotation.x = p.lean;
    group.current.scale.y = THREE.MathUtils.lerp(group.current.scale.y || 1, p.scaleY, 0.1);
  });

  const p = emotionParams(emotion, 0);

  return (
    <group ref={group}>
      {/* body */}
      <mesh position={[0, -1.15, 0]} scale={[1, 1, 1]}>
        <capsuleGeometry args={[0.6, 0.5, 8, 16]} />
        <meshStandardMaterial color={body} roughness={0.45} />
      </mesh>
      {/* head */}
      <group scale={faceScale}>
        <mesh>
          <sphereGeometry args={[0.95, 32, 32]} />
          <meshStandardMaterial color={skin} roughness={0.4} />
        </mesh>
        {/* eyes */}
        <mesh position={[-0.3, 0.12, 0.82]}>
          <sphereGeometry args={[0.16, 16, 16]} />
          <meshStandardMaterial color={'#fff'} />
        </mesh>
        <mesh position={[0.3, 0.12, 0.82]}>
          <sphereGeometry args={[0.16, 16, 16]} />
          <meshStandardMaterial color={'#fff'} />
        </mesh>
        <mesh position={[-0.3, 0.12, 0.95]}>
          <sphereGeometry args={[0.07, 12, 12]} />
          <meshStandardMaterial color={eye} />
        </mesh>
        <mesh position={[0.3, 0.12, 0.95]}>
          <sphereGeometry args={[0.07, 12, 12]} />
          <meshStandardMaterial color={eye} />
        </mesh>
        <Brow kind={p.brow} x={-0.3} hue={a.skinHue ?? 28} />
        <Brow kind={p.brow} x={0.3} hue={a.skinHue ?? 28} />
        <Mouth kind={p.mouth} color={c(0, 50, 35)} />
        <Accessory id={a.accessory || 'none'} hue={a.skinHue ?? 28} />
      </group>
      <Hat id={a.hat || 'none'} bodyHue={a.bodyHue ?? 260} />
    </group>
  );
}
