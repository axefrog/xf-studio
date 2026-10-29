/** Queue order only: a request already executing finishes; no priority waits for another operation to complete. */
export type NativePriority = "person" | "shown" | "background";

export interface PrioritisedNativeRequest {
  /** Initial priority; shared reads can inherit a higher consumer's. Absent: shown/default FIFO; background serves ahead work. */
  readonly priority?: NativePriority;
}
