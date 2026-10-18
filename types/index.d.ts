/** Background task ids the main loop started and has not been notified about. */
export type Pending = string[]

declare module 'claude-code' {
  interface PluginState {
    beacon: {
      /**
       * Host state lives as long as the process, as the tasks do: a hot reload keeps it, a
       * restart drops both.
       */
      pending: Pending
    }
  }
}
