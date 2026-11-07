/**
 * A generated sidecar type (sidecar-types.generated.ts) with some fields narrowed to what the UI knows about them, such
 * as a closed set of strings. Each key in N must be a field of T and each narrowed type must fit T's, so renaming or
 * retyping the field in the C# record stops this compiling instead of drifting.
 */
export type Narrow<T, N extends { [K in keyof N]: K extends keyof T ? T[K] : never }> = Omit<T, keyof N> & N;
