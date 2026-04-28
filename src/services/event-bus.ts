/**
 * Module-level singleton bus for Xyzen WS events.
 *
 * Producers (ws.ts, http.ts) emit onto this bus; consumers (the VRM
 * bridge composable, future UI) subscribe via typed eventa channels.
 */

export interface Eventa<T = unknown> {
  readonly name: string
  /** Phantom type brand — not used at runtime */
  readonly _type?: T
}

export function defineEventa<T = void>(name: string): Eventa<T> {
  return { name } as Eventa<T>
}

type Listener<T> = (payload: T) => void

export interface EventaContext {
  emit: <T>(eventa: Eventa<T>, payload: T) => void
  on: <T>(eventa: Eventa<T>, listener: Listener<T>) => () => void
}

function createContext(): EventaContext {
  const listeners = new Map<string, Set<Listener<unknown>>>()

  function on<T>(eventa: Eventa<T>, listener: Listener<T>): () => void {
    const key = eventa.name
    if (!listeners.has(key))
      listeners.set(key, new Set())
    listeners.get(key)!.add(listener as Listener<unknown>)
    return () => {
      listeners.get(key)?.delete(listener as Listener<unknown>)
    }
  }

  function emit<T>(eventa: Eventa<T>, payload: T): void {
    listeners.get(eventa.name)?.forEach(l => l(payload))
  }

  return { on, emit }
}

export const xyzenBus = createContext()
