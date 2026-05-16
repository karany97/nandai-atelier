// AmbientBackdrop.tsx — atmospheric Canvas2D particle field.
//
// Goal: deliver the "billion-dollar 3D visual" mood without paying the
// 800 KB Three.js tax. A weighted point-cloud projected from a spherical
// shell, drawn at 60 fps with composite blending + a soft gold-flare
// overlay. Pure HTML5 Canvas2D — no WebGL, no dependencies.
//
// Reads the global `streamingMsgId` from the store: while the AI is
// generating, particles drift ~3× faster and flare brighter, so the
// background visually communicates "the model is thinking" without
// any UI noise.
//
// Skipped at the App level when the operator (or OS) requests reduced
// motion. This component never renders.

import { useEffect, useRef } from 'react';
import { useStore } from '../lib/store';

type Particle = {
  /** 3D position in a unit shell — projected to 2D each frame */
  x: number; y: number; z: number;
  /** Drift velocity */
  vx: number; vy: number; vz: number;
  /** Per-particle phase so the brightness pulse isn't uniform */
  phase: number;
};

const PARTICLE_COUNT = 480;
const ROTATION_SPEED_IDLE = 0.00018;
const ROTATION_SPEED_ACTIVE = 0.0006;

function makeParticles(): Particle[] {
  const ps: Particle[] = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    // Uniform spherical sampling (Marsaglia)
    let u: number, v: number, s: number;
    do {
      u = Math.random() * 2 - 1;
      v = Math.random() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const factor = Math.sqrt(1 - s);
    const r = 0.95 + Math.random() * 0.1;
    ps.push({
      x: r * 2 * u * factor,
      y: r * 2 * v * factor * 0.6,        // slightly flattened sphere — reads better at landscape
      z: r * (1 - 2 * s),
      vx: (Math.random() - 0.5) * 0.0006,
      vy: (Math.random() - 0.5) * 0.0006,
      vz: (Math.random() - 0.5) * 0.0006,
      phase: Math.random() * Math.PI * 2,
    });
  }
  return ps;
}

export function AmbientBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const particlesRef = useRef<Particle[]>(makeParticles());
  const rotYRef = useRef(0);
  const streaming = useStore((s) => !!s.streamingMsgId);
  const streamingRef = useRef(streaming);
  streamingRef.current = streaming;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // Hi-DPI sharpness — but cap at 2× so a Retina display doesn't burn 4× pixels
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      if (!canvas || !ctx) return;
      canvas.width  = Math.floor(window.innerWidth  * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width  = window.innerWidth  + 'px';
      canvas.style.height = window.innerHeight + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    let lastT = performance.now();

    function frame(now: number) {
      if (!ctx || !canvas) return;
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;

      const W = canvas.clientWidth;
      const H = canvas.clientHeight;

      // Clear with a subtle gold-tinted dark wash — gives the trailing-blur effect
      ctx.fillStyle = 'rgba(14, 12, 10, 0.22)';
      ctx.fillRect(0, 0, W, H);

      // Rotation speed scales with whether the AI is actively generating
      const speed = streamingRef.current ? ROTATION_SPEED_ACTIVE : ROTATION_SPEED_IDLE;
      rotYRef.current += dt * 1000 * speed;
      const cosY = Math.cos(rotYRef.current);
      const sinY = Math.sin(rotYRef.current);

      const cx = W / 2;
      const cy = H / 2;
      const scale = Math.min(W, H) * 0.42;

      // Draw particles back-to-front for depth — sort indices by z each frame
      const ps = particlesRef.current;
      const idx: number[] = [];
      for (let i = 0; i < ps.length; i++) idx.push(i);
      idx.sort((a, b) => {
        const az = ps[a].x * sinY + ps[a].z * cosY;
        const bz = ps[b].x * sinY + ps[b].z * cosY;
        return az - bz;
      });

      ctx.globalCompositeOperation = 'lighter';
      for (const i of idx) {
        const p = ps[i];

        // Drift
        p.x += p.vx; p.y += p.vy; p.z += p.vz;

        // Soft re-center if drift carries them out of the shell
        const r2 = p.x * p.x + p.y * p.y + p.z * p.z;
        if (r2 > 1.3 || r2 < 0.4) {
          const k = 0.97;
          p.x *= k; p.y *= k; p.z *= k;
          p.vx = -p.vx * 0.6; p.vy = -p.vy * 0.6; p.vz = -p.vz * 0.6;
        }

        // Y-rotate
        const rx = p.x * cosY - p.z * sinY;
        const rz = p.x * sinY + p.z * cosY;
        // Perspective project (camera at z=2.6)
        const camDist = 2.6;
        const persp = camDist / (camDist - rz);
        const sx = cx + rx * scale * persp;
        const sy = cy + p.y * scale * persp;

        // Depth-based size + opacity — closer = bigger and brighter
        const sizePx = 1.0 + persp * 1.4;
        const baseAlpha = Math.min(1, persp * 0.55);

        // Pulse — keyed to the phase so the field shimmers, not pulses uniformly
        const pulse = 0.85 + 0.15 * Math.sin(now * 0.0014 + p.phase);

        // Warm gold when the AI is active; muted bronze when idle
        const hue   = streamingRef.current ? 42 : 32;
        const sat   = streamingRef.current ? 85 : 55;
        const light = streamingRef.current ? 66 : 48;
        const alpha = baseAlpha * pulse * (streamingRef.current ? 0.95 : 0.62);

        ctx.fillStyle = `hsla(${hue}, ${sat}%, ${light}%, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(sx, sy, sizePx, 0, Math.PI * 2);
        ctx.fill();
      }

      // Soft radial gold flare at upper-left + crimson flare at lower-right —
      // gives the scene a directional light feel without a real lighting pass
      ctx.globalCompositeOperation = 'lighter';
      const grad1 = ctx.createRadialGradient(W * 0.22, H * 0.28, 0, W * 0.22, H * 0.28, W * 0.45);
      grad1.addColorStop(0, 'hsla(42, 80%, 60%, 0.10)');
      grad1.addColorStop(1, 'hsla(42, 80%, 60%, 0)');
      ctx.fillStyle = grad1;
      ctx.fillRect(0, 0, W, H);

      const grad2 = ctx.createRadialGradient(W * 0.78, H * 0.78, 0, W * 0.78, H * 0.78, W * 0.5);
      grad2.addColorStop(0, 'hsla(350, 50%, 50%, 0.12)');
      grad2.addColorStop(1, 'hsla(350, 50%, 50%, 0)');
      ctx.fillStyle = grad2;
      ctx.fillRect(0, 0, W, H);

      // Subtle vignette
      ctx.globalCompositeOperation = 'source-over';
      const vgrad = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.3, cx, cy, Math.max(W, H) * 0.75);
      vgrad.addColorStop(0, 'rgba(0,0,0,0)');
      vgrad.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = vgrad;
      ctx.fillRect(0, 0, W, H);

      rafRef.current = requestAnimationFrame(frame);
    }
    rafRef.current = requestAnimationFrame(frame);

    return () => {
      window.removeEventListener('resize', resize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 -z-10 pointer-events-none"
      aria-hidden="true"
    />
  );
}
