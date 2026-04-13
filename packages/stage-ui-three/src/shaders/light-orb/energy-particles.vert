// Energy Particles vertex shader
// ~200 particles orbiting on 3D tilted paths around the sphere surface.

attribute float a_index;
attribute float a_speed;
attribute float a_radius;
attribute float a_phase;
attribute float a_tilt;

uniform float u_time;
uniform float u_energy;
uniform float u_orbitSpeed;
uniform float u_coreOffsetX;
uniform float u_coreOffsetY;
uniform float u_audioLevel;
uniform float u_speakingLevel;

varying float v_alpha;
varying float v_colorMix;

void main() {
  float t = u_time * u_orbitSpeed * a_speed;

  // Spherical orbit: each particle has unique radius, tilt, and phase
  float angle = t + a_phase;
  float tiltRad = a_tilt * 3.14159;

  // 3D position on tilted circular orbit around sphere
  float orbRadius = a_radius * (0.5 + u_energy * 0.3);

  // Audio reactivity: particles expand/contract
  float audioInfluence = max(u_audioLevel, u_speakingLevel);
  orbRadius *= 1.0 + audioInfluence * 0.2;

  vec3 pos;
  pos.x = cos(angle) * orbRadius;
  pos.y = sin(angle) * orbRadius * cos(tiltRad) + sin(angle * 0.3) * 0.1;
  pos.z = sin(angle) * orbRadius * sin(tiltRad);

  // Apply core offset
  pos.x += u_coreOffsetX;
  pos.y += u_coreOffsetY;

  // Alpha: based on distance from center and energy
  v_alpha = (0.3 + u_energy * 0.5) * (0.5 + 0.5 * sin(t * 2.0 + a_phase));

  // Color mix: varies per particle for visual variety
  v_colorMix = fract(a_index * 0.618 + sin(t * 0.3) * 0.2);

  // Point size: distance-aware
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = (2.5 + u_energy * 2.0) * (300.0 / -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
}
