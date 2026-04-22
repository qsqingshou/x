// X-Assistant: DM Flow Debugger
// Run in Chrome DevTools Console on target profile or messages page.

(function runXAssistantDmDebug() {
  const url = location.href;
  const pendingRaw = sessionStorage.getItem('pending_target') || localStorage.getItem('pending_target');
  let pending = null;
  try {
    pending = pendingRaw ? JSON.parse(pendingRaw) : null;
  } catch (_) {
    pending = null;
  }

  const dmSelectors = [
    '[data-testid="sendDMFromProfile"]',
    'button[data-testid="sendDMFromProfile"]',
    'button[aria-label*="私信"]',
    'button[aria-label*="Message"]',
    'a[href*="/messages/compose"]'
  ];

  const composerSelectors = [
    '[data-testid="dmComposerTextInput"]',
    '[data-testid="dmComposerTextInput"] [contenteditable="true"]',
    '.public-DraftEditor-content',
    '[data-testid="conversation"] [contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]'
  ];

  const dmHits = dmSelectors.map((selector) => ({
    selector,
    found: !!document.querySelector(selector)
  }));

  const composerHits = composerSelectors.map((selector) => ({
    selector,
    found: !!document.querySelector(selector)
  }));

  const actionCandidates = Array.from(document.querySelectorAll('button,[role="button"],a'))
    .map((node) => ({
      tag: node.tagName,
      testid: node.getAttribute('data-testid') || '',
      aria: node.getAttribute('aria-label') || '',
      href: node.getAttribute('href') || '',
      text: (node.innerText || node.textContent || '').trim().slice(0, 30)
    }))
    .filter((item) => /message|私信|發送私訊|发送私信|direct|userActions|sendDMFromProfile/i.test(`${item.testid} ${item.aria} ${item.text} ${item.href}`))
    .slice(0, 30);

  const output = {
    url,
    manualTestActive: localStorage.getItem('manual_test_active'),
    pending,
    dmHits,
    composerHits,
    actionCandidates
  };

  console.log('========== X-Assistant DM DEBUG ==========');
  console.log(output);
  if (typeof window.XAssistantSnapshot === 'function') {
    console.log('XAssistantSnapshot =>', window.XAssistantSnapshot());
  }
  console.log('========== /X-Assistant DM DEBUG =========');
})();

