/** WolvenKit's regex engine is .NET; depot paths use backslashes, matched literally. */
export function depotPathRegex(paths: readonly string[]): string {
  const literal = (path: string) => path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `^(?:${paths.map(literal).join("|")})$`;
}

