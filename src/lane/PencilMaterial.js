import * as THREE from 'three';

// Pigment is anchored to the course, not to time or screen pixels. Only the
// painted edge wobbles; the shared centerline and judgement positions stay exact.
export function createPencilMaterial(color, seed) {
  return new THREE.ShaderMaterial({
    uniforms: { pigment: { value: new THREE.Color(color) }, seed: { value: seed } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    vertexShader: `
      varying vec2 stroke;
      void main() {
        stroke = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 pigment;
      uniform float seed;
      varying vec2 stroke;
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x),
                   mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y);
      }
      void main() {
        float along = stroke.x;
        float wobble = (noise(vec2(along * 6., seed)) - .5) * .38;
        float across = stroke.y - wobble;
        float pressure = .58 + .20 * noise(vec2(along * 9., seed + 2.));
        float roughEdge = (noise(vec2(along * 65., stroke.y * 13. + seed)) - .5) * .18;
        float aa = max(fwidth(across), .025);
        float edge = 1. - smoothstep(pressure - aa, pressure + aa, abs(across) + roughEdge);
        float tooth = noise(vec2(along * 115., stroke.y * 28. + seed));
        // Fade subpixel grain toward its average when zoomed out to avoid shimmer.
        float resolved = 1. - smoothstep(.6, 2.5, fwidth(along * 115.));
        float grain = mix(.72, smoothstep(.16, .75, tooth), resolved);
        float fibers = .70 + .30 * noise(vec2(along * 17., stroke.y * 60. + seed));
        float alpha = edge * (.30 + .70 * grain) * fibers;
        if (alpha < .015) discard;
        gl_FragColor = vec4(pigment, alpha);
        #include <colorspace_fragment>
      }
    `
  });
}
