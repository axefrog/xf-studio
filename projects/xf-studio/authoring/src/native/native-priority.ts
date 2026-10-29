/** Queue order only: a request already executing finishes; no priority waits for another operation to complete. */
export type NativePriority = "person" | "shown" | "background";

export interface PrioritisedNativeRequest {
  /** Absent: ordinary FIFO. `background` serves ahead work; person requests precede shown requests and both precede background. */
  readonly priority?: NativePriority;
}
