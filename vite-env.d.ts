/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_XYZEN_BACKEND_URL?: string
  readonly VITE_AUTH_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<{}, {}, any>
  export default component
}

declare module '*.vrma' {
  const url: string
  export default url
}

declare module '*.hdr' {
  const url: string
  export default url
}

declare module '*.frag' {
  const src: string
  export default src
}

declare module '*.vert' {
  const src: string
  export default src
}

declare module '*.json' {
  const value: any
  export default value
}
