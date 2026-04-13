// Energy Particles fragment shader
// Soft point sprites with color blending.

uniform vec3 u_color1;
uniform vec3 u_color2;

varying float v_alpha;
varying float v_colorMix;

void main() {
  // Circular point sprite with soft falloff
  vec2 center = gl_PointCoord - 0.5;
  float dist = length(center);
  float softCircle = 1.0 - smoothstep(0.3, 0.5, dist);

  if (softCircle < 0.01) discard;

  vec3 color = mix(u_color1, u_color2, v_colorMix);

  // Slight glow at center
  float glow = exp(-dist * dist * 8.0) * 0.3;
  color += glow;

  gl_FragColor = vec4(color, softCircle * v_alpha);
}
