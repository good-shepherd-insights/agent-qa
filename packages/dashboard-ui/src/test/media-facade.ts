export interface MediaFacade {
  currentTime: number
  readonly duration: number
  readonly paused: boolean
  playbackRate: number
  readonly seekable: Pick<TimeRanges, 'length' | 'end'>
  play(): Promise<void>
  pause(): void
  addEventListener(type: string, listener: EventListener): void
  removeEventListener(type: string, listener: EventListener): void
}

export function createFakeMedia(duration = 60) {
  const events = new EventTarget()
  let paused = true
  let time = 0
  const seeks: number[] = []
  return {
    get currentTime() { return time },
    set currentTime(value: number) { time = value; seeks.push(value) },
    duration,
    get paused() { return paused },
    playbackRate: 1,
    seekable: { length: 1, end: () => duration },
    async play() { paused = false; events.dispatchEvent(new Event('play')) },
    pause() { paused = true; events.dispatchEvent(new Event('pause')) },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    fire(type: 'loadedmetadata' | 'timeupdate' | 'ended' | 'error', at?: number) {
      if (at !== undefined) time = at
      if (type === 'ended') paused = true
      events.dispatchEvent(new Event(type))
    },
    seeks,
  } satisfies MediaFacade & { fire: unknown; seeks: number[] }
}
