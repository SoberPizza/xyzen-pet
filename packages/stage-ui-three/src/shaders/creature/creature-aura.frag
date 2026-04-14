// Aura particles fragment shader: soft glowing points
precision mediump float;

varying float v_alpha;
varying float v_age;

uniform vec3 u_color1;
uniform vec3 u_color2;

void main() {
  // Circular point with soft glow falloff
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float dist = length(uv);
  float glow = exp(-dist * dist * 8.0);

  // Color gradient based on age
  vec3 color = mix(u_color1, u_color2, v_age);

  float alpha = glow * v_alpha;
  if (alpha < 0.01) discard;

  gl_FragColor = vec4(color * alpha, alpha);
}
