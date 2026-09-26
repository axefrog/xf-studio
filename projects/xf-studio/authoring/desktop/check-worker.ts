// The desktop's Check worker entry: the export host's shared worker (tools/package_check_worker.ts), bundled into the
// view as check-worker.js by prepare-static.ts. One request per worker; the host terminates it after its answer or deadline.
import "../tools/package_check_worker";
