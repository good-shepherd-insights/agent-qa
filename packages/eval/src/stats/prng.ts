// RED contract skeleton; Task 1 supplies the seeded implementation next.
export function xoshiroFromState(_state: [number, number, number, number]) {
  return {
    nextUint32: (): number => 0,
    nextFloat: (): number => 0,
    nextInt: (_min: number, _max: number): number => 0,
    shuffle: <T>(items: readonly T[]): T[] => [...items],
  }
}

export function createSeededRng(_seed: number | string) {
  return xoshiroFromState([0, 0, 0, 0])
}

export type SeededRng = ReturnType<typeof createSeededRng>
