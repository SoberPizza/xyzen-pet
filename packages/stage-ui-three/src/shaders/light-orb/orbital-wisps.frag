// Orbital Wisps fragment shader
// Glowing wisp point sprites.

uniform vec3 u_color1;
uniform vec3 u_color2;

varying float v_alpha;
varying float v_colorMix;

void main() {
  vec2 center = gl_PointCoord - 0.5;
  float dist = length(center);

  // Soft glowing circle
  float glow = exp(-dist * dist * 10.0);
  float softEdge = 1.0 - smoothstep(0.3, 0.5, dist);

  if (softEdge < 0.01) discard;

  vec3 color = mix(u_color1, u_color2, v_colorMix);

  // Bright core
  color += vec3(0.5) * glow;

  gl_FragColor = vec4(color, softEdge * glow * v_alpha);
}
