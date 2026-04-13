// Ground Grid vertex shader
// Large plane on ground for concentric rings and perspective reference.

uniform float u_coreOffsetX;

varying vec2 vUv;

void main() {
  vUv = uv;

  vec3 pos = position;
  // Scale to cover a wider area
  pos.x *= 4.0;
  pos.z *= 4.0;

  // Slight parallax with core offset
  pos.x += u_coreOffsetX * 0.3;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
