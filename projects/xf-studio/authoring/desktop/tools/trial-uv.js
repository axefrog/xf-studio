(async () => {
  const port = window.xfStudioPresentation;
  const wait = async (test, label, timeout = 30000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) { if (test()) return; await new Promise(resolve => setTimeout(resolve, 150)); }
    throw Error(`Timed out: ${label}`);
  };
  const button = text => [...document.querySelectorAll('button')].find(node => node.textContent?.trim() === text);
  const head = port.viewport.snapshot().head;
  const uv = port.viewport.snapshot().uv;
  const noHeadFetch = !performance.getEntriesByType('resource').some(entry => entry.name.endsWith('/assets/head.glb'));
  const before = port.editor.layer().color;
  const target = before === '#123456' ? '#234567' : '#123456';
  const hex = document.querySelector('input[aria-label="Colour hex value"]');
  hex.value = target;
  hex.dispatchEvent(new Event('change', { bubbles: true }));
  const changed = port.editor.layer().color;
  await wait(() => !document.querySelector('button[aria-label="Undo"]').disabled, 'Undo enabled');
  document.querySelector('button[aria-label="Undo"]').click();
  await wait(() => port.editor.layer().color === before, 'Undo restored colour');
  const undone = port.editor.layer().color;
  await wait(() => hex.value === before, 'colour control restored');
  hex.value = target;
  hex.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(() => port.editor.layer().color === target, 'second colour edit');
  button('Save').click();
  await wait(() => port.library.summary().draft.revision >= 1 && !port.library.summary().busy, 'library save');
  document.querySelector('#dock-tab-package').click();
  button('Check mod export').click();
  await wait(() => port.files.snapshot().package?.kind === 'packageCheck' && !port.library.summary().busy, 'package Check', 60000);
  const result = { native: Boolean(window.__electrobunWebviewId), head: head.phase, uv: uv.phase,
    noHeadFetch, before, changed, undone, retained: port.editor.layer().color,
    savedRevision: port.library.summary().draft.revision,
    check: port.files.snapshot().package?.kind,
    checkCurrent: document.querySelector('.result-card')?.dataset.freshness,
    checkText: document.querySelector('.package-result')?.textContent?.slice(0, 260) };
  if (!result.native || result.head !== 'error' || result.uv !== 'ready' || !result.noHeadFetch ||
    changed !== target || undone !== before || result.retained !== target ||
    result.savedRevision < 1 || result.check !== 'packageCheck') throw Error(JSON.stringify(result));
  return result;
})()
