// options.js - PRD Optimized Settings (Titan Rev. V12.1)

const STORAGE_KEYS = {
  CONFIG: "config",
  LOGS: "taskLogs",
  BLACKLIST: "blacklist",
  SENT_LIST: "sentList"
};

function normalizeUsernameList(items) {
  const normalized = [];
  const seen = new Set();

  (Array.isArray(items) ? items : []).forEach((item) => {
    const username = String(typeof item === 'string' ? item : item?.username || '').trim().toLowerCase();
    if (!username || seen.has(username)) return;
    seen.add(username);
    normalized.push(username);
  });

  return normalized;
}

function toStorageUserObjects(usernames, reason) {
  return usernames.map((username) => ({
    username,
    addedAt: Date.now(),
    reason
  }));
}

function getUsernameFromStorageItem(item) {
  if (typeof item === 'string') return item.trim().toLowerCase();
  if (item && typeof item === 'object') return String(item.username || '').trim().toLowerCase();
  return '';
}

function normalizeUserObjectList(items, defaultReason) {
  const now = Date.now();
  const bestByUsername = new Map();

  (Array.isArray(items) ? items : []).forEach((item) => {
    const username = getUsernameFromStorageItem(item);
    if (!username) return;

    const isObj = item && typeof item === 'object' && !Array.isArray(item);
    const candidate = {
      username,
      addedAt: isObj && Number(item.addedAt) ? Number(item.addedAt) : now,
      reason: (isObj && item.reason) ? item.reason : defaultReason
    };

    const prev = bestByUsername.get(username);
    if (!prev) {
      bestByUsername.set(username, candidate);
      return;
    }

    // Prefer earlier addedAt if we have it; keep a more specific reason if present.
    const prevAddedAt = Number(prev.addedAt) || now;
    const candAddedAt = Number(candidate.addedAt) || now;
    const merged = {
      username,
      addedAt: Math.min(prevAddedAt, candAddedAt),
      reason: prev.reason || candidate.reason || defaultReason
    };
    bestByUsername.set(username, merged);
  });

  return Array.from(bestByUsername.values());
}

function buildListRowNode({ username, addedAtText, reasonText, action, actionUsername }) {
  const row = document.createElement('div');
  row.className = 'list-item';

  const left = document.createElement('div');

  const bold = document.createElement('b');
  bold.textContent = `@${username || '-'}`;
  left.appendChild(bold);

  const meta1 = document.createElement('span');
  meta1.style.cssText = 'color:#94a3b8; font-size:12px; margin-left:10px;';
  meta1.textContent = `添加于: ${addedAtText}`;
  left.appendChild(meta1);

  const meta2 = document.createElement('span');
  meta2.style.cssText = 'color:#64748b; font-size:12px; margin-left:10px;';
  meta2.textContent = `原因: ${reasonText}`;
  left.appendChild(meta2);

  const remove = document.createElement('div');
  remove.className = 'btn-remove';
  remove.setAttribute('role', 'button');
  remove.setAttribute('tabindex', '0');
  remove.setAttribute('data-action', action);
  remove.setAttribute('data-username', actionUsername);
  remove.textContent = '移除';

  row.appendChild(left);
  row.appendChild(remove);
  return row;
}

function renderListInChunks(container, items, buildNode, chunkSize = 200) {
  container.textContent = '';
  if (!items || items.length === 0) return;

  let i = 0;

  const pump = () => {
    const frag = document.createDocumentFragment();
    const end = Math.min(i + chunkSize, items.length);
    for (; i < end; i++) {
      frag.appendChild(buildNode(items[i], i));
    }
    container.appendChild(frag);
    if (i < items.length) {
      requestAnimationFrame(pump);
    }
  };

  requestAnimationFrame(pump);
}

const __lazyRenderState = new WeakMap();

function ensureLazyIndicator(container) {
  let indicator = container.querySelector('[data-lazy-indicator="1"]');
  if (indicator) return indicator;
  indicator = document.createElement('div');
  indicator.setAttribute('data-lazy-indicator', '1');
  indicator.style.cssText = 'text-align:center; padding: 14px; color:#aab8c2; font-size: 13px;';
  return indicator;
}

function updateLazyIndicator(container) {
  const state = __lazyRenderState.get(container);
  if (!state) return;
  const { rendered, total, isAppending } = state;

  if (rendered >= total) {
    const existing = container.querySelector('[data-lazy-indicator="1"]');
    if (existing) existing.remove();
    return;
  }

  const indicator = ensureLazyIndicator(container);
  indicator.textContent = isAppending ? '加载中...' : '继续下滑加载更多...';
  if (!indicator.isConnected) container.appendChild(indicator);
}

function scheduleLazyAppend(container) {
  const state = __lazyRenderState.get(container);
  if (!state) return;
  if (state.rafId) return;

  state.rafId = requestAnimationFrame(() => {
    state.rafId = 0;
    if (state.rendered >= state.target) {
      state.isAppending = false;
      updateLazyIndicator(container);
      return;
    }

    state.isAppending = true;
    updateLazyIndicator(container);

    const frag = document.createDocumentFragment();
    const end = Math.min(state.rendered + state.chunkSize, state.target);
    for (; state.rendered < end; state.rendered++) {
      frag.appendChild(state.buildNode(state.items[state.rendered], state.rendered));
    }

    const indicator = container.querySelector('[data-lazy-indicator="1"]');
    if (indicator) {
      container.insertBefore(frag, indicator);
    } else {
      container.appendChild(frag);
    }

    // Continue until we reach target.
    if (state.rendered < state.target) {
      scheduleLazyAppend(container);
    } else {
      state.isAppending = false;
      updateLazyIndicator(container);
    }
  });
}

function renderListLazy(container, items, buildNode, { initialLimit = 300, pageSize = 300, chunkSize = 200 } = {}) {
  const total = Array.isArray(items) ? items.length : 0;
  if (total === 0) {
    container.textContent = '';
    return;
  }

  // Reset container and state.
  container.textContent = '';
  __lazyRenderState.set(container, {
    items,
    buildNode,
    total,
    rendered: 0,
    target: Math.min(initialLimit, total),
    pageSize,
    chunkSize,
    rafId: 0,
    isAppending: false
  });

  // Bind one stable scroll listener that always reads latest state.
  if (!container.dataset.lazyScrollBound) {
    container.dataset.lazyScrollBound = '1';
    container.addEventListener('scroll', () => {
      const state = __lazyRenderState.get(container);
      if (!state) return;
      if (state.rendered >= state.total) return;
      const nearBottom = (container.scrollTop + container.clientHeight) >= (container.scrollHeight - 120);
      if (!nearBottom) return;
      state.target = Math.min(state.rendered + state.pageSize, state.total);
      scheduleLazyAppend(container);
    }, { passive: true });
  }

  updateLazyIndicator(container);
  scheduleLazyAppend(container);
}

async function migrateLegacyListsIfNeeded() {
  const data = await chrome.storage.local.get([STORAGE_KEYS.SENT_LIST, STORAGE_KEYS.BLACKLIST]);

  const sentRaw = data[STORAGE_KEYS.SENT_LIST];
  const blacklistRaw = data[STORAGE_KEYS.BLACKLIST];

  const sentArr = Array.isArray(sentRaw) ? sentRaw : [];
  const blacklistArr = Array.isArray(blacklistRaw) ? blacklistRaw : [];

  const sentNeedsMigration = sentArr.some((x) => typeof x === 'string');
  const blacklistNeedsMigration = blacklistArr.some((x) => typeof x === 'string');

  // Also migrate if objects exist but username isn't normalized.
  const sentNeedsNormalize = sentArr.some((x) => {
    if (!x || typeof x !== 'object') return false;
    const raw = String(x.username || '');
    return raw.trim() !== raw.trim().toLowerCase();
  });
  const blacklistNeedsNormalize = blacklistArr.some((x) => {
    if (!x || typeof x !== 'object') return false;
    const raw = String(x.username || '');
    return raw.trim() !== raw.trim().toLowerCase();
  });

  if (!sentNeedsMigration && !blacklistNeedsMigration && !sentNeedsNormalize && !blacklistNeedsNormalize) return;

  const next = {};

  if (sentNeedsMigration || sentNeedsNormalize) {
    next[STORAGE_KEYS.SENT_LIST] = normalizeUserObjectList(sentArr, 'dm_sent_verified');
  }

  if (blacklistNeedsMigration || blacklistNeedsNormalize) {
    next[STORAGE_KEYS.BLACKLIST] = normalizeUserObjectList(blacklistArr, 'manual_migrate');
  }

  await chrome.storage.local.set(next);
}

function downloadJsonFile(filename, content) {
  const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

const STATUS_TEXT_MAP = {
  success: '成功',
  dm_sent_verified: '发送成功(已验证)',
  no_dm_capability: '无私信能力(已跳过)',
  region_filtered: '非台湾地区(已跳过)',
  region_unknown_skipped: '地区未知(已跳过未拉黑)',
  failed: '失败',
  rate_limited: '触发限流'
};

const SOURCE_TEXT_MAP = {
  manual_test: '手动测试',
  comment: '评论区',
  follower: '粉丝池',
  unknown: '未知'
};

function formatTimeCN(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${y}年${m}月${day}日 ${hh}:${mm}:${ss}`;
}

function formatDateCNFileSafe(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}年${m}月${day}日`;
}

function formatDetailCN(detail = '') {
  if (!detail) return '-';
  const text = String(detail);
  if (text.includes('DM button not available on profile')) return '主页无私信按钮，已跳过';
  if (text.includes('主页无私信按钮，已跳过')) return '主页无私信按钮，已跳过';
  if (text.includes('Profile region not Taiwan')) return '主页地区非台湾，已加入黑名单并跳过';
  if (text.includes('主页地区未知，已跳过（未拉黑）')) return '主页地区未知，已跳过（未拉黑）';
  if (text.includes('主页地区非目标地区')) return text;
  if (text.includes('Send not verified after retry')) return '发送后未通过验证（已重试）';
  if (text.includes('发送后未通过验证')) return text;
  if (text.includes('DM composer not found')) return '未找到聊天输入框';
  if (text.includes('未找到聊天输入框')) return '未找到聊天输入框';
  if (text.includes('Message page opened but composer not ready')) return '消息页已打开但输入框未就绪';
  if (text.includes('消息页已打开但输入框未就绪')) return '消息页已打开但输入框未就绪';
  if (text.includes('Cross-generation verification success')) return '跨页面校验成功';
  if (text.includes('跨页面校验成功')) return '跨页面校验成功';
  if (text.includes('Source: comment (recovered from delivered mark)')) return '来源：评论区（由送达标记恢复）';
  if (text.includes('来源：评论区（由送达标记恢复）')) return '来源：评论区（由送达标记恢复）';
  if (text.includes('Source: comment')) return '来源：评论区';
  if (text.includes('来源：评论区')) return text;
  if (text.includes('Source: follower')) return '来源：粉丝池';
  if (text.includes('来源：粉丝池')) return text;
  if (text.includes('Source: manual_test')) return '来源：手动测试';
  if (text.includes('来源：手动测试')) return text;
  return text;
}

// --- Tab Switching Logic ---
const tabs = document.querySelectorAll('.nav-item');
const contents = document.querySelectorAll('.tab-content');

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.getAttribute('data-tab');
    
    // Switch Active Sidebar State
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    
    // Switch Active Content State
    contents.forEach(c => c.classList.remove('active'));
    document.getElementById(`tab-${target}`).classList.add('active');

    // Trigger specific reload
    if (target === 'logs') loadLogs();
    if (target === 'blacklist') setTimeout(loadBlacklist, 0);
    if (target === 'sent') setTimeout(loadSentList, 0);
  });
});

// --- Config Management ---
document.getElementById('save').addEventListener('click', () => {
  const config = {
    dailyLimit: parseInt(document.getElementById('dailyLimit').value),
    hourlyLimit: parseInt(document.getElementById('hourlyLimit').value),
    opsBeforeCooldown: parseInt(document.getElementById('opsBeforeCooldown').value),
    cooldownMinutes: parseInt(document.getElementById('cooldownMinutes').value),
    commentWindowDays: parseInt(document.getElementById('commentWindow').value),
    followersLimit: parseInt(document.getElementById('followersLimit').value),
    sourceEnabled: {
      comments: document.getElementById('sourceComments').checked,
      followers: document.getElementById('sourceFollowers').checked
    },
    genderFilter: document.getElementById('genderFilter').checked,
    bypassRedirect: document.getElementById('bypassRedirect').checked,
    regionKeywords: document.getElementById('regionKeywords').value.split(',').map(s => s.trim()).filter(s => s),
    // Convert textarea to objects if needed, but here we'll keep as simple lines
    dmTemplates: document.getElementById('dmTemplates').value.split('\n').map(s => s.trim()).filter(s => s).map(line => ({
        content: line,
        type: line.includes("粉丝") ? "follower" : "comment" // Auto-infer type
    }))
  };

  chrome.storage.local.set({ [STORAGE_KEYS.CONFIG]: config }, () => {
    showToast("✅ 配置已同步至机魂核心");
  });
});

function loadConfig() {
  chrome.storage.local.get([STORAGE_KEYS.CONFIG], (data) => {
    if (data.config) {
      const cfg = data.config;
      document.getElementById('dailyLimit').value = cfg.dailyLimit || 200;
      document.getElementById('hourlyLimit').value = cfg.hourlyLimit || 50;
      document.getElementById('opsBeforeCooldown').value = cfg.opsBeforeCooldown || 50;
      document.getElementById('cooldownMinutes').value = cfg.cooldownMinutes || 5;
      document.getElementById('commentWindow').value = cfg.commentWindowDays || 3;
      document.getElementById('followersLimit').value = cfg.followersLimit || 50;
      document.getElementById('sourceComments').checked = cfg.sourceEnabled?.comments ?? true;
      document.getElementById('sourceFollowers').checked = cfg.sourceEnabled?.followers ?? true;
      document.getElementById('genderFilter').checked = cfg.genderFilter ?? false;
      document.getElementById('bypassRedirect').checked = cfg.bypassRedirect ?? true;
      document.getElementById('regionKeywords').value = (cfg.regionKeywords || []).join(', ');
      document.getElementById('dmTemplates').value = (cfg.dmTemplates || []).map(t => t.content).join('\n');
    }
  });
}

async function exportListsJson() {
  const now = Date.now();
  const data = await chrome.storage.local.get([STORAGE_KEYS.SENT_LIST, STORAGE_KEYS.BLACKLIST]);
  const sent = normalizeUsernameList(data[STORAGE_KEYS.SENT_LIST]);
  const blacklist = normalizeUsernameList(data[STORAGE_KEYS.BLACKLIST]);

  downloadJsonFile(`x-assistant-lists-${formatDateCNFileSafe(now)}.json`, {
    version: '1.0',
    exportedAt: formatTimeCN(now),
    exportedAtIso: new Date(now).toISOString(),
    exportedAtTs: now,
    data: {
      sentList: sent,
      blacklist
    }
  });

  showToast('名单已导出');
}

async function importListsJson(file) {
  const raw = await file.text();
  const name = String(file?.name || '').toLowerCase();
  const isJson = name.endsWith('.json') || (String(file?.type || '').includes('json'));

  let incomingSent = [];
  let incomingBlacklist = [];

  const parseAsTextList = () => {
    // CSV/TXT: treat all tokens as blacklist usernames.
    // Supports: one-per-cell (commas), one-per-line, spaces, tabs, or mixed.
    const text = String(raw || '');
    const cleaned = text
      .replace(/\r/g, '\n')
      .replace(/^\uFEFF/, '')
      .replace(/\"/g, '')
      .replace(/@/g, '');

    const tokens = cleaned
      .split(/[\n,;\t\s]+/g)
      .map((s) => s.trim())
      .filter(Boolean);

    incomingBlacklist = normalizeUsernameList(tokens);
  };

  if (isJson) {
    try {
      const parsed = JSON.parse(raw);
      const payload = parsed?.data || {};
      incomingSent = normalizeUsernameList(payload.sentList);
      incomingBlacklist = normalizeUsernameList(payload.blacklist);
    } catch (e) {
      // Some users save plain text with .json extension; fallback gracefully.
      parseAsTextList();
    }
  } else {
    parseAsTextList();
  }

  const current = await chrome.storage.local.get([STORAGE_KEYS.SENT_LIST, STORAGE_KEYS.BLACKLIST]);
  const currentSentRaw = current[STORAGE_KEYS.SENT_LIST] || [];
  const currentBlacklistRaw = current[STORAGE_KEYS.BLACKLIST] || [];

  // Merge into unified object arrays. Keep existing metadata when present.
  // For imported/new entries, use reason=manual_import.
  const mergedSent = normalizeUserObjectList(
    [...(Array.isArray(currentSentRaw) ? currentSentRaw : []), ...incomingSent],
    'manual_import'
  );
  const mergedBlacklist = normalizeUserObjectList(
    [...(Array.isArray(currentBlacklistRaw) ? currentBlacklistRaw : []), ...incomingBlacklist],
    'manual_import'
  );

  await chrome.storage.local.set({
    [STORAGE_KEYS.SENT_LIST]: mergedSent,
    [STORAGE_KEYS.BLACKLIST]: mergedBlacklist
  });

  loadSentList();
  loadBlacklist();
  showToast('名单已导入并合并');
}

// --- Logs Management ---
function loadLogs() {
  chrome.storage.local.get([STORAGE_KEYS.LOGS], (data) => {
    const logs = data[STORAGE_KEYS.LOGS] || [];
    const container = document.getElementById('logItems');
    
    // Stats calc
    const total = logs.length;
    const success = logs.filter(l => l.status === 'success' || l.status === 'dm_sent_verified').length;
    document.getElementById('stat-total').innerText = total;
    document.getElementById('stat-success').innerText = success;
    document.getElementById('stat-ratio').innerText = total > 0 ? Math.round((success/total)*100) + '%' : '0%';

    container.innerHTML = logs.reverse().map(l => {
      const date = formatTimeCN(l.timestamp);
      const statusTag = (l.status === 'success' || l.status === 'dm_sent_verified') ? 'tag-success' : 'tag-fail';
      const statusText = STATUS_TEXT_MAP[l.status] || String(l.status || 'UNKNOWN');
      const sourceText = SOURCE_TEXT_MAP[l.source] || l.source || '未知';
      const detailText = formatDetailCN(l.details);
      return `
        <tr>
          <td>${date}</td>
          <td><b>@${l.username}</b></td>
          <td>${sourceText}</td>
          <td><span class="status-tag ${statusTag}">${statusText}</span></td>
          <td>${detailText}</td>
        </tr>
      `;
    }).join('');
  });
}

const clearLogsBtn = document.getElementById('clearLogs');
if (clearLogsBtn) {
  clearLogsBtn.addEventListener('click', () => {
    const ok = confirm('确认清空全部执行日志？该操作不可撤销。');
    if (!ok) return;
    chrome.storage.local.set({ [STORAGE_KEYS.LOGS]: [] }, () => {
      loadLogs();
      showToast('日志已清空');
    });
  });
}

// --- Blacklist Management ---
function loadBlacklist() {
  chrome.storage.local.get([STORAGE_KEYS.BLACKLIST], (data) => {
    const list = data[STORAGE_KEYS.BLACKLIST] || [];
    const container = document.getElementById('blacklistItems');
    const countEl = document.getElementById('blacklistCountUI');

    // Let the tab switch paint first.
    container.innerHTML = '<div style="text-align:center; padding: 28px; color:#aab8c2;">加载中...</div>';
    
    if (list.length === 0) {
      if (countEl) countEl.textContent = '0';
      container.innerHTML = '<div style="text-align:center; padding: 40px; color:#aab8c2;">黑名单目前为空</div>';
      return;
    }

    const reasonMap = {
      no_dm_capability: '无私信能力自动加入',
      region_filtered: '非台湾地区自动加入'
    };

    const run = () => {
      const sorted = [...list].sort((a, b) => {
        const ta = Number(a?.addedAt) || 0;
        const tb = Number(b?.addedAt) || 0;
        return tb - ta;
      });

      if (countEl) countEl.textContent = String(sorted.length);

      renderListLazy(container, sorted, (item) => {
        const username = getUsernameFromStorageItem(item);
        const addedAt = Number(item?.addedAt) || 0;
        const reason = item && typeof item === 'object' ? item.reason : undefined;
        return buildListRowNode({
          username,
          addedAtText: addedAt ? formatTimeCN(addedAt) : '-',
          reasonText: reasonMap[reason] || '手动加入',
          action: 'remove-blacklist',
          actionUsername: username
        });
      });
    };

    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: 500 });
    } else {
      requestAnimationFrame(run);
    }
  });
}

function loadSentList() {
  chrome.storage.local.get([STORAGE_KEYS.SENT_LIST], (data) => {
    const list = data[STORAGE_KEYS.SENT_LIST] || [];
    const container = document.getElementById('sentItems');
    const countEl = document.getElementById('sentCountUI');

    // Let the tab switch paint first.
    container.innerHTML = '<div style="text-align:center; padding: 28px; color:#aab8c2;">加载中...</div>';

    if (list.length === 0) {
      if (countEl) countEl.textContent = '0';
      container.innerHTML = '<div style="text-align:center; padding: 40px; color:#aab8c2;">已发送名单目前为空</div>';
      return;
    }

    const reasonMap = {
      dm_sent_verified: '私信发送成功后自动加入'
    };

    const run = () => {
      const sorted = [...list].sort((a, b) => {
        const ta = Number(a?.addedAt) || 0;
        const tb = Number(b?.addedAt) || 0;
        return tb - ta;
      });

      if (countEl) countEl.textContent = String(sorted.length);

      renderListLazy(container, sorted, (item) => {
        const username = getUsernameFromStorageItem(item);
        const addedAt = Number(item?.addedAt) || 0;
        const reason = item && typeof item === 'object' ? item.reason : undefined;
        return buildListRowNode({
          username,
          addedAtText: addedAt ? formatTimeCN(addedAt) : '-',
          reasonText: reasonMap[reason] || '发送成功后加入',
          action: 'remove-sent',
          actionUsername: username
        });
      });
    };

    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: 500 });
    } else {
      requestAnimationFrame(run);
    }
  });
}

function bindListRemoveHandlersOnce() {
  const blacklistContainer = document.getElementById('blacklistItems');
  if (blacklistContainer && !blacklistContainer.dataset.removeBound) {
    blacklistContainer.dataset.removeBound = '1';
    blacklistContainer.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const actionEl = target.closest('[data-action="remove-blacklist"]');
      if (!actionEl) return;
      const username = actionEl.getAttribute('data-username') || '';
      window.removeFromBlacklist(username);
    });
  }

  const sentContainer = document.getElementById('sentItems');
  if (sentContainer && !sentContainer.dataset.removeBound) {
    sentContainer.dataset.removeBound = '1';
    sentContainer.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const actionEl = target.closest('[data-action="remove-sent"]');
      if (!actionEl) return;
      const username = actionEl.getAttribute('data-username') || '';
      window.removeFromSentList(username);
    });
  }
}

window.removeFromBlacklist = function(username) {
  const target = String(username || '').trim().toLowerCase();
  if (!target) return;
  chrome.storage.local.get([STORAGE_KEYS.BLACKLIST], (data) => {
    const list = data[STORAGE_KEYS.BLACKLIST] || [];
    const newList = list.filter((u) => getUsernameFromStorageItem(u) !== target);
    chrome.storage.local.set({ [STORAGE_KEYS.BLACKLIST]: newList }, () => {
      loadBlacklist();
      showToast("已移除黑名单");
    });
  });
};

window.removeFromSentList = function(username) {
  const target = String(username || '').trim().toLowerCase();
  if (!target) return;
  chrome.storage.local.get([STORAGE_KEYS.SENT_LIST], (data) => {
    const list = data[STORAGE_KEYS.SENT_LIST] || [];
    const newList = list.filter((u) => getUsernameFromStorageItem(u) !== target);
    chrome.storage.local.set({ [STORAGE_KEYS.SENT_LIST]: newList }, () => {
      loadSentList();
      showToast("已移除已发送名单");
    });
  });
};

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.innerText = msg;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 2500);
}

// Global Init
document.addEventListener('DOMContentLoaded', () => {
  (async () => {
    try {
      await migrateLegacyListsIfNeeded();
    } catch (e) {
      // Migration failure shouldn't break the options page.
      console.warn('migrateLegacyListsIfNeeded failed', e);
    }

    bindListRemoveHandlersOnce();

    loadConfig();
    loadLogs();
    loadSentList();
    loadBlacklist();
  })();

  const exportBtn = document.getElementById('exportLists');
  const importBtn = document.getElementById('importLists');
  const importInput = document.getElementById('importListsFile');

  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      exportListsJson().catch((error) => {
        alert(`导出失败: ${error.message || error}`);
      });
    });
  }

  if (importBtn && importInput) {
    importBtn.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        await importListsJson(file);
      } catch (error) {
        alert(`导入失败: ${error.message || error}`);
      } finally {
        importInput.value = '';
      }
    });
  }
});