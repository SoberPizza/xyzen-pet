// Spirit Core fragment shader
// Volumetric sphere illusion via fake normals, Fresnel rim, orbiting light,
// specular highlight, subsurface scattering, internal energy veins, and depth color gradient.

uniform float u_time;
uniform float u_energy;
uniform float u_opacityScale;
uniform float u_breathSpeed;
uniform float u_coreBrightness;
uniform float u_flash;
uniform float u_audioLevel;
uniform float u_speakingLevel;
uniform vec3 u_color1;
uniform vec3 u_color2;

varying vec2 vUv;

// Simplex-ish noise helper
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise2d(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  // Centered UV, -1 to 1
  vec2 centeredUv = (vUv - 0.5) * 2.0;
  float r = length(centeredUv);

  // 1. Sphere mask: smooth circular silhouette
  float sphereMask = smoothstep(0.5, 0.42, r / 2.0);
  if (sphereMask < 0.001) discard;

  // 2. Fake sphere normal from UV
  float r2 = dot(centeredUv, centeredUv);
  float nzSq = 1.0 - min(r2, 1.0);
  float nz = sqrt(nzSq);
  vec3 N = normalize(vec3(centeredUv, nz));

  // View direction (camera looking down -Z in view space, billboard faces camera)
  vec3 V = vec3(0.0, 0.0, 1.0);
  float NdotV = max(dot(N, V), 0.0);

  // 3. Fresnel rim glow: THE strongest 3D cue
  float fresnel = pow(1.0 - NdotV, 3.5) * 0.8;

  // 4. Orbiting directional light
  float t = u_time;
  vec3 L = normalize(vec3(cos(t * 0.4), 0.4, sin(t * 0.4)));
  float NdotL = max(dot(N, L), 0.0);
  float diffuse = NdotL * 0.6;

  // 5. Blinn-Phong specular highlight
  vec3 H = normalize(L + V);
  float NdotH = max(dot(N, H), 0.0);
  float specular = pow(NdotH, 48.0) * 0.6;

  // 6. Subsurface scattering: light through the back
  float sss = pow(max(dot(-N, L), 0.0), 2.0) * 0.3;

  // 7. Internal energy veins (animated sin patterns in spherical coords)
  float theta = atan(N.y, N.x);
  float phi = acos(N.z);
  float veinPattern = 0.0;
  veinPattern += sin(theta * 6.0 + t * 0.8) * sin(phi * 5.0 - t * 0.6) * 0.3;
  veinPattern += sin(theta * 3.0 - t * 1.2 + phi * 4.0) * 0.2;
  veinPattern += noise2d(vec2(theta * 2.0 + t * 0.3, phi * 3.0 - t * 0.2)) * 0.25;
  // Veins stronger at center
  veinPattern *= (1.0 - r * 0.7);
  veinPattern = max(0.0, veinPattern);

  // Audio reactivity: veins pulse with audio
  float audioInfluence = max(u_audioLevel, u_speakingLevel);
  veinPattern *= 1.0 + audioInfluence * 0.5;

  // 8. Depth color gradient: center warm, edges cool
  vec3 bodyColor = mix(u_color2, u_color1, nz);

  // 9. Core bright center
  float coreBright = exp(-r2 * 20.0) * 0.5 * u_coreBrightness;

  // Breathing modulation
  float breath = 0.95 + 0.05 * sin(t * u_breathSpeed);

  // Combine all lighting contributions
  vec3 color = bodyColor * (diffuse + 0.2); // base diffuse + ambient
  color += u_color1 * fresnel; // rim glow in primary color
  color += vec3(1.0) * specular; // white specular highlight
  color += u_color2 * sss; // subsurface in secondary color
  color += mix(u_color1, u_color2, 0.5) * veinPattern; // internal veins
  color += u_color1 * coreBright; // bright core center

  // Energy modulation
  color *= 0.7 + u_energy * 0.3;

  // Breathing
  color *= breath;

  // Flash pulse (surprised emotion)
  color += vec3(1.0) * u_flash * 0.5;

  // Final opacity: sphere mask * layer opacity
  float alpha = sphereMask * u_opacityScale;

  // Rim glow adds to alpha for visible glowing edges
  alpha += fresnel * u_opacityScale * 0.5;
  alpha = min(alpha, 1.0);

  gl_FragColor = vec4(color, alpha);
}
