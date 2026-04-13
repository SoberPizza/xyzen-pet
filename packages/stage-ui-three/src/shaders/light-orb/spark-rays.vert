// Spark Rays vertex shader
// ~80-120 radiating spark lines from center, each as an elongated point sprite.
// Each ray has a lifecycle: spawn -> grow outward -> shrink -> respawn.

attribute float a_index;
attribute float a_phase;
attribute float a_angleTheta;  // azimuthal angle (XZ plane)
attribute float a_anglePhi;    // polar angle (from Y axis)
attribute float a_speed;
attribute float a_maxLength;

uniform float u_time;
uniform float u_energy;
uniform float u_orbitSpeed;
uniform float u_coreOffsetX;
uniform float u_coreOffsetY;
uniform float u_audioLevel;
uniform float u_speakingLevel;
uniform float u_rayMaxLength;
uniform float u_rayDensity;
uniform float u_pulseRate;

varying float v_alpha;
varying float v_colorMix;
varying float v_lifetime;
varying float v_depth;

#define PI 3.14159265359
#define PI2 6.28318530718

void main() {
  // Lifecycle: each ray cycles through grow -> shrink
  float cycleSpeed = u_orbitSpeed * a_speed * 0.5;
  float lifetime = fract(u_time * cycleSpeed + a_phase);

  // Sinusoidal grow/shrink: peaks at lifetime=0.5
  float lengthFactor = sin(lifetime * PI);

  // Ray density controls visibility (hide some rays when density < 1)
  float visThreshold = 1.0 - u_rayDensity;
  float visible = step(visThreshold, fract(a_index * 0.618));

  // Audio reactivity: rays extend further with audio
  float audioInfluence = max(u_audioLevel, u_speakingLevel);
  float rayLen = a_maxLength * u_energy * u_rayMaxLength * lengthFactor;
  rayLen *= 1.0 + audioInfluence * 0.5;

  // Pulse rate: rhythmic ray length modulation
  if (u_pulseRate > 0.01) {
    rayLen *= 1.0 + sin(u_time * u_pulseRate * PI2) * 0.2;
  }

  // Direction in 3D from spherical coordinates
  float sinPhi = sin(a_anglePhi);
  float cosPhi = cos(a_anglePhi);
  float sinTheta = sin(a_angleTheta);
  float cosTheta = cos(a_angleTheta);
  vec3 dir = vec3(
    sinPhi * cosTheta,
    cosPhi,
    sinPhi * sinTheta
  );

  // Position at the midpoint of the ray (so the point sprite covers the full ray)
  vec3 center = vec3(u_coreOffsetX, u_coreOffsetY, 0.0);
  vec3 pos = center + dir * rayLen * 0.5;

  // Alpha: peaks mid-lifecycle, fades at birth and death
  float ageFade = sin(lifetime * PI);
  v_alpha = ageFade * (0.2 + u_energy * 0.4) * visible;

  // Color mix: based on distance from center (inner = white, outer = colored)
  v_colorMix = lifetime;
  v_lifetime = lifetime;

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);

  // 3D depth cue: near rays are brighter/larger, far rays are dimmer/smaller
  // At camera distance 1.4, mvPosition.z ranges roughly -0.4 (near) to -2.4 (far)
  float depthFactor = smoothstep(-2.8, -0.2, mvPosition.z); // 0=far, 1=near
  v_depth = depthFactor;
  v_alpha *= 0.15 + depthFactor * 0.85; // far rays fade to 15% (stronger contrast)

  // Point size: perspective + amplified depth emphasis
  float baseSize = 1.5 + rayLen * 3.0 + u_energy * 1.5;
  float depthSize = 0.4 + depthFactor * 0.6; // far=40% size, near=100%
  gl_PointSize = clamp(baseSize * depthSize * (80.0 / -mvPosition.z) * visible, 0.0, 36.0);
  gl_Position = projectionMatrix * mvPosition;
}
