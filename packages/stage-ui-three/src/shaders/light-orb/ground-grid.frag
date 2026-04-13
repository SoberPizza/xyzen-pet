// Ground Grid fragment shader
// Concentric rings and cross lines for perspective reference.

uniform float u_time;
uniform vec3 u_color1;

varying vec2 vUv;

void main() {
  vec2 center = vUv - 0.5;
  float dist = length(center);

  // Concentric rings
  float rings = smoothstep(0.02, 0.0, abs(fract(dist * 6.0) - 0.5) - 0.46);

  // Cross lines (2 perpendicular thin lines through center)
  float crossX = smoothstep(0.005, 0.0, abs(center.y));
  float crossY = smoothstep(0.005, 0.0, abs(center.x));
  float cross = max(crossX, crossY) * 0.04;

  // Ring opacity: fades with distance from center
  float ringFade = 1.0 - smoothstep(0.1, 0.5, dist);
  float ringAlpha = rings * 0.06 * ringFade;

  float totalAlpha = ringAlpha + cross;

  // Subtle pulse
  totalAlpha *= 0.8 + 0.2 * sin(u_time * 0.5);

  if (totalAlpha < 0.002) discard;

  // Subtle color tint from spirit
  vec3 color = u_color1 * 0.3 + vec3(0.1);

  gl_FragColor = vec4(color, totalAlpha);
}
