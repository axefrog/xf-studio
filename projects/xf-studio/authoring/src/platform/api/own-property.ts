/**
 * Writing a key read from a file (a mod's YAML, a resource's property name, a save's field) into a plain object. An assignment
 * `out[key] = value` with the key `__proto__` doesn't make a property: it replaces the object's prototype, so the value's own
 * properties then answer for keys the object lacks. `setOwn` always defines an ordinary own data property instead, as `JSON.parse`
 * does, so every key (`__proto__`, `constructor` and `prototype` included) stays data and the object keeps its normal prototype.
 * Pure: no imports, so any module may use it.
 */
export function setOwn<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
}
