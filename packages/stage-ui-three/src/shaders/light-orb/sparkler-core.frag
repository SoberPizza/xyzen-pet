// Sparkler Core fragment shader
// Concentrated bright point with 4-6 diffraction spikes, shimmer, and audio reactivity.
// Designed for high-contrast Pepper's Ghost projection.

uniform float u_time;
uniform float u_energy;
uniform float u_coreBrightness;
uniform float u_flash;
uniform float u_breathSpeed;
uniform float u_audioLevel;
uniform float u_speakingLevel;
uniform float u_spikeLength;
uniform float u_spikeRotationSpeed;
uniform float u_flickerSpeed;
uniform float u_coreGlowSize;
uniform vec3 u_color1;
uniform vec3 u_color2;

varying vec2 vUv;

#define PI 3.14159265359
#define NUM_SPIKES 6

// Simple hash for shimmer noise
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  // Centered UV, -1 to 1
  vec2 uv = (vUv - 0.5) * 2.0;
  float r = length(uv);

  // Discard far pixels early for performance
  if (r > 1.0) discard;

  float t = u_time;
  float audioInfluence = max(u_audioLevel, u_speakingLevel);

  // 1. Bright central point - steep but visible at ~15% of billboard radius
  float coreIntensity = exp(-r * r * 200.0) * 1.2;

  // Secondary glow halo — u_coreGlowSize controls spread (lower = wider glow)
  float coreGlow = exp(-r * r * u_coreGlowSize) * 0.3;

  // 2. Diffraction spikes - very thin sharp lines radiating from center
  float angle = atan(uv.y, uv.x);
  float spikes = 0.0;
  // High sharpness = very thin angular lines
  float spikeSharpness = 200.0 + u_energy * 100.0;
  // Audio makes spikes longer
  float effectiveSpikeLength = u_spikeLength * (1.0 + audioInfluence * 0.4);

  for (int i = 0; i < NUM_SPIKES; i++) {
    float spikeAngle = float(i) * PI / float(NUM_SPIKES);
    // Rotate spikes — speed varies per emotion
    spikeAngle += t * u_spikeRotationSpeed;
    float angDist = abs(sin(angle - spikeAngle));
    // Very thin spike profile
    float spikeProfile = exp(-angDist * angDist * spikeSharpness);
    // Radial falloff - spikes extend visibly but stay narrow
    float radialFade = exp(-r * effectiveSpikeLength * 3.0);
    spikes += spikeProfile * radialFade;
  }
  spikes *= 0.4 * u_energy;

  // 3. Shimmer — frequency driven by u_flickerSpeed
  float flickerT = t * u_flickerSpeed / 15.0;
  float shimmerSeed = hash(uv * 20.0 + vec2(flickerT * 3.0, flickerT * 2.7));
  float shimmer = smoothstep(0.8, 1.0, shimmerSeed) * exp(-r * r * 20.0) * 0.2;
  // Extra shimmer pulses on spikes
  float spikeShimmer = smoothstep(0.7, 1.0, hash(uv * 30.0 + vec2(flickerT * 7.0)))
                      * spikes * 0.3;

  // 4. Breathing modulation
  float breath = 0.92 + 0.08 * sin(t * u_breathSpeed);

  // 5. Color: white center -> color1 mid -> color2 at spike tips
  float colorBlend = smoothstep(0.0, 0.15, r);
  vec3 innerColor = mix(vec3(1.0), u_color1, colorBlend);
  vec3 spikeColor = mix(u_color1, u_color2, smoothstep(0.05, 0.4, r));

  // Combine layers
  vec3 color = vec3(0.0);
  color += innerColor * (coreIntensity + coreGlow); // bright center
  color += spikeColor * spikes;                      // diffraction spikes
  color += u_color1 * shimmer;                       // sparkle noise
  color += u_color2 * spikeShimmer;                  // spike shimmer

  // Energy and brightness modulation
  color *= (0.5 + u_energy * 0.5) * u_coreBrightness * breath;

  // Flash pulse (surprised emotion)
  color += vec3(1.0) * u_flash * 0.5;

  // Audio pulse: core brightens with audio
  color *= 1.0 + audioInfluence * 0.2;

  // Alpha: tight falloff - only visible where there's actual content
  float alpha = coreIntensity + coreGlow * 0.6 + spikes * 0.6 + shimmer;
  alpha = clamp(alpha, 0.0, 1.0);

  gl_FragColor = vec4(color, alpha);
}
