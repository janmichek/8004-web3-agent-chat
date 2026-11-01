/** `--flag value` parsing shared by the CLI entry points. */
const args = process.argv.slice(2);

export function getFlag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith("--") ? args[idx + 1] : undefined;
}

export function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}
