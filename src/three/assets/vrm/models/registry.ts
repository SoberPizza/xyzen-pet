import type { AnimationDriver } from '../../../composables/vrm/animation-driver'

export interface ModelAsset {
  url: string
  driver?: AnimationDriver
}

const vrmUrls = import.meta.glob('./*/*.vrm', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

const driverModules = import.meta.glob('./*/animation-driver.ts', {
  eager: true,
}) as Record<string, { driver: AnimationDriver }>

// Keyed on the bare `.vrm` filename — matches `BuddyCoreDTO.vrm_model`
// emitted by the backend as `"<race_code>_<stage>.vrm"`.
const assets = new Map<string, ModelAsset>()
for (const [path, url] of Object.entries(vrmUrls)) {
  const parts = path.split('/')
  const filename = parts[parts.length - 1]
  const folder = parts[parts.length - 2]
  if (!filename || !folder) continue
  const driverPath = `./${folder}/animation-driver.ts`
  assets.set(filename, { url, driver: driverModules[driverPath]?.driver })
}

export function resolveVrmAsset(vrmModel: string): ModelAsset | undefined {
  return assets.get(vrmModel)
}
