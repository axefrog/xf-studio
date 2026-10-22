/**
 * One request from the page to its own host, answered as status and parsed JSON (null when the body isn't JSON). The page's host
 * devices (the desktop-app offer, the update check) share it, so none imports another device.
 */
export async function hostRequest(endpoint: string, init?: RequestInit) {
  const response = await fetch(endpoint, init);
  return { ok: response.ok, status: response.status, data: await response.json().catch(() => null) };
}
