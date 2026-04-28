import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  project: ['src/**/*.{ts,vue}', 'tests/**/*.ts'],
  ignoreExportsUsedInFile: true,
}

export default config
