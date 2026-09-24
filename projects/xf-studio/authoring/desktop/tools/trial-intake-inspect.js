(async () => {
  const wait = async (test, label, timeout = 30000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) { if (test()) return; await new Promise(resolve => setTimeout(resolve, 150)); }
    throw Error(`Timed out: ${label}`);
  };
  document.querySelector('#desktop-intake-open').click();
  const input = document.querySelector('#desktop-intake-folder');
  input.value = __PREPARED_PATH__;
  document.querySelector('#desktop-intake-inspect').click();
  await wait(() => !document.querySelector('#desktop-intake-import').disabled, 'prepared input accepted');
  const result = { native: Boolean(window.__electrobunWebviewId), ready: !document.querySelector('#desktop-intake-import').disabled,
    diagnostics: document.querySelector('#desktop-intake-status')?.textContent?.slice(0, 650) };
  if (!result.native || !result.ready) throw Error(JSON.stringify(result));
  return result;
})()
