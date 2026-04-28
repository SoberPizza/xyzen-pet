/**
 * Bundled VRM animation clips (`.vrma`).
 *
 * Exposes each clip as a Vite-resolved `URL` so it can be passed to
 * `@pixiv/three-vrm-animation`'s loader. Add new clips by dropping the
 * `.vrma` alongside this file and extending the map.
 */

export const animations = {
  idleLoop: new URL('./idle_loop.vrma', import.meta.url),
}
