// Spark Particles fragment shader
// Sharp glowing point sprites that transition from white-hot to emotion-colored as they age.
// Designed for high-contrast Pepper's Ghost rendering.

uniform vec3 u_color1;
uniform vec3 u_color2;
uniform float u_time;

varying float v_alpha;
varying float v_colorMix;
varying float v_age;
varying float v_depth;

void main() {
  // Point sprite UV, centered 0 to 1
  vec2 uv = gl_PointCoord;
  float dist = length(uv - 0.5) * 2.0; // 0 at center, 1 at edge

  // Very sharp glowing circle - crisp point for low-res display
  float glow = exp(-dist * dist * 20.0);

  // Tight bright core
  float core = exp(-dist * dist * 80.0);

  // Combine: near particles are white-hot, far particles shift to emotion color
  vec3 hotColor = vec3(1.0);
  vec3 coolColor = mix(u_color1, u_color2, v_age);

  // Depth-based color temperature: near=white, far=colored (enhances 3D)
  float colorShift = v_age + (1.0 - v_depth) * 0.3;
  vec3 particleColor = mix(hotColor, coolColor, clamp(colorShift, 0.0, 1.0));

  vec3 color = particleColor * (core * 0.8 + glow * 0.4);

  // Young particles shimmer slightly
  float shimmer = 1.0 + sin(u_time * 15.0 + v_age * 30.0) * (1.0 - v_age) * 0.1;
  color *= shimmer;

  float alpha = (core * 0.8 + glow * 0.3) * v_alpha;
  if (alpha < 0.01) discard;

  gl_FragColor = vec4(color, alpha);
}
