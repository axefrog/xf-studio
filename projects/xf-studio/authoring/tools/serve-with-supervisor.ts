/**
 * Runs the localhost server (server.ts) and exits once the process named by XFS_SUPERVISOR_PID is gone.
 *
 * `tools/serve-unpackaged.ps1` starts this outside the launching app's container. The supervisor is the script itself, which a
 * dev tool can stop. Without this check, the server would outlive it and keep holding the port.
 */
const supervisor = Number(process.env.XFS_SUPERVISOR_PID);
if (Number.isInteger(supervisor) && supervisor > 0) {
  setInterval(() => {
    try { process.kill(supervisor, 0); }
    catch { process.exit(0); }
  }, 2_000).unref();
}
await import("../server.ts");
export {};
