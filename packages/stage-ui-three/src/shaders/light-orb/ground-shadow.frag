// Ground shadow fragment shader (enhanced)
// Stronger opacity, more prominent tint, better height linkage.

uniform vec3 u_color1;
uniform float u_coreOffsetY;

varying vec2 vUv;

void main() {
  vec2 center = vUv - 0.5;
  float dist = length(center);

  // Radial gaussian falloff -- stronger base opacity (0.45)
  float shadow = exp(-dist * dist * 10.0) * 0.45;

  // Soft outer ring for larger visible area
  shadow += exp(-dist * dist * 4.0) * 0.08;

  // Reduce opacity as spirit rises higher (stronger linkage)
  float heightFade = 1.0 - clamp(u_coreOffsetY * 0.7, 0.0, 0.7);
  shadow *= heightFade;

  if (shadow < 0.005) discard;

  // More prominent tint from spirit color
  vec3 shadowColor = u_color1 * 0.15;

  gl_FragColor = vec4(shadowColor, shadow);
}
