// Wireframe glow vertex shader: passes normal and position to fragment
varying vec3 vNormal;
varying vec3 vPosition;
varying float vEdgeFactor;

uniform float u_time;
uniform float u_breathSpeed;
uniform float u_bodyBounce;
uniform float u_bodySquash;

void main() {
  vNormal = normalize(normalMatrix * normal);
  vPosition = position;

  // Breathing animation: subtle scale pulse
  float breath = 1.0 + 0.03 * sin(u_time * u_breathSpeed * 6.2832);

  // Body squash-and-stretch
  vec3 pos = position;
  pos.y *= u_bodySquash * breath;
  pos.x *= (2.0 - u_bodySquash) * breath;
  pos.z *= (2.0 - u_bodySquash) * breath;

  // Bounce offset
  pos.y += u_bodyBounce * abs(sin(u_time * 3.0));

  // Edge factor for wireframe glow falloff
  vEdgeFactor = abs(dot(vNormal, vec3(0.0, 0.0, 1.0)));

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
