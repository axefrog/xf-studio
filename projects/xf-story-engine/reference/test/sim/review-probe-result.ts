/** A named failing test alone is insufficient: its assertion must report the intended semantic failure. */
export function semanticFailure(exitCode: number, output: string, name: string): boolean {
  const lines = output.split(/\r?\n/);
  return exitCode !== 0 && lines.some((line) => line.startsWith('(fail) ') && (line.startsWith(`(fail) ${name}:`) || line.includes(` > ${name}:`))) && lines.some((line) => line.startsWith(`error: ${name} semantic:`));
}
