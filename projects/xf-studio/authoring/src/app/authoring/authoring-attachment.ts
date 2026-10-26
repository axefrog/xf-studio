/** A stable device input over the explicitly attached editing context. It owns no document or history. */
export function authoringAttachment<T extends object>(read: () => T, channels: Readonly<Record<string, readonly unknown[] | undefined>> = {}) {
  const subscriptions = new Set<{ key: string; listener: (...args: unknown[]) => void; off: () => void }>();
  const methods = new Map<PropertyKey, (...args: never[]) => unknown>();
  const port = new Proxy({} as T, {
    get(_target, key) {
      if (typeof key === "string" && Object.hasOwn(channels, key)) return (listener: (...args: unknown[]) => void) => {
        const source = read() as Record<string, (listener: (...args: unknown[]) => void) => () => void>;
        const entry = { key, listener, off: source[key]!.call(source, listener) };
        subscriptions.add(entry);
        return () => { entry.off(); subscriptions.delete(entry); };
      };
      const value = Reflect.get(read(), key);
      if (typeof value !== "function") return value;
      if (!methods.has(key)) methods.set(key, (...args: never[]) => { const source = read(); const method = Reflect.get(source, key) as (...args: unknown[]) => unknown; return method.apply(source, args); });
      return methods.get(key);
    },
    set(_target, key, value) { return Reflect.set(read(), key, value); },
  });
  return { port,
    changing() { for (const entry of [...subscriptions]) if (entry.key === "onReplacing") entry.listener(); },
    changed() {
      for (const entry of [...subscriptions]) {
        entry.off();
        const source = read() as Record<string, (listener: (...args: unknown[]) => void) => () => void>;
        entry.off = source[entry.key]!.call(source, entry.listener);
      }
      for (const entry of [...subscriptions]) { const args = channels[entry.key]; if (args) entry.listener(...args); }
    },
    dispose() { for (const entry of subscriptions) entry.off(); subscriptions.clear(); },
  };
}
