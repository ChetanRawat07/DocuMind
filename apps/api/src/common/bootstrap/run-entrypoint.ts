/**
 * Runs a process entrypoint and turns startup failures into a non-zero exit
 * with a readable message instead of an unhandled promise rejection.
 */
export function runEntrypoint(name: string, bootstrap: () => Promise<void>): void {
  bootstrap().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[DocuMind:${name}] Failed to start: ${message}\n`);
    process.exitCode = 1;
  });
}
