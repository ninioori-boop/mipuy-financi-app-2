"use client"

import { useEffect, useRef } from "react"
import * as THREE from "three"

export function ShaderAnimation() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    if (typeof window === "undefined") return

    // WebGL feature detection — bail out cleanly on devices/browsers without support
    // (older devices, disabled hardware acceleration, locked-down enterprise browsers).
    // Without this guard, three.js throws and crashes the parent page.
    try {
      const probe = document.createElement("canvas")
      const ctx = probe.getContext("webgl2") || probe.getContext("webgl") || probe.getContext("experimental-webgl")
      if (!ctx) return
    } catch {
      return
    }

    const container = containerRef.current

    const vertexShader = `
      void main() {
        gl_Position = vec4( position, 1.0 );
      }
    `

    const fragmentShader = `
      #define TWO_PI 6.2831853072
      #define PI 3.14159265359

      precision highp float;
      uniform vec2 resolution;
      uniform float time;

      void main(void) {
        vec2 uv = (gl_FragCoord.xy * 2.0 - resolution.xy) / min(resolution.x, resolution.y);
        float t = time*0.05;
        float lineWidth = 0.002;

        vec3 color = vec3(0.0);
        for(int j = 0; j < 3; j++){
          for(int i=0; i < 5; i++){
            color[j] += lineWidth*float(i*i) / abs(fract(t - 0.01*float(j)+float(i)*0.01)*5.0 - length(uv) + mod(uv.x+uv.y, 0.2));
          }
        }

        gl_FragColor = vec4(color[0],color[1],color[2],1.0);
      }
    `

    let renderer: THREE.WebGLRenderer | null = null
    let geometry: THREE.PlaneGeometry | null = null
    let material: THREE.ShaderMaterial | null = null
    let animationId = 0
    let onWindowResize: (() => void) | null = null

    try {
      const camera = new THREE.Camera()
      camera.position.z = 1

      const scene = new THREE.Scene()
      geometry = new THREE.PlaneGeometry(2, 2)

      const uniforms = {
        time: { value: 1.0 },
        resolution: { value: new THREE.Vector2() },
      }

      material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader,
        fragmentShader,
      })

      const mesh = new THREE.Mesh(geometry, material)
      scene.add(mesh)

      renderer = new THREE.WebGLRenderer({ antialias: true, failIfMajorPerformanceCaveat: false })
      renderer.setPixelRatio(window.devicePixelRatio)
      container.appendChild(renderer.domElement)

      onWindowResize = () => {
        if (!renderer) return
        const width = container.clientWidth
        const height = container.clientHeight
        renderer.setSize(width, height)
        uniforms.resolution.value.x = renderer.domElement.width
        uniforms.resolution.value.y = renderer.domElement.height
      }

      onWindowResize()
      window.addEventListener("resize", onWindowResize, false)

      const animate = () => {
        animationId = requestAnimationFrame(animate)
        uniforms.time.value += 0.05
        if (renderer) renderer.render(scene, camera)
      }

      animate()
    } catch {
      // Renderer or shader compilation failed — silently fall back to the static
      // background from the parent element. Do not crash the page.
      if (renderer) {
        try { renderer.dispose() } catch {}
        renderer = null
      }
      return
    }

    return () => {
      if (onWindowResize) window.removeEventListener("resize", onWindowResize)
      cancelAnimationFrame(animationId)
      if (renderer && renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement)
      }
      try { renderer?.dispose() } catch {}
      try { geometry?.dispose() } catch {}
      try { material?.dispose() } catch {}
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{
        background: "#000",
        overflow: "hidden",
      }}
    />
  )
}
