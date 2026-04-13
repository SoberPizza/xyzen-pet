// Orbital Wisps vertex shader
// 3 bright wisps + trail points orbiting the core on 3D paths.

attribute float a_wispIndex;
attribute float a_trailPosition;

uniform float u_time;
uniform float u_orbitSpeed;
uniform float u_coreOffsetX;
uniform float u_coreOffsetY;
uniform float u_energy;
uniform float u_audioLevel;
uniform float u_speakingLevel;

varying float v_alpha;
varying float v_colorMix;

// Each wisp has different orbital parameters
vec3 getWispPosition(float wispIdx, float trailT, float time) {
  float speed = u_orbitSpeed * (0.8 + wispIdx * 0.3);
  float t = time * speed - trailT * 0.15; // trail points lag behind head

  // Different orbit planes per wisp
  float tiltX = 0.3 + wispIdx * 0.7;
  float tiltZ = 0.5 + wispIdx * 0.4;
  float radius = 0.7 + wispIdx * 0.15 + u_energy * 0.1;

  // Audio reactivity
  float audio = max(u_audioLevel, u_speakingLevel);
  radius *= 1.0 + audio * 0.15;

  // Lissajous-like 3D orbit
  vec3 pos;
  pos.x = cos(t * 1.0) * radius;
  pos.y = sin(t * tiltX) * radius * 0.6;
  pos.z = sin(t * tiltZ) * radius * 0.8;

  // Add core offset
  pos.x += u_coreOffsetX;
  pos.y += u_coreOffsetY;

  return pos;
}

void main() {
  vec3 pos = getWispPosition(a_wispIndex, a_trailPosition, u_time);

  // Head is bright, trail fades
  float isHead = 1.0 - smoothstep(0.0, 0.3, a_trailPosition);
  v_alpha = mix(0.1, 1.0, isHead) * (0.5 + u_energy * 0.5);

  // Color mix per wisp
  v_colorMix = fract(a_wispIndex * 0.333);

  // Point size: head is larger, trail is smaller
  float size = mix(2.0, 6.0, isHead) + u_energy * 2.0;
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = size * (300.0 / -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
}
