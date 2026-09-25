"use client";

import { useEffect, useRef } from "react";

/**
 * Light "fluted glass" backdrop for the landing hero: soft paper-grey field
 * with a blurred red glow band, seen through vertical reeded glass (every rib
 * shows a squeezed slice of what's behind it), plus a little film grain.
 * One full-screen quad in raw WebGL, rendered at reduced resolution (it's
 * blurry by design), paused when off-screen or in a background tab, and a
 * single still frame when the visitor prefers reduced motion.
 */

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform float uRib;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// what sits behind the glass (uv: 0..1, y up)
vec3 field(vec2 uv) {
  float asp = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * asp, uv.y);
  vec3 paper = vec3(0.965, 0.962, 0.955);
  vec3 col = mix(paper, vec3(0.9, 0.9, 0.895), smoothstep(0.2, 1.0, uv.y) * 0.5);

  // cool grey shadow drifting in from the top-left
  vec2 g = p - vec2(0.12 * asp + 0.05 * sin(uTime * 0.11), 0.95);
  col = mix(col, vec3(0.74, 0.75, 0.76), exp(-dot(g, g) * 5.0) * 0.55);

  // the red glow: a diagonal band behind the record, slowly breathing.
  // Wide screens: right half, upper-middle. Portrait: behind the record,
  // kept off the text above it.
  bool tall = asp < 1.0;
  vec2 o = tall ? vec2(0.8 * asp, 0.44) : vec2(0.74 * asp, 0.64);
  o.x += 0.035 * sin(uTime * 0.17);
  vec2 dir = normalize(tall ? vec2(0.35, 1.0) : vec2(0.62, 1.0));
  vec2 q = p - o;
  float across = dot(q, vec2(dir.y, -dir.x));
  float along = dot(q, dir);
  float w = (tall ? 0.12 : 0.14) + 0.025 * sin(uTime * 0.23 + along * 2.0);
  // longer towards the top, short tail below (the tracklist sits there)
  float len = along > 0.0 ? (tall ? 0.24 : 0.5) : (tall ? 0.09 : 0.2);
  float band = exp(-(across * across) / (w * w)) * exp(-(along * along) / (len * len));
  vec3 red = vec3(0.82, 0.07, 0.11);
  vec3 deep = vec3(0.5, 0.02, 0.06);
  col = mix(col, red, smoothstep(0.0, 0.85, band) * 0.9);
  col = mix(col, deep, pow(band, 2.5) * 0.5);
  return col;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  // vertical ribs: each shows a compressed, slightly shifted slice
  float r = frag.x / uRib;
  float i = floor(r);
  float f = fract(r);
  float x = (i + 0.5 + (f - 0.5) * 0.3) * uRib;
  vec2 uv = vec2(x / uRes.x, frag.y / uRes.y);
  vec3 col = field(uv);
  // rib shading: rounded glass catches light on one side, a thin dark seam between ribs
  float n = f * 2.0 - 1.0;
  col *= 1.0 - 0.03 * n * n;
  col += 0.02 * smoothstep(0.55, 0.15, abs(f - 0.3));
  col *= mix(0.955, 1.0, smoothstep(0.0, 0.08, f) * smoothstep(1.0, 0.92, f));
  // grain
  col += (hash(frag + fract(uTime) * 91.0) - 0.5) * 0.035;
  gl_FragColor = vec4(col, 1.0);
}
`;

const SCALE = 0.6; // render resolution relative to CSS pixels

export default function FlutedBackdrop({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" });
    if (!gl) return; // the CSS fallback background stays visible
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(prog, "uRes");
    const uTime = gl.getUniformLocation(prog, "uTime");
    const uRib = gl.getUniformLocation(prog, "uRib");

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let visible = true;
    let raf = 0;
    const t0 = performance.now();

    const resize = () => {
      const w = Math.max(1, Math.round(canvas.clientWidth * SCALE));
      const h = Math.max(1, Math.round(canvas.clientHeight * SCALE));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
      // ~30 CSS px per rib, a little wider on big screens
      gl.uniform1f(uRib, Math.max(22, Math.min(52, canvas.clientWidth / 34)) * SCALE);
    };
    const draw = () => {
      gl.uniform1f(uTime, still ? 12 : (performance.now() - t0) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const loop = () => {
      raf = 0;
      if (!visible || document.hidden) return;
      draw();
      raf = requestAnimationFrame(loop);
    };
    const kick = () => {
      if (still) draw();
      else if (!raf) raf = requestAnimationFrame(loop);
    };

    resize();
    kick();
    const ro = new ResizeObserver(() => {
      resize();
      draw();
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) kick();
    });
    io.observe(canvas);
    const onVis = () => !document.hidden && kick();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      // free what we made but keep the context: React may mount this effect
      // again on the same canvas (dev double-invoke), and a lost context stays lost
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={`pointer-events-none absolute inset-0 h-full w-full bg-[#eeedeb] ${className}`}
    />
  );
}
