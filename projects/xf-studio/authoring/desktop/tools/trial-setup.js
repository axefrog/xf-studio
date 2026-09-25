(async () => {
  const values = __SETUP_FIELDS__;
  const port = window.xfStudioPresentation;
  const button = text => [...document.querySelectorAll('button')].find(node => node.textContent?.trim() === text);
  const wait = async (test, label, timeout = 30000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) { if (test()) return; await new Promise(resolve => setTimeout(resolve, 150)); }
    throw Error(`Timed out: ${label}`);
  };
  document.querySelector('#dock-tab-package').click();
  const details = [...document.querySelectorAll('details')].find(node => node.querySelector('summary')?.textContent === 'Local setup');
  details.open = true;
  const labels = { gameRoot: 'Cyberpunk 2077 folder',
    wolvenKitCli: 'WolvenKit CLI executable',
    bunExecutable: 'Bun executable (optional)' };
  for (const key of ['gameRoot', 'wolvenKitCli', 'bunExecutable']) {
    const input = details.querySelector(`input[aria-label="${labels[key]}"]`);
    if (!input || typeof values[key] !== 'string') throw Error(`Missing setup field ${key}`);
    input.value = values[key];
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  button('Save settings').click();
  await wait(() => port.localSetup.snapshot().view?.revision >= 1, 'setup save', 60000);
  await wait(() => port.localSetup.snapshot().view?.readiness.build.ready, 'Build readiness', 60000);
  return { native: Boolean(window.__electrobunWebviewId), revision: port.localSetup.snapshot().view.revision,
    buildReady: port.localSetup.snapshot().view.readiness.build.ready,
    buildCapability: port.files.capability({ kind: 'package.build' }),
    buttonDisabled: button('Build mod files…').disabled };
})()
