(() => {
  const button = document.querySelector('#desktop-intake-import');
  if (!button || button.disabled) throw Error('Prepared files have not passed intake inspection.');
  button.click();
  return { native: Boolean(window.__electrobunWebviewId), importStarted: true };
})()
