// Sparkler Core vertex shader
// Billboard quad with offset, shake, and scale animation.
// Simplified from spirit-core.vert (single layer, no multi-depth).

uniform float u_time;
uniform float u_scaleAnimation;
uniform float u_shake;
uniform float u_coreOffsetX;
uniform float u_coreOffsetY;

varying vec2 vUv;

void main() {
  vUv = uv;

  // Billboard: extract camera-right and camera-up from view matrix
  vec3 camRight = vec3(modelViewMatrix[0][0], modelViewMatrix[1][0], modelViewMatrix[2][0]);
  vec3 camUp = vec3(modelViewMatrix[0][1], modelViewMatrix[1][1], modelViewMatrix[2][1]);

  // Scale: breathing animation
  float scale = u_scaleAnimation;

  // Billboard position from centered quad UV
  vec3 billboardPos = (position.x * camRight + position.y * camUp) * scale;

  // Apply core offset (emotion-driven position)
  billboardPos += vec3(u_coreOffsetX, u_coreOffsetY, 0.0);

  // Shake (angry emotion)
  float shakeOffset = u_shake * sin(u_time * 30.0) * 0.03;
  billboardPos.x += shakeOffset;

  vec4 worldPos = modelMatrix * vec4(billboardPos, 1.0);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
