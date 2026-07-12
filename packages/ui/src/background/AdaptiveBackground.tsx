import { useEffect, useRef, type JSX } from "react";
import { useReducedMotion } from "../motion/useReducedMotion";

export interface AdaptiveBackgroundProps {
  /** Show the faint neural connector lines between particles. Default true. */
  showNeuralLines?: boolean;
  /** Show the CSS grid overlay. Default true. */
  showGrid?: boolean;
  /** Show the film-grain noise overlay. Default true. */
  showNoise?: boolean;
  /** Roughly how many floating particles to render. Default 36. */
  particleCount?: number;
}

interface Blob {
  x: number;
  y: number;
  radius: number;
  hue: string;
  vx: number;
  vy: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

const ACCENT_COLORS = ["124, 92, 255", "34, 211, 238", "244, 114, 182"];

/**
 * The approved background engine (docs/03_Product_Design.md): aurora
 * gradient blobs drifting slowly behind a field of connected floating
 * particles, capped to devicePixelRatio and paused when the tab is
 * hidden or the user prefers reduced motion, so it never costs frame
 * budget it doesn't need to.
 */
export function AdaptiveBackground({
  showNeuralLines = true,
  showGrid = true,
  showNoise = true,
  particleCount = 36,
}: AdaptiveBackgroundProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    let width = 0;
    let height = 0;
    let animationFrame = 0;
    let running = true;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const blobs: Blob[] = Array.from({ length: 3 }, (_, i) => ({
      x: Math.random(),
      y: Math.random(),
      radius: 0.35 + Math.random() * 0.15,
      hue: ACCENT_COLORS[i % ACCENT_COLORS.length] as string,
      vx: (Math.random() - 0.5) * 0.00012,
      vy: (Math.random() - 0.5) * 0.00012,
    }));

    const particles: Particle[] = Array.from({ length: particleCount }, () => ({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.0004,
      vy: (Math.random() - 0.5) * 0.0004,
      radius: 1 + Math.random() * 1.5,
    }));

    function resize(): void {
      if (!canvas) return;
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function drawStaticFrame(): void {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      for (const blob of blobs) {
        drawBlob(ctx, blob, width, height);
      }
      for (const particle of particles) {
        drawParticle(ctx, particle, width, height);
      }
    }

    function drawBlob(context: CanvasRenderingContext2D, blob: Blob, w: number, h: number): void {
      const cx = blob.x * w;
      const cy = blob.y * h;
      const r = blob.radius * Math.max(w, h);
      const gradient = context.createRadialGradient(cx, cy, 0, cx, cy, r);
      gradient.addColorStop(0, `rgba(${blob.hue}, 0.22)`);
      gradient.addColorStop(1, `rgba(${blob.hue}, 0)`);
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(cx, cy, r, 0, Math.PI * 2);
      context.fill();
    }

    function drawParticle(context: CanvasRenderingContext2D, particle: Particle, w: number, h: number): void {
      context.beginPath();
      context.fillStyle = "rgba(230, 230, 245, 0.5)";
      context.arc(particle.x * w, particle.y * h, particle.radius, 0, Math.PI * 2);
      context.fill();
    }

    function drawNeuralLines(context: CanvasRenderingContext2D, w: number, h: number): void {
      const maxDistance = Math.min(w, h) * 0.16;
      for (let i = 0; i < particles.length; i += 1) {
        for (let j = i + 1; j < particles.length; j += 1) {
          const a = particles[i] as Particle;
          const b = particles[j] as Particle;
          const dx = (a.x - b.x) * w;
          const dy = (a.y - b.y) * h;
          const distance = Math.hypot(dx, dy);
          if (distance < maxDistance) {
            const opacity = 0.12 * (1 - distance / maxDistance);
            context.strokeStyle = `rgba(160, 160, 220, ${opacity})`;
            context.lineWidth = 1;
            context.beginPath();
            context.moveTo(a.x * w, a.y * h);
            context.lineTo(b.x * w, b.y * h);
            context.stroke();
          }
        }
      }
    }

    function step(): void {
      if (!ctx || !running) return;
      ctx.clearRect(0, 0, width, height);

      for (const blob of blobs) {
        blob.x += blob.vx;
        blob.y += blob.vy;
        if (blob.x < -0.2 || blob.x > 1.2) blob.vx *= -1;
        if (blob.y < -0.2 || blob.y > 1.2) blob.vy *= -1;
        drawBlob(ctx, blob, width, height);
      }

      for (const particle of particles) {
        particle.x += particle.vx;
        particle.y += particle.vy;
        if (particle.x < 0 || particle.x > 1) particle.vx *= -1;
        if (particle.y < 0 || particle.y > 1) particle.vy *= -1;
      }

      if (showNeuralLines) {
        drawNeuralLines(ctx, width, height);
      }

      for (const particle of particles) {
        drawParticle(ctx, particle, width, height);
      }

      animationFrame = window.requestAnimationFrame(step);
    }

    function handleVisibilityChange(): void {
      if (document.hidden) {
        running = false;
        window.cancelAnimationFrame(animationFrame);
      } else if (!reducedMotion) {
        running = true;
        animationFrame = window.requestAnimationFrame(step);
      }
    }

    resize();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    if (reducedMotion) {
      drawStaticFrame();
    } else {
      animationFrame = window.requestAnimationFrame(step);
    }

    return () => {
      running = false;
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [particleCount, reducedMotion, showNeuralLines]);

  return (
    <div className="omni-background" aria-hidden="true">
      <canvas ref={canvasRef} className="omni-background__canvas" />
      {showGrid && <div className="omni-background__grid" />}
      {showNoise && <div className="omni-background__noise" />}
    </div>
  );
}
