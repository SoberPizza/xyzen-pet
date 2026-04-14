// Aura particles vertex shader: billboard points orbiting creature
attribute float a_phase;
attribute float a_speed;
attribute float a_radius;

uniform float u_time;
uniform float u_energy;
uniform float u_auraBrightness;

varying float v_alpha;
varying float v_age;

void main() {
  float angle = u_time * a_speed + a_phase * 6.2832;
  float r = a_radius * (0.8 + 0.2 * sin(u_time * 0.5 + a_phase * 3.14));

  vec3 pos = vec3(
    cos(angle) * r,
    sin(u_time * 0.7 + a_phase * 4.0) * 0.3 + sin(angle * 0.5) * 0.15,
    sin(angle) * r
  );

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  // Point size with distance attenuation
  float size = (3.0 + a_radius * 4.0) * u_energy;
  gl_PointSize = size * (80.0 / -mvPosition.z);

  // Pulsing alpha
  float pulse = 0.7 + 0.3 * sin(u_time * 2.0 + a_phase * 6.2832);
  v_alpha = pulse * u_auraBrightness * u_energy;
  v_age = fract(u_time * 0.1 + a_phase);
}
