// Wireframe glow fragment shader: emissive color with breathing pulse
precision mediump float;

varying vec3 vNormal;
varying vec3 vPosition;
varying float vEdgeFactor;

uniform float u_time;
uniform float u_breathSpeed;
uniform float u_glowIntensity;
uniform vec3 u_color1;
uniform vec3 u_color2;

void main() {
  // Mix colors based on vertical position (head lighter, body darker)
  float heightGrad = smoothstep(-0.5, 0.8, vPosition.y);
  vec3 baseColor = mix(u_color2, u_color1, heightGrad);

  // Breathing pulse on glow
  float breath = 0.92 + 0.08 * sin(u_time * u_breathSpeed * 6.2832);

  // Edge glow: brighter at silhouette edges (Fresnel-like)
  float edgeGlow = 1.0 - vEdgeFactor;
  edgeGlow = pow(edgeGlow, 1.5);
  float glow = (0.4 + 0.6 * edgeGlow) * u_glowIntensity * breath;

  gl_FragColor = vec4(baseColor * glow, glow * 0.9);
}
