// Spark Rays fragment shader
// Renders each point sprite as an elongated radial streak.
// Bright white at base, emotion-colored at tip.

uniform vec3 u_color1;
uniform vec3 u_color2;
uniform float u_coreBrightness;
uniform float u_time;
uniform float u_flickerSpeed;

varying float v_alpha;
varying float v_colorMix;
varying float v_lifetime;
varying float v_depth;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  // Point sprite UV, centered -1 to 1
  vec2 uv = gl_PointCoord * 2.0 - 1.0;

  // Elongated shape: very narrow on X, extended on Y
  float dx = uv.x * 5.0; // very narrow width
  float dy = uv.y * 1.0;  // full length
  float dist = dx * dx + dy * dy;

  // Tight glow with sharp center line - minimal spread for low-res
  float glow = exp(-dist * 10.0);
  // Hot core line (very thin bright center)
  float coreLine = exp(-dx * dx * 60.0) * exp(-dy * dy * 2.0);

  // Shimmer: sparkle frequency driven by u_flickerSpeed
  float shimmer = 1.0 + sin(u_time * u_flickerSpeed + v_lifetime * 50.0 + uv.y * 10.0) * 0.15;

  // Color: near rays are whiter, far rays shift towards emotion color
  vec3 hotColor = vec3(1.0);
  vec3 coolColor = mix(u_color1, u_color2, v_colorMix);
  float colorShift = smoothstep(0.0, 0.5, dist) + (1.0 - v_depth) * 0.25;
  vec3 color = mix(hotColor, coolColor, clamp(colorShift, 0.0, 1.0));

  // Combine - favor the sharp core line over soft glow, brighter overall
  float intensity = (glow * 0.5 + coreLine * 1.0) * shimmer;
  color *= intensity * u_coreBrightness;

  float alpha = intensity * v_alpha;
  if (alpha < 0.01) discard;

  gl_FragColor = vec4(color, alpha);
}
