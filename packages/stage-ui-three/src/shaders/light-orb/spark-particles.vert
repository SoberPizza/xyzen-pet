// Spark Particles vertex shader
// ~350 particles shooting outward from center with gravity arc.
// Each particle has a looping lifecycle: spawn at center -> fly outward -> fade -> respawn.

attribute float a_index;
attribute float a_phase;
attribute float a_theta;      // azimuthal angle
attribute float a_phi;        // polar angle
attribute float a_speed;
attribute float a_lifetime;   // total lifecycle duration (seconds)
attribute float a_size;

uniform float u_time;
uniform float u_energy;
uniform float u_orbitSpeed;
uniform float u_coreOffsetX;
uniform float u_coreOffsetY;
uniform float u_audioLevel;
uniform float u_speakingLevel;
uniform float u_gravity;
uniform float u_particleSpread;
uniform float u_rayMaxLength;
uniform float u_tangentialSpeed;
uniform float u_pulseRate;

varying float v_alpha;
varying float v_colorMix;
varying float v_age;
varying float v_depth;

#define PI 3.14159265359
#define PI2 6.28318530718

void main() {
  // Lifecycle: continuous looping based on particle's own lifetime
  float cycleTime = u_time * u_orbitSpeed;
  float age = fract(cycleTime / a_lifetime + a_phase); // 0 -> 1

  // Direction in 3D from spherical coordinates
  float sinPhi = sin(a_phi);
  float cosPhi = cos(a_phi);
  vec3 dir = vec3(
    sinPhi * cos(a_theta),
    cosPhi,
    sinPhi * sin(a_theta)
  );

  // Spread control: narrows or widens the emission cone
  dir = normalize(mix(vec3(0.0, 1.0, 0.0), dir, u_particleSpread));

  // Outward distance: increases with age
  float audioInfluence = max(u_audioLevel, u_speakingLevel);
  float dist = age * a_speed * u_energy * u_rayMaxLength * 1.2;
  dist *= 1.0 + audioInfluence * 0.3;

  // Pulse rate: rhythmic expansion/contraction (disgust nausea, angry throb)
  if (u_pulseRate > 0.01) {
    dist *= 1.0 + sin(u_time * u_pulseRate * PI2) * 0.15;
  }

  // Position: radial outward from center
  vec3 center = vec3(u_coreOffsetX, u_coreOffsetY, 0.0);
  vec3 pos = center + dir * dist;

  // Tangential speed: spiral/orbital motion (think vortex, happy spiral)
  if (u_tangentialSpeed > 0.01) {
    vec3 up = vec3(0.0, 1.0, 0.0);
    vec3 tangent = normalize(cross(dir, up));
    // Avoid degenerate cross when dir is parallel to up
    if (length(cross(dir, up)) < 0.01) {
      tangent = normalize(cross(dir, vec3(1.0, 0.0, 0.0)));
    }
    pos += tangent * u_tangentialSpeed * dist;
  }

  // Gravity: quadratic downward pull (accumulates with age)
  pos.y -= age * age * u_gravity * 2.0;

  // Alpha: bright at spawn, quadratic fade with age
  float ageFade = (1.0 - age) * (1.0 - age);
  v_alpha = ageFade * (0.2 + u_energy * 0.5);

  // Audio boost: particles are brighter during audio
  v_alpha *= 1.0 + audioInfluence * 0.2;

  // Color: young particles are whiter (hotter), aging particles take emotion color
  v_colorMix = age;
  v_age = age;

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);

  // 3D depth cue: near particles brighter/larger, far particles dimmer/smaller
  // At camera distance 1.4, stronger depth separation
  float depthFactor = smoothstep(-2.8, -0.2, mvPosition.z); // 0=far, 1=near
  v_depth = depthFactor;
  v_alpha *= 0.15 + depthFactor * 0.85; // far particles fade to 15%

  // Point size: perspective + amplified depth emphasis
  float sizeFade = 1.0 - age * 0.7;
  float depthSize = 0.3 + depthFactor * 0.7; // far=30% size, near=100%
  gl_PointSize = clamp(a_size * sizeFade * depthSize * (0.4 + u_energy * 0.5) * (80.0 / -mvPosition.z), 0.5, 24.0);
  gl_Position = projectionMatrix * mvPosition;
}
