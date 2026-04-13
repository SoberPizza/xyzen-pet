// Ground shadow vertex shader (enhanced)
// Larger, more prominent elliptical shadow with stronger height linkage.

uniform float u_energy;
uniform float u_time;
uniform float u_breathSpeed;
uniform float u_coreOffsetX;
uniform float u_coreOffsetY;

varying vec2 vUv;

void main() {
  vUv = uv;

  // Breathing scale
  float breath = 1.0 + 0.03 * sin(u_time * u_breathSpeed);

  // Shadow scale: larger base (1.5), grows with energy, stretches more when spirit rises
  float shadowScale = (1.5 + u_energy * 0.3) * (1.0 + max(0.0, u_coreOffsetY) * 0.5) * breath;

  // Elliptical: wider on X, narrower on Z
  vec3 pos = position;
  pos.x *= shadowScale * 1.6;
  pos.z *= shadowScale * 0.9;

  // Parallax: shadow moves at 0.6x of spirit offset (depth cue)
  pos.x += u_coreOffsetX * 0.6;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
