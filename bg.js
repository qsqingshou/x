/** 
 * X-Auto-DM Service Worker (MV3) - Titan v9 Revision
 * Refined for: PRD Section 4 & 6 (Filter Engine & Rate Limits)
 */

const STORAGE_KEYS = {
  CONFIG: "config",
  STATS: "taskStats",
  LOGS: "taskLogs",
  BLACKLIST: "blacklist",
  SENT_LIST: "sentList",
  RUNTIME: "runtimeState",
  PENDING_TASKS: "pendingTasks"
};

const LICENSE_STORAGE_KEY = 'licenseState';
const LICENSE_EXPIRE_ALARM = 'license_expire';
const RESUME_SIGNAL_KEY = 'resumeSignal';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function ensureStatsAnchors(stats) {
  const now = Date.now();
  const next = { ...(stats || {}) };
  if (!Number.isFinite(next.lastReset)) next.lastReset = now;
  if (!Number.isFinite(next.lastHourReset)) next.lastHourReset = next.lastReset;
  if (!Number.isFinite(next.opsDaily)) next.opsDaily = 0;
  if (!Number.isFinite(next.opsHourly)) next.opsHourly = 0;
  return next;
}

function computeQuotaResumeAt(stats, cfg) {
  const s = ensureStatsAnchors(stats);
  const dailyLimit = Number(cfg?.dailyLimit) || 0;
  const hourlyLimit = Number(cfg?.hourlyLimit) || 0;
  const opsBeforeCooldown = Number(cfg?.opsBeforeCooldown) || 0;
  const cooldownMinutes = Number(cfg?.cooldownMinutes) || 0;
  const dailyBlocked = dailyLimit > 0 && Number(s.daily || 0) >= dailyLimit;
  const hourlyBlocked = hourlyLimit > 0 && Number(s.hourly || 0) >= hourlyLimit;
  const opsBlocked = opsBeforeCooldown > 0 && Number(s.opsHourly || 0) >= opsBeforeCooldown;
  const existingCooldownUntil = Number(s.cooldownUntil) || 0;
  const existingCooldownReason = String(s.cooldownReason || '');
  const now = Date.now();

  if (dailyBlocked) {
    return {
      blocked: true,
      reason: 'daily_limit',
      resumeAtTs: Number(s.lastReset) + DAY_MS
    };
  }

  if (hourlyBlocked) {
    return {
      blocked: true,
      reason: 'hourly_limit',
      resumeAtTs: Number(s.lastHourReset) + HOUR_MS
    };
  }

  if (opsBlocked) {
    const resumeAtTs = existingCooldownReason === 'ops_cooldown' && existingCooldownUntil > now
      ? existingCooldownUntil
      : now + (Math.max(1, cooldownMinutes) * 60 * 1000);
    return {
      blocked: true,
      reason: 'ops_cooldown',
      resumeAtTs
    };
  }

  return { blocked: false, reason: null, resumeAtTs: null };
}

function getDefaultConfig() {
  return {
    dailyLimit: 200,
    hourlyLimit: 50,
    opsBeforeCooldown: 50,
    cooldownMinutes: 5,
    commentWindowDays: 3,
    sourceEnabled: { comments: true, followers: true },
    regionKeywords: [],
    genderKeywords: [],
    dmTemplates: [
      { type: "comment", content: "刚才看到你在评论区聊的很有趣，交个朋友？" },
      { type: "follower", content: "发现我们都关注了同一个博主，感觉很巧呢！" }
    ],
    batchSizeBeforeAction: 5,
    perDmDelaySec: [3, 8],
    pageNavigationDelay: [5, 12]
  };
}

function normalizeConfig(cfg) {
  const defaults = getDefaultConfig();
  return {
    ...defaults,
    ...(cfg || {}),
    sourceEnabled: {
      ...defaults.sourceEnabled,
      ...((cfg && cfg.sourceEnabled) || {})
    }
  };
}

let isRunning = false;
let isCooldowned = false; // 冷冻期状态
let storageTaskQueue = Promise.resolve();

async function enqueueStorageTask(taskFn) {
  storageTaskQueue = storageTaskQueue.then(async () => {
    try {
      await taskFn();
    } catch (error) {
      console.error("[BG-Queue] 裁决执行异常:", error);
    }
  });
  return storageTaskQueue;
}

async function handleTaskArbiter(payload) {
  const normalizedPayload = payload || {};
  const username = normalizedPayload.username;
  const source = normalizedPayload.source;
  const status = normalizedPayload.status || (normalizedPayload.action === "MARK_SENT_CONFIRMED" ? "dm_sent_verified" : "");
  const sourceTextMap = {
    comment: "评论区",
    follower: "粉丝池",
    manual_test: "手动测试",
    unknown: "未知"
  };
  const details = normalizedPayload.details || (status === "dm_sent_verified" ? `来源：${sourceTextMap[source] || sourceTextMap.unknown}` : "");
  if (!username || !status) return;
  const normalizedUsername = String(username).toLowerCase();

  const data = await chrome.storage.local.get([
    STORAGE_KEYS.LOGS,
    STORAGE_KEYS.STATS,
    STORAGE_KEYS.SENT_LIST,
    STORAGE_KEYS.BLACKLIST
  ]);

  const logs = data[STORAGE_KEYS.LOGS] || [];
  const stats = ensureStatsAnchors(data[STORAGE_KEYS.STATS] || { daily: 0, hourly: 0 });
  const sentList = (data[STORAGE_KEYS.SENT_LIST] || [])
    .map(item => typeof item === 'string' ? { username: item } : item)
    .filter(item => item && item.username);
  const blacklist = (data[STORAGE_KEYS.BLACKLIST] || [])
    .map(item => typeof item === 'string' ? { username: item } : item)
    .filter(item => item && item.username);

  const isSuccess = status === "success" || status === "dm_sent_verified";
  if (isSuccess && !sentList.some(item => String(item.username).toLowerCase() === normalizedUsername)) {
    sentList.push({ username, addedAt: Date.now(), reason: "dm_sent_verified" });
    stats.daily++;
    stats.hourly++;
  }

  if ((status === "region_filtered" || status === "no_dm_capability") && username) {
    if (!blacklist.some(item => String(item.username).toLowerCase() === normalizedUsername)) {
      blacklist.push({ username, addedAt: Date.now(), reason: status });
    }
  }

  const duplicateWindowMs = 120000;
  const isDuplicateLog = logs.some(log =>
    String(log.username).toLowerCase() === normalizedUsername &&
    log.status === status &&
    (Date.now() - log.timestamp < duplicateWindowMs)
  );

  if (!isDuplicateLog) {
    logs.push({ timestamp: Date.now(), username, status, details, source });
    stats.opsDaily = Number(stats.opsDaily || 0) + 1;
    stats.opsHourly = Number(stats.opsHourly || 0) + 1;
    if (logs.length > 2000) logs.shift();
  }

  await chrome.storage.local.set({
    [STORAGE_KEYS.LOGS]: logs,
    [STORAGE_KEYS.STATS]: stats,
    [STORAGE_KEYS.SENT_LIST]: sentList,
    [STORAGE_KEYS.BLACKLIST]: blacklist
  });
}

async function auditAndCompensate() {
  const data = await chrome.storage.local.get([STORAGE_KEYS.PENDING_TASKS]);
  const pendingTasks = data[STORAGE_KEYS.PENDING_TASKS] || {};
  const now = Date.now();
  let changed = false;

  for (const taskId of Object.keys(pendingTasks)) {
    const task = pendingTasks[taskId];
    if (!task || !task.timestamp) continue;
    if (now - task.timestamp <= 60000) continue;

    await enqueueStorageTask(async () => {
      await handleTaskArbiter(task);
    });
    delete pendingTasks[taskId];
    changed = true;
  }

  if (changed) {
    await chrome.storage.local.set({ [STORAGE_KEYS.PENDING_TASKS]: pendingTasks });
  }
}

async function getRuntimeState() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.RUNTIME);
  const runtime = data[STORAGE_KEYS.RUNTIME] || {};
  return {
    running: runtime.running === true,
    cooldowned: runtime.cooldowned === true
  };
}

async function setRuntimeState(next, source = 'unknown') {
  const current = await getRuntimeState();
  const merged = { ...current, ...next };
  isRunning = merged.running;
  isCooldowned = merged.cooldowned;
  if (current.running !== merged.running || current.cooldowned !== merged.cooldowned) {
    console.log('[BG-Runtime] state change', {
      source,
      from: current,
      to: merged,
      at: Date.now()
    });
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.RUNTIME]: merged });
  return merged;
}

async function emitResumeSignal(reason) {
  try {
    await chrome.storage.local.set({
      [RESUME_SIGNAL_KEY]: {
        timestamp: Date.now(),
        reason: reason || 'cooldown_finished'
      }
    });
  } catch (e) {
    console.warn('[resume] emit signal failed', e);
  }
}

async function broadcastStop(reason) {
  const tabs = await chrome.tabs.query({ url: ["https://x.com/*", "https://*.x.com/*"] });
  await Promise.allSettled(tabs.map((tab) => chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (r) => {
      try {
        window.postMessage({ type: "X_STOP_NOW", reason: r || "license_expired" }, "*");
      } catch (_) {}
    },
    args: [reason]
  })));
}

async function scheduleLicenseExpiryAlarm() {
  try {
    const data = await chrome.storage.local.get([LICENSE_STORAGE_KEY]);
    const license = data[LICENSE_STORAGE_KEY] || null;
    const vipUntil = Number(license?.vipUntil);

    // Always clear previous alarm to avoid duplicates.
    await chrome.alarms.clear(LICENSE_EXPIRE_ALARM);

    if (!Number.isFinite(vipUntil) || vipUntil <= 0) return;
    const whenMs = vipUntil * 1000;
    if (!Number.isFinite(whenMs)) return;

    // If already expired, stop immediately (alarm may be missed / not scheduled).
    if (Date.now() >= whenMs) {
      const runtime = await getRuntimeState();
      if (runtime.running) {
        await setRuntimeState({ running: false }, 'license_expire_immediate');
        await broadcastStop('license_expired');
      }
      return;
    }

    chrome.alarms.create(LICENSE_EXPIRE_ALARM, { when: whenMs });
  } catch (e) {
    console.warn('[license] schedule alarm failed', e);
  }
}

async function isLicenseValidNow() {
  const data = await chrome.storage.local.get([LICENSE_STORAGE_KEY]);
  const license = data[LICENSE_STORAGE_KEY] || null;
  if (!license || typeof license !== 'object') return false;
  if (license.ok !== true) return false;
  const vipUntil = Number(license.vipUntil);
  if (!Number.isFinite(vipUntil) || vipUntil <= 0) {
    // 没有到期时间时，视为长期有效（兼容某些平台返回空/0 的情况）
    return true;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  return vipUntil > nowSec;
}

chrome.runtime.onInstalled.addListener(async () => {
  const d = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
  if (!d.config) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.CONFIG]: getDefaultConfig()
    });
  } else {
    const normalizedConfig = normalizeConfig(d.config);
    await chrome.storage.local.set({ [STORAGE_KEYS.CONFIG]: normalizedConfig });
  }

  if (!d[STORAGE_KEYS.RUNTIME]) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.RUNTIME]: {
        running: false,
        cooldowned: false
      }
    });
  } else {
    isRunning = d[STORAGE_KEYS.RUNTIME].running === true;
    isCooldowned = d[STORAGE_KEYS.RUNTIME].cooldowned === true;
  }

  if (!d[STORAGE_KEYS.PENDING_TASKS]) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.PENDING_TASKS]: {}
    });
  }

  // Ensure stats anchors exist for accurate pause countdown.
  if (!d[STORAGE_KEYS.STATS]) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.STATS]: ensureStatsAnchors({ daily: 0, hourly: 0, opsDaily: 0, opsHourly: 0 })
    });
  } else {
    const anchored = ensureStatsAnchors(d[STORAGE_KEYS.STATS]);
    await chrome.storage.local.set({ [STORAGE_KEYS.STATS]: anchored });
  }

  // Restore license expiry alarm if licenseState exists.
  await scheduleLicenseExpiryAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  scheduleLicenseExpiryAlarm();
});

// 定时任务：每 5 分钟检查配额与冷冻期
chrome.alarms.create("system_check", { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "system_check") {
    const runtime = await getRuntimeState();
    isRunning = runtime.running;
    isCooldowned = runtime.cooldowned;
    const data = await chrome.storage.local.get([STORAGE_KEYS.STATS]);
    const stats = ensureStatsAnchors(data[STORAGE_KEYS.STATS] || { daily: 0, hourly: 0, opsDaily: 0, opsHourly: 0, lastReset: Date.now() });
    const now = Date.now();
    
    // 跨天或跨小时重置
    if (now - stats.lastReset > 86400000) {
      stats.daily = 0;
      stats.hourly = 0;
      stats.opsDaily = 0;
      stats.opsHourly = 0;
      stats.lastReset = now;
      stats.lastHourReset = now;
    } else if (now - (stats.lastHourReset || 0) > 3600000) {
      stats.hourly = 0;
      stats.opsHourly = 0;
      stats.lastHourReset = now;
    }
    
    // 解封冷冻期
    if (isCooldowned && stats.cooldownUntil && now > stats.cooldownUntil) {
      isCooldowned = false;
      await setRuntimeState({ cooldowned: false }, 'system_check_cooldown_release');
      if (stats.cooldownReason === 'ops_cooldown') {
        stats.opsHourly = 0;
      }
      stats.cooldownUntil = null;
      stats.cooldownReason = null;
      await emitResumeSignal('cooldown_finished');
    }
    
    await chrome.storage.local.set({ [STORAGE_KEYS.STATS]: stats });
    await auditAndCompensate();
  }

  if (alarm.name === LICENSE_EXPIRE_ALARM) {
    const runtime = await getRuntimeState();
    if (runtime.running) {
      await setRuntimeState({ running: false }, 'license_expire_alarm');
      await broadcastStop('license_expired');
    }
    // One-shot alarm; no need to reschedule here.
    return;
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'LICENSE_UPDATED') {
    scheduleLicenseExpiryAlarm().then(() => sendResponse({ success: true }));
    return true;
  }
  if (message.action === 'GET_RECENT_LOGS') {
    (async () => {
      const limitRaw = Number(message?.limit);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50;
      const includeRuntime = message?.includeRuntime !== false;
      const includeStats = message?.includeStats === true;

      const keys = [STORAGE_KEYS.LOGS];
      if (includeStats) keys.push(STORAGE_KEYS.STATS);
      const [data, runtime] = await Promise.all([
        chrome.storage.local.get(keys),
        includeRuntime ? getRuntimeState() : Promise.resolve(null)
      ]);

      const logs = Array.isArray(data[STORAGE_KEYS.LOGS]) ? data[STORAGE_KEYS.LOGS] : [];
      const recent = logs.slice(-limit);
      const resp = { ok: true, count: recent.length, logs: recent };
      if (includeRuntime && runtime) resp.runtime = runtime;
      if (includeStats) resp.stats = ensureStatsAnchors(data[STORAGE_KEYS.STATS] || { daily: 0, hourly: 0 });
      sendResponse(resp);
    })().catch((e) => {
      sendResponse({ ok: false, error: String(e?.message || e) });
    });
    return true;
  }
  if (message.action === "START") {
    (async () => {
      const ok = await isLicenseValidNow();
      if (!ok) {
        sendResponse({ success: false, error: 'license_invalid' });
        return;
      }
      const data = await chrome.storage.local.get([STORAGE_KEYS.STATS]);
      const stats = ensureStatsAnchors(data[STORAGE_KEYS.STATS] || { daily: 0, hourly: 0, opsDaily: 0, opsHourly: 0 });
      stats.opsHourly = 0;
      stats.cooldownUntil = null;
      stats.cooldownReason = null;
      await chrome.storage.local.set({ [STORAGE_KEYS.STATS]: stats });
      await setRuntimeState({ running: true, cooldowned: false }, 'message_START');
      sendResponse({ success: true });
    })().catch((e) => {
      sendResponse({ success: false, error: String(e?.message || e) });
    });
    return true;
  }
  if (message.action === "STOP") {
    setRuntimeState({ running: false }, 'message_STOP').then(() => sendResponse({ success: true }));
    return true;
  }
  if (message.action === "GET_STATS") {
    Promise.all([
      getRuntimeState(),
      chrome.storage.local.get([STORAGE_KEYS.STATS, STORAGE_KEYS.CONFIG])
    ]).then(async ([runtime, data]) => {
      isRunning = runtime.running;
      isCooldowned = runtime.cooldowned;
      const stats = ensureStatsAnchors(data[STORAGE_KEYS.STATS] || { daily: 0, hourly: 0, opsDaily: 0, opsHourly: 0 });
      const cfg = normalizeConfig(data[STORAGE_KEYS.CONFIG] || {});
      const quota = computeQuotaResumeAt(stats, cfg);
      if (isRunning && quota.blocked) {
        const nextCooldownUntil = Number(stats.cooldownUntil) || 0;
        if (!nextCooldownUntil || quota.resumeAtTs > nextCooldownUntil || stats.cooldownReason !== quota.reason) {
          stats.cooldownUntil = quota.resumeAtTs;
          stats.cooldownReason = quota.reason;
          await chrome.storage.local.set({ [STORAGE_KEYS.STATS]: stats });
        }
        if (!isCooldowned) {
          await setRuntimeState({ cooldowned: true }, 'get_stats_quota_blocked');
          isCooldowned = true;
        }
      }
      const cooldownUntil = Number(stats.cooldownUntil) || (quota.blocked ? quota.resumeAtTs : null);
      const cooldownReason = stats.cooldownReason || (quota.blocked ? quota.reason : null);

      const licenseValid = await isLicenseValidNow();
      sendResponse({
        running: isRunning,
        cooldowned: isCooldowned || quota.blocked,
        cooldownUntil,
        cooldownReason,
        licenseValid,
        stats: {
          daily: Number(stats.daily || 0),
          hourly: Number(stats.hourly || 0),
          opsDaily: Number(stats.opsDaily || 0),
          opsHourly: Number(stats.opsHourly || 0)
        }
      });
    });
    return true;
  }
  
  if (message.action === "GET_QUOTA_STATUS") {
    Promise.all([
      chrome.storage.local.get([STORAGE_KEYS.STATS, STORAGE_KEYS.CONFIG, STORAGE_KEYS.BLACKLIST, STORAGE_KEYS.LOGS, STORAGE_KEYS.SENT_LIST]),
      getRuntimeState()
    ]).then(async ([data, runtime]) => {
      isRunning = runtime.running;
      isCooldowned = runtime.cooldowned;
      const stats = ensureStatsAnchors(data[STORAGE_KEYS.STATS] || { daily: 0, hourly: 0, opsDaily: 0, opsHourly: 0 });
      const cfg = normalizeConfig(data[STORAGE_KEYS.CONFIG] || {});
      const blacklistRaw = data[STORAGE_KEYS.BLACKLIST] || [];
      const blacklist = blacklistRaw
        .map(item => typeof item === 'string' ? { username: item } : item)
        .filter(item => item && item.username);
      const logs = data[STORAGE_KEYS.LOGS] || [];
      const sentList = (data[STORAGE_KEYS.SENT_LIST] || [])
        .map(item => typeof item === 'string' ? { username: item } : item)
        .filter(item => item && item.username);
      const processedUsernames = logs.map(l => l.username);

      const quota = computeQuotaResumeAt(stats, cfg);
      const now = Date.now();
      const resumeAtTs = quota.blocked ? quota.resumeAtTs : null;
      const remainingMs = resumeAtTs ? Math.max(0, resumeAtTs - now) : 0;

      // If blocked by quota while running, enter explicit cooldown state.
      if (isRunning && quota.blocked) {
        const nextCooldownUntil = Number(stats.cooldownUntil) || 0;
        if (!nextCooldownUntil || resumeAtTs > nextCooldownUntil || stats.cooldownReason !== quota.reason) {
          stats.cooldownUntil = resumeAtTs;
          stats.cooldownReason = quota.reason;
          chrome.storage.local.set({ [STORAGE_KEYS.STATS]: stats });
        }
        if (!isCooldowned) {
          setRuntimeState({ cooldowned: true }, 'get_quota_status_blocked');
          isCooldowned = true;
        }
      }

      // If cooldown passed, clear it proactively.
      if (isCooldowned && Number(stats.cooldownUntil) && now >= Number(stats.cooldownUntil)) {
        stats.cooldownUntil = null;
        stats.cooldownReason = null;
        chrome.storage.local.set({ [STORAGE_KEYS.STATS]: stats });
        setRuntimeState({ cooldowned: false }, 'get_quota_status_release');
        isCooldowned = false;
      }

      const licenseValid = await isLicenseValidNow();

      sendResponse({
        canProceed: licenseValid && isRunning && !(isCooldowned || quota.blocked) && stats.daily < cfg.dailyLimit && stats.hourly < cfg.hourlyLimit,
        licenseValid,
        stats,
        config: cfg,
        blacklist: blacklist.map(b => b.username),
        history: processedUsernames,
        sent: sentList.map(item => item.username),
        pause: quota.blocked ? {
          reason: quota.reason,
          resumeAtTs,
          remainingMs
        } : null
      });
    });
    return true;
  }

  if (message.action === "LOG_TASK" || message.action === "MARK_SENT_CONFIRMED") {
    const payload = message.payload || {};
    const taskId = payload.taskId || `task_${payload.username || 'unknown'}_${payload.source || 'unknown'}_${payload.statusId || 'none'}_${Date.now()}`;
    const normalizedPayload = {
      ...payload,
      action: message.action,
      status: payload.status || (message.action === "MARK_SENT_CONFIRMED" ? "dm_sent_verified" : payload.status),
      details: payload.details || (message.action === "MARK_SENT_CONFIRMED" ? `Source: ${payload.source || 'unknown'}` : payload.details)
    };

    enqueueStorageTask(async () => {
      const data = await chrome.storage.local.get([STORAGE_KEYS.PENDING_TASKS]);
      const pendingTasks = data[STORAGE_KEYS.PENDING_TASKS] || {};
      pendingTasks[taskId] = { ...normalizedPayload, timestamp: Date.now() };
      await chrome.storage.local.set({ [STORAGE_KEYS.PENDING_TASKS]: pendingTasks });

      await handleTaskArbiter(normalizedPayload);

      const latest = await chrome.storage.local.get([STORAGE_KEYS.PENDING_TASKS]);
      const nextPendingTasks = latest[STORAGE_KEYS.PENDING_TASKS] || {};
      delete nextPendingTasks[taskId];
      await chrome.storage.local.set({ [STORAGE_KEYS.PENDING_TASKS]: nextPendingTasks });

      if (normalizedPayload.status === "rate_limited") {
        isCooldowned = true;
        await setRuntimeState({ cooldowned: true }, 'log_task_rate_limited');
      }

      sendResponse({ success: true, status: "queued" });
    });
    return true;
  }
});