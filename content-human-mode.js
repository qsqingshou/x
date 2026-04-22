/**
 * [X-Assistant] V12: TOTAL CLOSURE (Titan Rev.)
 * Hunter Mode (/status/) -> Hub Navigation (Profile) -> Pool Infiltration (/followers)
 */



(function() {
  console.log("[X-Assistant] ACTIVATING V12: PRD-OPTIMIZED CLOSURE MODE...");
  
  let forceCheck = false;
  let stopRequested = false;
  let cooldownPauseRequested = false;
  let scrollCount = 0;
  let dmInjecting = false;
  let lastDmInjectAt = 0;
  let statusOverlayInitialized = false;
  const FALLBACK_CONFIG = {
    dailyLimit: 200,
    hourlyLimit: 50,
    commentWindowDays: 3,
    dmTemplates: [
      { type: "comment", content: "刚才看到你在评论区聊的很有趣，交个朋友？" },
      { type: "follower", content: "发现我们都关注了同一个博主，感觉很巧呢！" }
    ],
    regionKeywords: [],
    genderKeywords: []
  };

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function shouldPauseExecution() {
    return stopRequested || cooldownPauseRequested;
  }

  async function reliableBackgroundSignal(action, payload) {
    return new Promise((resolve) => {
      if (!chrome.runtime?.id) {
        console.warn("[X-Assistant] 插件上下文已失效，放行跳转");
        return resolve(false);
      }

      const statusId = payload.statusId || "none";
      const taskId = `task_${payload.username}_${payload.source}_${statusId}_${Date.now()}`;
      const enhancedPayload = { ...payload, taskId };

      chrome.runtime.sendMessage({ action, payload: enhancedPayload }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn("[X-Assistant] 裁决请求超时:", chrome.runtime.lastError.message);
          return resolve(false);
        }
        setTimeout(() => resolve(Boolean(response?.success)), 100);
      });
    });
  }

  function getSourceLabel(source) {
    const sourceTextMap = {
      comment: "评论区",
      follower: "粉丝池",
      manual_test: "手动测试",
      unknown: "未知"
    };
    return sourceTextMap[source] || sourceTextMap.unknown;
  }

  async function consumeStartSignal() {
    if (!chrome.runtime?.id) {
      return false;
    }

    try {
      const data = await chrome.storage.local.get(["startSignal"]);
      const timestamp = Number(data.startSignal);
      if (!Number.isFinite(timestamp) || Date.now() - timestamp >= 15000) {
        return false;
      }
      await chrome.storage.local.set({ startSignal: null });
      return true;
    } catch (_) {
      return false;
    }
  }

  async function consumeResumeSignal() {
    if (!chrome.runtime?.id) {
      return false;
    }

    try {
      const data = await chrome.storage.local.get(["resumeSignal"]);
      const payload = data && typeof data.resumeSignal === 'object' ? data.resumeSignal : null;
      const timestamp = Number(payload?.timestamp);
      if (!Number.isFinite(timestamp) || Date.now() - timestamp >= 20000) {
        return false;
      }
      await chrome.storage.local.set({ resumeSignal: null });
      return true;
    } catch (_) {
      return false;
    }
  }

  function appendDebugSentLedger(username, source) {
    if (!username) return;

    let latest = [];
    try {
      const raw = localStorage.getItem("__DEBUG_LAST_SENT__");
      latest = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(latest)) latest = [];
    } catch (_) {
      latest = [];
    }

    const normalizedUsername = String(username).toLowerCase();
    const filtered = latest.filter((entry) => {
      if (typeof entry === "string") {
        return String(entry).toLowerCase() !== normalizedUsername;
      }
      return String(entry?.username || "").toLowerCase() !== normalizedUsername;
    });

    filtered.push({ username, source: source || "unknown", timestamp: Date.now() });
    const next = filtered.slice(-3);
    localStorage.setItem("__DEBUG_LAST_SENT__", JSON.stringify(next));
    localStorage.setItem("__DEBUG_SENT_COUNT__", String(next.length));
  }

  function getPendingTarget() {
    try {
      const raw = sessionStorage.getItem("pending_target") || localStorage.getItem("pending_target");
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function setPendingTarget(target) {
    const serialized = JSON.stringify(target);
    sessionStorage.setItem("pending_target", serialized);
    localStorage.setItem("pending_target", serialized);
  }

  function clearPendingTarget() {
    sessionStorage.removeItem("pending_target");
    localStorage.removeItem("pending_target");
  }

  function getActiveFollowerTarget() {
    try {
      const raw = sessionStorage.getItem("active_follower_target") || localStorage.getItem("active_follower_target");
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function setActiveFollowerTarget(target) {
    const serialized = JSON.stringify(target);
    sessionStorage.setItem("active_follower_target", serialized);
    localStorage.setItem("active_follower_target", serialized);
  }

  function clearActiveFollowerTarget() {
    sessionStorage.removeItem("active_follower_target");
    localStorage.removeItem("active_follower_target");
  }

  function getDeliveredQueueMarks() {
    try {
      const raw = sessionStorage.getItem("delivered_comment_targets") || localStorage.getItem("delivered_comment_targets");
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function setDeliveredQueueMarks(usernames) {
    const normalized = Array.from(new Set(
      (Array.isArray(usernames) ? usernames : [])
        .map((username) => String(username || "").trim().toLowerCase())
        .filter(Boolean)
    ));
    const serialized = JSON.stringify(normalized);
    sessionStorage.setItem("delivered_comment_targets", serialized);
    localStorage.setItem("delivered_comment_targets", serialized);
  }

  function markDeliveredCommentTarget(username) {
    if (!username) return;
    const delivered = getDeliveredQueueMarks();
    delivered.push(username);
    setDeliveredQueueMarks(delivered);
  }

  function clearDeliveredCommentTarget(username) {
    if (!username) {
      sessionStorage.removeItem("delivered_comment_targets");
      localStorage.removeItem("delivered_comment_targets");
      return;
    }

    const normalizedUsername = String(username).trim().toLowerCase();
    const delivered = getDeliveredQueueMarks().filter((item) => item !== normalizedUsername);
    if (delivered.length === 0) {
      sessionStorage.removeItem("delivered_comment_targets");
      localStorage.removeItem("delivered_comment_targets");
      return;
    }
    setDeliveredQueueMarks(delivered);
  }

  function getPendingDmVerification() {
    try {
      const raw = sessionStorage.getItem("pending_dm_verify") || localStorage.getItem("pending_dm_verify");
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function setPendingDmVerification(marker) {
    const serialized = JSON.stringify(marker);
    sessionStorage.setItem("pending_dm_verify", serialized);
    localStorage.setItem("pending_dm_verify", serialized);
  }

  function clearPendingDmVerification() {
    sessionStorage.removeItem("pending_dm_verify");
    localStorage.removeItem("pending_dm_verify");
  }

  function clearAllSessionPendingMarkers() {
    const keysToRemove = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && (key.startsWith("pending_") || key.startsWith("comment_seen_"))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => sessionStorage.removeItem(key));
    console.log(`[X-Assistant] Cleared ${keysToRemove.length} stale pending markers.`);
  }

  function getEffectivePendingTarget() {
    const activeFollower = getActiveFollowerTarget();
    if (activeFollower && activeFollower.username) {
      return activeFollower;
    }
    return getPendingTarget();
  }

  function performDeepPurge() {
    console.log("[X-Assistant] 执行深度自净化：清理所有旧推文残留状态...");
    clearAllSessionPendingMarkers();
    clearCommentSession();
    clearCommentQueue();
    clearPendingTarget();
    clearActiveFollowerTarget();
    clearPendingDmVerification();
    sessionStorage.removeItem("followers_session_count");
    localStorage.removeItem("followers_session_count");
    sessionStorage.removeItem("current_hub_author");
    localStorage.removeItem("current_hub_author");
    sessionStorage.removeItem("delivered_comment_targets");
    localStorage.removeItem("delivered_comment_targets");
    localStorage.removeItem("__DEBUG_QUEUE_HEAD__");
  }

  function clearManualTestState() {
    clearPendingTarget();
    localStorage.removeItem("manual_test_active");
    localStorage.removeItem("manual_test_username");
  }

  function getCommentSession() {
    try {
      const raw = sessionStorage.getItem("comment_session") || localStorage.getItem("comment_session");
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function setCommentSession(session) {
    const serialized = JSON.stringify(session);
    sessionStorage.setItem("comment_session", serialized);
    localStorage.setItem("comment_session", serialized);
  }

  function clearCommentSession() {
    sessionStorage.removeItem("comment_session");
    localStorage.removeItem("comment_session");
  }

  function getCommentQueue() {
    try {
      const raw = sessionStorage.getItem("comment_queue") || localStorage.getItem("comment_queue");
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function setCommentQueue(queue) {
    const serialized = JSON.stringify(Array.isArray(queue) ? queue : []);
    sessionStorage.setItem("comment_queue", serialized);
    localStorage.setItem("comment_queue", serialized);
  }

  function clearCommentQueue() {
    sessionStorage.removeItem("comment_queue");
    localStorage.removeItem("comment_queue");
  }

  function reconcileCommentQueue(processedUsernames) {
    const queue = getCommentQueue();
    if (queue.length === 0) {
      localStorage.setItem("__DEBUG_QUEUE_HEAD__", "EMPTY");
      return null;
    }

    const blocked = new Set(
      (Array.isArray(processedUsernames) ? processedUsernames : [])
        .map((item) => String(item || "").toLowerCase())
        .filter(Boolean)
    );
    const nextQueue = queue.filter((item) => item && !blocked.has(String(item.username || "").toLowerCase()));

    if (nextQueue.length !== queue.length) {
      setCommentQueue(nextQueue);
    }

    const nextHead = nextQueue.length > 0 ? nextQueue[0].username : "EMPTY";
    localStorage.setItem("__DEBUG_QUEUE_HEAD__", nextHead);
    return nextQueue.length > 0 ? nextQueue[0] : null;
  }

  function enqueueCommentTargets(usernames, tweetUrl, statusId) {
    if (!Array.isArray(usernames) || usernames.length === 0) return getCommentQueue();

    const queue = getCommentQueue();
    const existing = new Set(queue.map(item => item && item.username).filter(Boolean));
    let changed = false;

    usernames.forEach((username) => {
      if (!username || existing.has(username)) return;
      queue.push({ username, tweetUrl, statusId, source: "comment", queuedAt: Date.now() });
      existing.add(username);
      changed = true;
    });

    if (changed) setCommentQueue(queue);
    return queue;
  }

  function shiftCommentQueue() {
    const queue = getCommentQueue();
    const next = queue.shift() || null;
    setCommentQueue(queue);
    return next;
  }

  function peekCommentQueue() {
    const queue = getCommentQueue();
    return queue.length > 0 ? queue[0] : null;
  }

  function completeCurrentCommentTarget(username) {
    let queue = getCommentQueue();
    if (queue.length === 0) {
      localStorage.setItem("__DEBUG_QUEUE_HEAD__", "EMPTY");
      return null;
    }

    if (username) {
      const targetLower = String(username).toLowerCase();
      queue = queue.filter(item => item && String(item.username).toLowerCase() !== targetLower);
    } else {
      queue.shift();
    }

    setCommentQueue(queue);
    const nextHead = queue.length > 0 ? queue[0].username : "EMPTY";
    localStorage.setItem("__DEBUG_QUEUE_HEAD__", nextHead);
    console.log(`[X-Assistant] Dequeued target. Next in queue: ${nextHead}`);
    return queue.length > 0 ? queue[0] : null;
  }

  function getCanonicalTweetUrl() {
    const match = window.location.href.match(/https:\/\/x\.com\/[^\/]+\/status\/\d+/i);
    return match ? match[0] : "";
  }

  function navigateBackToSource(source) {
    if (stopRequested) {
      console.log('[X-Assistant] STOP_REQUESTED: skip navigateBackToSource', { source });
      return;
    }
    if (source === "comment") {
      const commentSession = getCommentSession();
      const nextQueued = peekCommentQueue();
      if (nextQueued && nextQueued.username) {
        processTarget(nextQueued.username, "comment", nextQueued);
        return;
      }
      if (commentSession && commentSession.tweetUrl) {
        window.location.href = commentSession.tweetUrl;
        return;
      }
    }

    if (source === "follower") {
      const nextQueued = peekCommentQueue();
      if (nextQueued && nextQueued.username && nextQueued.source === "follower") {
        console.log(`[X-Assistant] 粉丝队列未空，继续处理下一个: @${nextQueued.username}`);
        processTarget(nextQueued.username, nextQueued.source, nextQueued);
        return;
      }

       console.log("[X-Assistant] 粉丝队列已空，收网返回首页。");
       clearCommentQueue();
       clearPendingTarget();
       clearActiveFollowerTarget();
       sessionStorage.removeItem("followers_session_count");
       localStorage.removeItem("followers_session_count");
       console.log(`[X-Assistant] 首页回归：保留上一轮推文 ID [${sessionStorage.getItem('last_auto_processed_id') || localStorage.getItem('last_auto_processed_id') || 'none'}]，准备进入下一轮首页去重选择。`);
       window.location.href = "https://x.com/home";
       return;
    }

    window.history.back();
  }

  function getProfileLocationText() {
    const aboutLocationNode = Array.from(document.querySelectorAll('div[role="dialog"], [data-testid="HoverCard"] div, [data-testid="HoverCard"] span, [data-testid="HoverCard"] a, [role="tooltip"] div, [role="tooltip"] span'))
      .find((node) => {
        const text = (node?.innerText || node?.textContent || '').trim();
        return /^账号所在地\s+/i.test(text) || /^Location\s+/i.test(text);
      });

    if (aboutLocationNode) {
      const aboutLocationText = (aboutLocationNode.innerText || aboutLocationNode.textContent || '')
        .replace(/^账号所在地\s*/i, '')
        .replace(/^Location\s*/i, '')
        .trim();
      if (aboutLocationText) return aboutLocationText;
    }

    return '';
  }

  async function resolveProfileLocationByHover({ attempts = 2, totalWaitMs = 1200, intervalMs = 120 } = {}) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      triggerAboutAccountHoverCard();

      const startedAt = Date.now();
      while (Date.now() - startedAt < totalWaitMs) {
        const locationText = getProfileLocationText();
        if (locationText) {
          return locationText;
        }
        await sleep(intervalMs);
      }
    }

    return '';
  }

  function isTaiwanProfile(config) {
    const regionKeywords = config.regionKeywords || FALLBACK_CONFIG.regionKeywords || [];
    if (!Array.isArray(regionKeywords) || regionKeywords.length === 0) {
      console.log('[X-Assistant] Region check bypassed: no regionKeywords configured.');
      return { matched: true, locationText: '' };
    }

    const locationText = getProfileLocationText();
    if (!locationText) {
      console.log('[X-Assistant] Region check: no profile location detected.');
      return { matched: false, locationText: '' };
    }

    const matched = regionKeywords.some((kw) => locationText.toLowerCase().includes(String(kw).toLowerCase()));
    console.log('[X-Assistant] Region check result.', {
      locationText,
      matched,
      regionKeywords,
    });
    return { matched, locationText };
  }

  function triggerAboutAccountHoverCard() {
    const joinNode = Array.from(document.querySelectorAll('[href$="/about"], [data-testid="UserProfileHeader_Items"] span, [data-testid="UserProfileHeader_Items"] a, time'))
      .find((node) => {
        const text = (node?.innerText || node?.textContent || '').trim();
        return /加入|Joined/i.test(text);
      });

    if (!joinNode) {
      return false;
    }

    const target = joinNode.closest('a, div, span') || joinNode;
    const rect = typeof target.getBoundingClientRect === 'function'
      ? target.getBoundingClientRect()
      : { left: 0, top: 0, width: 0, height: 0 };
    const clientX = Math.round(rect.left + rect.width / 2);
    const clientY = Math.round(rect.top + rect.height / 2);

    ['pointerenter', 'mouseenter', 'pointerover', 'mouseover', 'pointermove', 'mousemove'].forEach((type) => {
      const EventCtor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
      target.dispatchEvent(new EventCtor(type, {
        view: window,
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
        pointerId: 1,
        pointerType: 'mouse',
      }));
    });
    return true;
  }

  function findDmComposer() {
      return document.querySelector('textarea[data-testid="dm-composer-textarea"]') ||
        document.querySelector('[data-testid="dm-composer-textarea"]') ||
        document.querySelector('textarea[placeholder*="Message"]') ||
        document.querySelector('textarea[placeholder*="Unencrypted message"]') ||
        document.querySelector('[data-testid="dmComposerTextInput"]') ||
           document.querySelector('[data-testid="dmComposerTextInput"] [contenteditable="true"]') ||
           document.querySelector('.public-DraftEditor-content') ||
           document.querySelector('[data-testid="conversation"] [contenteditable="true"]') ||
           document.querySelector('[aria-label*="Message"][contenteditable="true"]') ||
           document.querySelector('[aria-label*="消息"][contenteditable="true"]') ||
           document.querySelector('[aria-label*="Unencrypted message"][contenteditable="true"]') ||
           document.querySelector('div.bg-gray-50.rounded-\\[24px\\]') ||
           document.querySelector('div[class*="bg-gray-50"][class*="rounded-"]') ||
           document.querySelector('[contenteditable="true"][role="textbox"]');
  }

  function clickProfileDmButton() {
    const selectors = [
      '[data-testid="sendDMFromProfile"]',
      'a[href*="/messages/compose"]',
      'button[aria-label="私信"]',
      'button[aria-label="发送私信"]',
      'button[aria-label="發送私訊"]',
      'button[aria-label="傳送訊息"]'
    ];
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node) {
        console.log("[X-Assistant] DM button found:", selector);
        const target = node.closest('button,a,[role="button"]') || node;
        target.click();
        console.log(`[X-Assistant] DM direct hit by selector: ${selector}`);
        return true;
      }
    }
    // 语义兜底：仅在主页头部动作区挑选“私信语义”按钮，避免误点侧边栏/更多/关注
    const fallbackButtons = Array.from(document.querySelectorAll('button,[role="button"],a'));
    let best = null;
    let bestScore = -1;
    for (const node of fallbackButtons) {
      const rect = node.getBoundingClientRect();
      // 主页头部动作区大致在右侧，限制范围防止命中左侧导航“私信”
      if (rect.left < 780 || rect.top < 180 || rect.top > 380) continue;

      const testid = (node.getAttribute('data-testid') || '').toLowerCase();
      const aria = (node.getAttribute('aria-label') || '').toLowerCase();
      const title = (node.getAttribute('title') || '').toLowerCase();
      const text = (node.innerText || node.textContent || '').trim().toLowerCase();
      const combinedText = `${aria} ${title} ${text}`;

      // 明确排除“更多/关注/Premium”相关按钮
      if (/更多|more|follow|关注|premium|gift/.test(combinedText)) continue;

      let score = 0;
      if (testid.includes('senddmfromprofile')) score += 100;
      if (/私信|發送私訊|发送私信|傳送訊息|direct message|send message/.test(combinedText)) score += 80;
      if (/message/.test(combinedText)) score += 20;
      if (score > bestScore) {
        bestScore = score;
        best = node;
      }
    }
    if (best && bestScore >= 80) {
      best.click();
      console.log('[X-Assistant] DM fallback hit with score:', bestScore, best);
      return true;
    }
    console.log("[X-Assistant] DM button not found by selectors.");
    return false;
  }

  function clickDmFromMoreMenu() {
    const menuItems = Array.from(document.querySelectorAll('[role="menuitem"], [data-testid="Dropdown"] [role="button"], [data-testid="Dropdown"] [role="menuitem"]'));
    const dmItem = menuItems.find(item => {
      const text = (item.innerText || item.textContent || "").trim();
      return /私信|發送私訊|发送私信|傳送訊息|message|send message|direct message/i.test(text);
    });
    if (dmItem) {
      dmItem.click();
      console.log("[X-Assistant] DM menu item clicked from more menu.");
      return true;
    }
    return false;
  }

  function openMoreMenu() {
    const moreSelectors = [
      '[data-testid="userActions"]',
      'button[aria-label*="More"]',
      'button[aria-label*="更多"]',
      'button[aria-label*="更多操作"]',
      'button[aria-label*="更多选项"]',
      'button[aria-label*="更多選項"]',
      'button[aria-label*="更多動作"]'
    ];
    for (const selector of moreSelectors) {
      const node = document.querySelector(selector);
      if (node) {
        node.click();
        console.log(`[X-Assistant] More menu opened by selector: ${selector}`);
        return true;
      }
    }
    return false;
  }

  function hasNoDmCapabilityMarker() {
    // 来自用户截图：某些主页无私信按钮，只出现 role=generic 的动作容器
    const marker = document.querySelector(
      'div[role="generic"].r-quvtc0.r-37j5jr.r-a023e6.r-rjxqe, div[role="generic"].r-quvtc0.r-37j5jr.r-q4m81j, div[role="generic"].css-175oi2r.r-bnwqim'
    );
    return !!marker;
  }

  function triggerCommentSectionLoad() {
    const replyButton = document.querySelector('[data-testid="reply"]');
    if (replyButton) {
      replyButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return true;
    }

    const composer = document.querySelector('[data-testid="tweetTextarea_0"], [data-testid="tweetText"]');
    if (composer) {
      composer.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return true;
    }

    return false;
  }

  function isProfileActionBarReady() {
    const readySelectors = [
      'button[aria-label*="关注 @"]',
      'button[aria-label*="Follow @"]',
      'button[aria-label="更多"]',
      'button[aria-label="More"]',
      'a[href*="/gift-premium"]'
    ];
    return readySelectors.some((selector) => !!document.querySelector(selector));
  }

  function dumpProfileActionCandidates() {
    const candidates = Array.from(document.querySelectorAll('button,[role="button"],a'))
      .map((node) => ({
        testid: node.getAttribute("data-testid") || "",
        aria: node.getAttribute("aria-label") || "",
        cls: (node.className || "").toString().slice(0, 120),
        text: (node.innerText || node.textContent || "").trim().slice(0, 30)
      }))
      .filter((item) => item.testid || item.aria || item.text)
      .slice(0, 40);
    console.log("[X-Assistant] action candidates:", candidates);
  }

  window.XAssistantSnapshot = function() {
    const pending = getPendingTarget();
    const data = {
      url: location.href,
      manualTestActive: localStorage.getItem("manual_test_active"),
      pending,
      hasDmComposer: !!findDmComposer(),
      hasDmProfileBtn: !!document.querySelector('[data-testid="sendDMFromProfile"]'),
      hasUserActions: !!document.querySelector('[data-testid="userActions"]'),
      timestamp: Date.now()
    };
    console.log("[X-Assistant] snapshot", data);
    return data;
  };

  window.addEventListener("message", (event) => {
    if (event.data && event.data.type === "X_START_NOW") {
      stopRequested = false;
      dmInjecting = false;
      scrollCount = 0;
      lastDmInjectAt = 0;
      const intent = event.data.intent === "fresh_start" ? "fresh_start" : "resume";

      if (intent === "fresh_start") {
        performDeepPurge();
        console.log("[X-Assistant] 收到全新启动指令，已彻底清空旧会话残留。");
      } else {
        console.log("[X-Assistant] 收到恢复/热启动指令，保留当前上下文继续运行...");
      }

      console.log("[X-Assistant] 前台硬复位成功。正在从当前页面起跑...");
      forceCheck = true;
      check();
      return;
    }

    if (event.data && event.data.type === "X_STOP_NOW") {
      console.log("[X-Assistant] STOP SIGNAL RECEIVED.");
      stopRequested = true;
      forceCheck = false;
      dmInjecting = false;
      performDeepPurge();
      localStorage.removeItem("manual_test_active");
      localStorage.removeItem("manual_test_username");
    }
  }, false);

  async function check() {
    try {
      const hasStartSignal = await consumeStartSignal();
      const hasResumeSignal = await consumeResumeSignal();
      if (hasStartSignal) {
        stopRequested = false;
        dmInjecting = false;
        scrollCount = 0;
        lastDmInjectAt = 0;
        forceCheck = true;
      }

      if (hasResumeSignal && !hasStartSignal) {
        stopRequested = false;
        cooldownPauseRequested = false;
        dmInjecting = false;
        forceCheck = true;
        window.postMessage({ type: "X_START_NOW", intent: "resume" }, "*");
      }

      // 硬停闸门：只要 runtimeState 明确 running=false，就立即停止。
      // 这是为了解决：后台临时不可用时（sendMessage lastError）content 走 fallback 继续运行，导致“点停止停不掉”。
      try {
        const data = await chrome.storage.local.get(["runtimeState"]);
        const rt = data && typeof data.runtimeState === 'object' ? data.runtimeState : null;
        if (rt && rt.running === false) {
          stopRequested = true;
          forceCheck = false;
          dmInjecting = false;
          performDeepPurge();
          localStorage.removeItem("manual_test_active");
          localStorage.removeItem("manual_test_username");
          return;
        }
      } catch (_) {}

      if (!chrome.runtime || !chrome.runtime.id) {
        if (hasStartSignal) {
          // Safety valve: avoid reload loop that can freeze X in a black screen.
          const KEY = '__X_ASSISTANT_LAST_AUTO_RELOAD_TS__';
          const now = Date.now();
          const last = Number(sessionStorage.getItem(KEY) || '0');
          if (!Number.isFinite(last) || now - last > 15000) {
            sessionStorage.setItem(KEY, String(now));
            setTimeout(() => window.location.reload(), 200);
          } else {
            console.warn('[X-Assistant] Skipping auto-reload (throttled)');
          }
        } else if (Math.random() < 0.01) {
          console.log("[X-Assistant] Extension context invalidated (Reloading might be needed).");
        }
        return;
      }
      if (stopRequested) {
        return;
      }
      if (await consumePendingDmVerification(FALLBACK_CONFIG)) {
        return;
      }
      if (tryFinalizeDeliveredMarkRecovery()) {
        return;
      }
      if (tryFinalizeDeliveredCommentTarget(FALLBACK_CONFIG)) {
        return;
      }
      const pendingBeforeQuota = getPendingTarget();
      const manualTestLock = localStorage.getItem("manual_test_active") === "1";
      const canRunWithoutQuota = !!pendingBeforeQuota || manualTestLock || forceCheck;

      chrome.runtime.sendMessage({ action: "GET_QUOTA_STATUS" }, async (res) => {
        if (chrome.runtime.lastError) {
          if (!canRunWithoutQuota) {
            return;
          }

          console.warn("[X-Assistant] GET_QUOTA_STATUS failed, using fallback runtime state:", chrome.runtime.lastError.message);
          res = {
            canProceed: true,
            config: FALLBACK_CONFIG,
            history: [],
            blacklist: [],
            stats: { daily: 0, hourly: 0 }
          };
        }

        if (!res) {
          if (!canRunWithoutQuota) {
            return;
          }

          res = {
            canProceed: true,
            config: FALLBACK_CONFIG,
            history: [],
            blacklist: [],
            stats: { daily: 0, hourly: 0 }
          };
        }

        if (res && Array.isArray(res.sent)) {
          localStorage.setItem("__DEBUG_SENT_COUNT__", String(res.sent.length));
          localStorage.setItem("__DEBUG_LAST_SENT__", JSON.stringify(res.sent.slice(-3)));
        }

        const url = window.location.href;
        const isFollowersPage = url.includes("/followers");
        const isStatusPage = url.includes("/status/");
        const activeFollowersSession = isFollowersPage && sessionStorage.getItem("followers_session_count") !== null;
        const now = Date.now();
        const cooldownUntil = Number(res?.pause?.resumeAtTs || res?.stats?.cooldownUntil || 0);
        const inActiveCooldown = Boolean(res?.cooldowned) && cooldownUntil > now;

        if (inActiveCooldown) {
          cooldownPauseRequested = true;
          if (Math.random() < 0.1) {
            console.log("[X-Assistant] Cooldown active, queue preserved and execution paused.", {
              cooldownUntil,
              hasPendingBeforeQuota: !!pendingBeforeQuota,
              activeFollowersSession,
              url
            });
          }
          return;
        }

        cooldownPauseRequested = false;

        if (isStatusPage) {
          console.log("[X-Assistant] Status preflight.", {
            url,
            canProceed: res?.canProceed,
            forceCheck,
            hasPendingBeforeQuota: !!pendingBeforeQuota,
            manualTestLock
          });
        }

        if (isFollowersPage) {
          console.log("[X-Assistant] Followers preflight.", {
            canProceed: res?.canProceed,
            forceCheck,
            hasPendingBeforeQuota: !!pendingBeforeQuota,
            manualTestLock,
            activeFollowersSession,
            url
          });
        }

        if (!res.canProceed && !forceCheck && !pendingBeforeQuota && !manualTestLock && !activeFollowersSession) {
          if (isFollowersPage) {
            console.log("[X-Assistant] Followers gate blocked.", {
              canProceed: res.canProceed,
              forceCheck,
              hasPendingBeforeQuota: !!pendingBeforeQuota,
              manualTestLock,
              url
            });
          }
          if (Math.random() < 0.05) console.log("[X-Assistant] Idle / Rate Limited / Sleeping.");
          return;
        }

        const config = res.config || {};
        if (await consumePendingDmVerification(config)) {
          return;
        }
        if (tryFinalizeDeliveredMarkRecovery()) {
          return;
        }
        if (tryFinalizeDeliveredCommentTarget(config)) {
          return;
        }
        const history = res.history || [];
        const blacklist = res.blacklist || [];
        const sentList = res.sent || [];
        const historySet = new Set(history.map((item) => String(item || '').toLowerCase()).filter(Boolean));
        const blacklistSet = new Set(blacklist.map((item) => String(item || '').toLowerCase()).filter(Boolean));
        const sentSet = new Set(sentList.map((item) => String(item || '').toLowerCase()).filter(Boolean));
        const processedUsernames = [...history, ...blacklist, ...sentList];
        reconcileCommentQueue(processedUsernames);
        const commentSession = getCommentSession();
        
        // 1. 自动从持久化存储恢复 manual_test_username (单测兜底)
        const manualTargetUsername = localStorage.getItem("manual_test_username");
        const isMessagingPage = url.includes("/messages") || url.includes("/i/chat/");

        if (!manualTestLock && manualTargetUsername) {
          localStorage.removeItem("manual_test_username");
        }
        
        if (manualTestLock && manualTargetUsername && !getPendingTarget() && !isMessagingPage) {
          const profileRegex = new RegExp(`x\\.com/${manualTargetUsername}(/|\\?|#|$)`, "i");
          if (!profileRegex.test(url)) {
            // 不在目标主页，且没在发私信，强制跳转回目标主页
            if (url.includes("x.com/home") || url === "https://x.com/" || url === "https://x.com") {
              // 关键修复：如果在私信页被踢回主页，说明可能还没发送成功，尝试重新进入
              console.log("[X-Assistant] Manual test active but on home. Redirecting to:", manualTargetUsername);
              window.location.href = `https://x.com/${manualTargetUsername}`;
              return;
            }
          }
        }

        let pending = getEffectivePendingTarget();
        const activeFollowerTarget = getActiveFollowerTarget();

        if (pending && pending.username) {
          const normalizedPendingUsername = String(pending.username).toLowerCase();
          if (historySet.has(normalizedPendingUsername) || blacklistSet.has(normalizedPendingUsername) || sentSet.has(normalizedPendingUsername)) {
            console.log(`[X-Assistant] 跳过已处理目标 @${pending.username}，不再继续进入聊天或发送。`);
            if (pending.source === "follower") {
              sessionStorage.removeItem(`pending_${pending.username}`);
              clearActiveFollowerTarget();
            }
            clearPendingTarget();
            dmInjecting = false;
            navigateBackToSource(pending.source || "unknown");
            return;
          }
        }

        if (!pending && !manualTestLock && isMessagingPage) {
          if (activeFollowerTarget && activeFollowerTarget.username && activeFollowerTarget.source === "follower") {
            pending = {
              ...activeFollowerTarget,
              stage: activeFollowerTarget.stage || "open_dm_clicked",
              createdAt: activeFollowerTarget.createdAt || Date.now(),
              lastActionAt: activeFollowerTarget.lastActionAt || activeFollowerTarget.createdAt || Date.now()
            };
            setPendingTarget(pending);
            console.log("[X-Assistant] Recovered active follower target in messaging page:", pending.username);
          }
        }

        if (!pending && !manualTestLock && !isMessagingPage) {
          if (activeFollowerTarget && activeFollowerTarget.username && activeFollowerTarget.source === "follower") {
            const currentUsername = getCurrentTopLevelUsername(url);
            if (currentUsername && currentUsername.toLowerCase() === activeFollowerTarget.username.toLowerCase()) {
              pending = {
                ...activeFollowerTarget,
                stage: activeFollowerTarget.stage || "open_profile",
                createdAt: activeFollowerTarget.createdAt || Date.now(),
                lastActionAt: activeFollowerTarget.lastActionAt || activeFollowerTarget.createdAt || Date.now()
              };
              setPendingTarget(pending);
              console.log("[X-Assistant] Recovered active follower target on profile:", pending.username);
            }
          }
        }

        if (!pending && !manualTestLock && isMessagingPage) {
          const queuedTarget = peekCommentQueue();
          if (queuedTarget && queuedTarget.username && (queuedTarget.source || "comment") === "comment") {
            const templatePool = Array.isArray(config.dmTemplates) && config.dmTemplates.length > 0
              ? config.dmTemplates
              : FALLBACK_CONFIG.dmTemplates;
            const templates = templatePool.filter(t => t.type === queuedTarget.source || !t.type);
            const expectedTemplate = ((templates.length > 0 ? templates[0] : templatePool[0])?.content || "hi").trim();
            const latestMessage = getLatestConversationMessageText();

            if (latestMessage && latestMessage.includes(expectedTemplate)) {
              markDeliveredCommentTarget(queuedTarget.username);
              chrome.runtime.sendMessage({
                action: "MARK_SENT_CONFIRMED",
                payload: {
                  username: queuedTarget.username,
                  source: "comment"
                }
              }).catch(() => {
                console.warn("[X-Assistant] MARK_SENT_CONFIRMED failed during chat-page recovery closeout.");
              });
              completeCurrentCommentTarget(queuedTarget.username);
              clearDeliveredCommentTarget(queuedTarget.username);
              clearPendingTarget();
              dmInjecting = false;
              navigateBackToSource("comment");
              return;
            }

            pending = {
              username: queuedTarget.username,
              source: "comment",
              stage: "open_dm_clicked",
              createdAt: Date.now(),
              lastActionAt: Date.now()
            };
            setPendingTarget(pending);
            sessionStorage.setItem("last_engaged_username", queuedTarget.username);
            sessionStorage.setItem("last_engaged_source", "comment");
            forceCheck = true;
            console.log("[X-Assistant] Recovered comment pending target in messaging page:", queuedTarget.username);
          }
        }

        if (!pending && !manualTestLock && !isMessagingPage) {
          const currentUsername = getCurrentTopLevelUsername(url);
          const queuedTarget = peekCommentQueue();
          if (currentUsername && queuedTarget && queuedTarget.username && (queuedTarget.source || "comment") === "comment" && currentUsername.toLowerCase() === queuedTarget.username.toLowerCase()) {
            pending = {
              username: queuedTarget.username,
              source: queuedTarget.source || "comment",
              stage: "open_profile",
              createdAt: Date.now(),
              lastActionAt: Date.now()
            };
            setPendingTarget(pending);
            sessionStorage.setItem("last_engaged_username", queuedTarget.username);
            sessionStorage.setItem("last_engaged_source", queuedTarget.source || "comment");
            console.log("[X-Assistant] Forced queue-head claim on profile:", queuedTarget.username);
          }
          if (currentUsername && queuedTarget && queuedTarget.username && (queuedTarget.source || "comment") === "comment" && currentUsername.toLowerCase() !== queuedTarget.username.toLowerCase()) {
            const nextPending = {
              username: queuedTarget.username,
              source: queuedTarget.source || "comment",
              stage: "open_profile",
              createdAt: Date.now(),
              lastActionAt: Date.now()
            };
            setPendingTarget(nextPending);
            sessionStorage.setItem("last_engaged_username", queuedTarget.username);
            sessionStorage.setItem("last_engaged_source", queuedTarget.source || "comment");
            console.log("[X-Assistant] Current profile mismatches queue head. Redirecting to:", queuedTarget.username);
            window.location.href = `https://x.com/${queuedTarget.username}`;
            return;
          }
          if (!pending && currentUsername && queuedTarget && queuedTarget.username && (queuedTarget.source || "comment") === "comment" && currentUsername.toLowerCase() === queuedTarget.username.toLowerCase()) {
            pending = {
              username: queuedTarget.username,
              source: "comment",
              stage: "open_profile",
              createdAt: Date.now()
            };
            setPendingTarget(pending);
            sessionStorage.setItem("last_engaged_username", queuedTarget.username);
            sessionStorage.setItem("last_engaged_source", "comment");
            console.log("[X-Assistant] Recovered comment pending target from queue:", queuedTarget.username);
          }
        }

        // 2. 单测锁存在但 pending 丢失时，辅助重建
        if (manualTestLock && !pending && !isMessagingPage) {
          const profileMatch = url.match(/x\.com\/([^\/?#]+)/i);
          if (profileMatch) {
            const username = profileMatch[1];
            // 排除系统路径
            const systemPaths = ["home", "explore", "notifications", "messages", "settings", "i", "compose", "search"];
            if (!systemPaths.includes(username.toLowerCase())) {
              pending = {
                username,
                source: "manual_test",
                stage: "open_profile",
                createdAt: Date.now()
              };
              setPendingTarget(pending);
              localStorage.setItem("manual_test_username", username); // 双重锁定
              console.log("[X-Assistant] Recovered pending target from URL:", username);
            }
          }
        }

        // 单测模式下，如果在消息页，【绝对严禁】任何自动回退逻辑
        if (manualTestLock && isMessagingPage) {
          // 如果已经在消息页且有输入框，直接进入注入逻辑
          const composer = findDmComposer();
          if (composer && !dmInjecting && Date.now() - lastDmInjectAt > 12000) {
            injectDM(config, pending || { username: manualTargetUsername, source: "manual_test" });
            return;
          }
          // 如果没找到输入框，静默等待。严禁调用 window.history.back()
          if (Math.random() < 0.05) console.log("[X-Assistant] Manual test: Messaging page active, waiting human/composer...");
          return;
        }

        // 单测硬锁：只允许 pending / 消息页流程，禁用普通 Hunter/Hub/Pool 分支
        if (manualTestLock && !pending && !isMessagingPage) {
          return;
        }

        // --- 场景 A0: 私信页优先判断是否已经发出，避免重复注入 ---
        const composer = findDmComposer();
        if (pending && isMessagingPage && (pending.source === "comment" || pending.source === "follower")) {
          const expectedTemplate = getExpectedTemplateForSource(config, pending.source);
          const latestMessage = getLatestConversationMessageText();
          if (latestMessage && latestMessage.includes(expectedTemplate)) {
            chrome.runtime.sendMessage({
              action: "MARK_SENT_CONFIRMED",
              payload: {
                username: pending.username,
                source: pending.source || "comment"
              }
            }).catch(() => {
              console.warn("[X-Assistant] MARK_SENT_CONFIRMED failed during pre-inject closeout.");
            });
            completeCurrentCommentTarget(pending.username);
            if (pending.source === "follower") {
              sessionStorage.removeItem(`pending_${pending.username}`);
              clearActiveFollowerTarget();
            }
            clearPendingTarget();
            dmInjecting = false;
            navigateBackToSource(pending.source);
            return;
          }
        }

        if (composer && pending && !dmInjecting && Date.now() - lastDmInjectAt > 12000) {
          injectDM(config, pending);
          forceCheck = false;
          return;
        }

        // --- 场景 A0.5: 已进入消息系统但输入框尚未就绪，避免回到主页重试点击 ---
        if (pending && isMessagingPage) {
          if (pending.source === "comment" || pending.source === "follower") {
            const expectedTemplate = getExpectedTemplateForSource(config, pending.source);
            const latestMessage = getLatestConversationMessageText();
            if (latestMessage && latestMessage.includes(expectedTemplate)) {
              markDeliveredCommentTarget(pending.username);
              chrome.runtime.sendMessage({
                action: "MARK_SENT_CONFIRMED",
                payload: {
                  username: pending.username,
                  source: pending.source || "comment"
                }
              }).catch(() => {
                console.warn("[X-Assistant] MARK_SENT_CONFIRMED failed during chat-page auto closeout.");
              });
              completeCurrentCommentTarget(pending.username);
              clearDeliveredCommentTarget(pending.username);
              if (pending.source === "follower") {
                sessionStorage.removeItem(`pending_${pending.username}`);
                clearActiveFollowerTarget();
              }
              clearPendingTarget();
              dmInjecting = false;
              navigateBackToSource(pending.source);
              return;
            }
          }

          const waitMs = Date.now() - (pending.lastActionAt || pending.createdAt || Date.now());
          if (pending.stage === "open_dm_clicked" || pending.stage === "more_opened") {
            if (waitMs > 90000) {
              console.warn("[X-Assistant] Message page timeout waiting composer.");
              markDeliveredCommentTarget(pending.username);
              chrome.runtime.sendMessage({
                action: "LOG_TASK",
                payload: {
                  username: pending.username,
                  status: "failed",
                  details: "消息页已打开但输入框未就绪",
                  source: pending.source || "unknown"
                }
              });
              clearPendingTarget();
              dmInjecting = false;
              if (pending.source === "follower") {
                sessionStorage.removeItem(`pending_${pending.username}`);
                clearActiveFollowerTarget();
              }
              if (pending.source !== "manual_test") {
                navigateBackToSource(pending.source);
              }
            }
            return;
          }
        }

        // --- 场景 A1: Pending 目标状态机（主页点私信，替代错误 recipient_id） ---
        if (pending) {
          const pendingAge = Date.now() - (pending.createdAt || 0);
          // 单测模式有效期延长至 15 分钟，防止手动由于网络慢或手动干预导致任务突然消失
          const pendingExpireMs = pending.source === "manual_test" ? 900000 : 120000;
          if (pendingAge > pendingExpireMs) {
            const queuedTarget = peekCommentQueue();
            const currentUsername = getCurrentTopLevelUsername(url);
            const canRecoverExpiredCommentTarget = pending.source === "comment" &&
              queuedTarget &&
              queuedTarget.username &&
              currentUsername &&
              queuedTarget.username.toLowerCase() === currentUsername.toLowerCase();

            if (canRecoverExpiredCommentTarget) {
              pending = {
                username: queuedTarget.username,
                source: "comment",
                stage: "open_profile",
                createdAt: Date.now(),
                lastActionAt: Date.now()
              };
              setPendingTarget(pending);
              console.warn("[X-Assistant] Pending target expired, recovered from queue head on profile.");
            } else {
              console.warn("[X-Assistant] Pending target expired, clearing.");
              clearPendingTarget();
              dmInjecting = false;
              if (pending.source === "manual_test") {
                clearManualTestState();
              }
              return;
            }
          }

          const onTargetProfile = isTargetProfilePage(pending.username, url);

          if (!onTargetProfile && !isMessagingPage) {
            const currentTopLevelUsername = getCurrentTopLevelUsername(url);
            if (currentTopLevelUsername.toLowerCase() !== String(pending.username || "").toLowerCase() || url.includes("/status/")) {
              setPendingTarget({
                ...pending,
                stage: "open_profile",
                createdAt: Date.now(),
                lastActionAt: Date.now()
              });
              console.log("[X-Assistant] Pending target not on target profile yet. Redirecting:", pending.username, url);
              window.location.href = `https://x.com/${pending.username}`;
              return;
            }

            if (Math.random() < 0.1) console.log("[X-Assistant] Waiting target profile shell to become ready...");
            return;
          }

          if (onTargetProfile) {
            // 在主页且手动单测模式，每隔 5s 强制更新时间戳防止过期
            if (pending.source === "manual_test") {
              setPendingTarget({ ...pending, createdAt: Date.now() });
              console.log("[X-Assistant] Refreshing manual test lifetime...");
            }

            const isBarReady = isProfileActionBarReady();

            if (isBarReady) {
              const hardSkipDmSelectors = [
                '[data-testid="sendDMFromProfile"]',
                'a[href*="/messages/compose"]',
                'button[aria-label="私信"]',
                'button[aria-label="发送私信"]',
                'button[aria-label="發送私訊"]',
                'button[aria-label="傳送訊息"]',
                'button[aria-label*="Message"]',
                'button[aria-label*="訊息"]',
                'button[aria-label*="消息"]'
              ];
              const hasHardDmButton = hardSkipDmSelectors.some((selector) => !!document.querySelector(selector));

              if (!hasHardDmButton) {
                const fallbackButtons = Array.from(document.querySelectorAll('button,[role="button"],a')).filter((node) => {
                  const combined = `${node.getAttribute('data-testid') || ''} ${node.getAttribute('aria-label') || ''} ${node.innerText || node.textContent || ''}`.toLowerCase();
                  return /私信|發送私訊|发送私信|傳送訊息|message/i.test(combined) && !/更多|more|follow|关注|premium|gift/.test(combined);
                });

                if (fallbackButtons.length === 0) {
                  console.warn(`[X-Assistant] HARD SKIP: @${pending.username} 动作栏就绪且无私信按钮，极速拉黑跳过。`);
                  chrome.runtime.sendMessage({
                    action: "LOG_TASK",
                    payload: {
                      username: pending.username,
                      status: "no_dm_capability",
                      details: "动作栏已就绪但无私信按钮，已极速跳过",
                      source: pending.source || "unknown"
                    }
                  });
                  completeCurrentCommentTarget(pending.username);
                  clearDeliveredCommentTarget(pending.username);
                  clearPendingTarget();
                  dmInjecting = false;
                  if (pending.source === "follower") {
                    sessionStorage.removeItem(`pending_${pending.username}`);
                    clearActiveFollowerTarget();
                  }

                  setTimeout(() => {
                    if (pending.source !== "manual_test") {
                      navigateBackToSource(pending.source);
                    } else {
                      clearManualTestState();
                    }
                  }, 150);
                  return;
                }
              }
            }

            // 主页动作栏尚未加载完成时，先等待，避免误判“无私信按钮”
            if (!isBarReady) {
              const profileReadyTimeout = 15000;
              if (pendingAge < profileReadyTimeout) {
                if (pendingAge % 6000 < 2000) {
                  console.log("[X-Assistant] Profile action bar not ready, waiting...");
                }
                return;
              }
            }

            if (pending.source === "comment" || pending.source === "follower") {
              const hoveredLocationText = await resolveProfileLocationByHover();
              let regionCheck = hoveredLocationText
                ? {
                    matched: (config.regionKeywords || FALLBACK_CONFIG.regionKeywords || []).some((kw) => hoveredLocationText.toLowerCase().includes(String(kw).toLowerCase())),
                    locationText: hoveredLocationText,
                  }
                : isTaiwanProfile(config);

              if (!regionCheck.matched) {
                const isUnknownRegion = !String(regionCheck.locationText || '').trim();
                if (isUnknownRegion) {
                  console.warn("[X-Assistant] Profile region unknown, skip without blacklist:", pending.username);
                  chrome.runtime.sendMessage({
                    action: "LOG_TASK",
                    payload: {
                      username: pending.username,
                      status: "region_unknown_skipped",
                      details: "主页地区未知，已跳过（未拉黑）",
                      source: pending.source || "unknown"
                    }
                  });
                } else {
                  console.warn("[X-Assistant] Profile region is not target region, blacklist and skip:", pending.username, regionCheck.locationText);
                  chrome.runtime.sendMessage({
                    action: "LOG_TASK",
                    payload: {
                      username: pending.username,
                      status: "region_filtered",
                      details: `主页地区非目标地区：${regionCheck.locationText}`,
                      source: pending.source || "unknown"
                    }
                  });
                }
                completeCurrentCommentTarget(pending.username);
                clearPendingTarget();
                dmInjecting = false;
                if (pending.source === "follower") {
                  sessionStorage.removeItem(`pending_${pending.username}`);
                  clearActiveFollowerTarget();
                }
                navigateBackToSource(pending.source);
                return;
              }
            }

            // 【关键】防止无限循环：如果已经点击过私信按钮，且当前还在 Profile 页面，不要反复点击
            // 等待跳转即可；如果 30 秒还没跳走，说明点击可能没生效，再允许重试
            const waitAfterClick = pending.stage === "open_dm_clicked" && (Date.now() - (pending.lastActionAt || 0) < 90000);
            if (waitAfterClick) {
              if (Math.random() < 0.1) console.log("[X-Assistant] DM clicked, waiting for redirect...");
              return;
            }

            let clicked = clickProfileDmButton();

            if (clicked) {
              setPendingTarget({ ...pending, stage: "open_dm_clicked", lastActionAt: Date.now(), createdAt: Date.now() });
              console.log("[X-Assistant] SUCCESS: Clicked DM button. Waiting for page change.");
            } else {
              console.warn("[X-Assistant] DM button not found on profile, skip target immediately.");
              dumpProfileActionCandidates();
              chrome.runtime.sendMessage({
                action: "LOG_TASK",
                payload: {
                  username: pending.username,
                  status: "no_dm_capability",
                  details: "主页无私信按钮，已跳过",
                  source: pending.source || "unknown"
                }
              });
              completeCurrentCommentTarget(pending.username);
              clearDeliveredCommentTarget(pending.username);
              clearPendingTarget();
              dmInjecting = false;
              if (pending.source === "follower") {
                sessionStorage.removeItem(`pending_${pending.username}`);
                clearActiveFollowerTarget();
              }
              if (pending.source !== "manual_test") {
                navigateBackToSource(pending.source);
              } else {
                clearManualTestState();
              }
            }
            return;
          }
        }

        // --- 场景 B: 推文详情页 (评论链路模式) ---
        if (url.includes("/status/")) {
          const currentTweetUrl = getCanonicalTweetUrl();
          if (commentSession && commentSession.tweetUrl && currentTweetUrl && commentSession.tweetUrl !== currentTweetUrl) {
            performDeepPurge();
          }

          const conversationTimeline = getConversationTimelineContainer();
          const tweetArticles = Array.from((conversationTimeline || document).querySelectorAll('article[data-testid="tweet"]'));
          console.log("[X-Assistant] Comment branch entered.", {
            url,
            hasConversationTimeline: !!conversationTimeline,
            tweetArticleCount: tweetArticles.length,
            scrollCount
          });
          const hasCommentArticles = tweetArticles.length > 1;
          if (!hasCommentArticles) {
            if (scrollCount >= 12) {
              console.log("[X-Assistant] Comment DOM still not loaded after scrolling.");
              clearCommentSession();
              clearCommentQueue();
              scrollCount = 0;
            } else {
              triggerCommentSectionLoad();
              window.scrollBy(0, 900);
              scrollCount++;
            }
            return;
          }

          const authorHandles = getPostAuthorHandles();
          const authorHandle = authorHandles.length > 0 ? authorHandles[0] || "" : "";
          const commentRecentDays = Number(config.commentRecentDays || config.commentWindowDays || 3);
          console.log("[X-Assistant] Comment scan starting.", {
            authorHandle,
            commentRecentDays,
            currentTweetUrl
          });
          const targets = scanHandles(res, authorHandle, commentRecentDays);
          const queued = enqueueCommentTargets(targets, currentTweetUrl, getCurrentStatusId());
          console.log("[X-Assistant] Comment enqueue result.", {
            acceptedTargets: targets,
            queueLength: queued.length,
            nextHead: queued[0]?.username || null
          });

          if (queued.length > 0) {
            const nextQueued = peekCommentQueue();
            if (nextQueued && nextQueued.username) {
              console.log(`[X-Assistant] Comment handoff -> @${nextQueued.username}`);
              processTarget(nextQueued.username, "comment", nextQueued);
            }
            scrollCount = 0;
          } else {
            // 评论区没有命中时，达到空刷上限后切入博主粉丝池。
            if (scrollCount >= 3) {
              const author = authorHandles[0];
              console.log("[X-Assistant] Comment scan exhausted on this tweet.");
              if (author) {
                clearCommentSession();
                clearCommentQueue();
                sessionStorage.setItem("followers_session_count", "0");
                scrollCount = 0;
                window.location.href = `https://x.com/${author}/followers`;
              } else {
                performDeepPurge();
                scrollCount = 0;
              }
            } else {
              window.scrollBy(0, 800);
              scrollCount++;
            }
          }
          return;
        }

        // --- 场景 C: 首页自动起跑 (基础入口 + 广告过滤) ---
        const isHomePage = url === "https://x.com/home" || url === "https://x.com/" || url === "https://x.com";
        if (isHomePage && !pending && !manualTestLock && !stopRequested) {
          sessionStorage.removeItem("current_hub_author");
          localStorage.removeItem("current_hub_author");
          const primaryColumn = document.querySelector('[data-testid="primaryColumn"]');
          if (!primaryColumn) {
            return;
          }

          const allVisibleTweets = Array.from(primaryColumn.querySelectorAll('article[data-testid="tweet"]'));
          const lastAutoProcessedId = sessionStorage.getItem('last_auto_processed_id') || localStorage.getItem('last_auto_processed_id') || '';
          if (lastAutoProcessedId) {
            console.log(`[X-Assistant] 首页多轮校验：提取到上一轮推文 ID [${lastAutoProcessedId}]，开始扫描并执行去重...`);
          } else {
            console.log('[X-Assistant] 首页初始起跑：当前无历史推文 ID 记录。');
          }

          let skippedPreviousTargetLogged = false;
          const firstRealTweet = allVisibleTweets.find((tweet) => {
            const tweetText = (tweet.innerText || "").toLowerCase();
            const isAd = tweetText.includes("广告") || tweetText.includes("贊助") || tweetText.includes("promoted");
            const timeLink = tweet.querySelector('time')?.parentElement;
            const statusId = timeLink?.href?.match(/\/status\/(\d+)/)?.[1] || '';
            const hasTime = !!timeLink && !!statusId;
            if (!isAd && hasTime && statusId === lastAutoProcessedId && !skippedPreviousTargetLogged) {
              skippedPreviousTargetLogged = true;
              console.log(`[X-Assistant] 去重拦截：推文 [${statusId}] 是上一轮旧目标，已跳过。`);
            }
            return !isAd && hasTime && statusId !== lastAutoProcessedId;
          });

          if (firstRealTweet) {
            const timeLink = firstRealTweet.querySelector('time')?.parentElement;
            const authorLink = firstRealTweet.querySelector('[data-testid="User-Name"] a[href^="/"]') ||
              Array.from(firstRealTweet.querySelectorAll('a[href^="/"]')).find((anchor) => {
                const href = anchor.getAttribute('href') || '';
                return /^\/[A-Za-z0-9_]{1,20}$/.test(href);
              });
            const authorHandle = parseUsernameFromHref(authorLink?.getAttribute('href') || authorLink?.href || '');
            if (timeLink && timeLink.href && timeLink.href.includes('/status/')) {
              const statusId = timeLink.href.match(/\/status\/(\d+)/)?.[1] || '';
              if (authorHandle) {
                sessionStorage.setItem('current_hub_author', authorHandle);
                localStorage.setItem('current_hub_author', authorHandle);
                console.log(`[X-Assistant] 首页起跑：锁定博主 @${authorHandle}，准备切入详情页...`);
              }
              if (statusId) {
                sessionStorage.setItem('last_auto_processed_id', statusId);
                localStorage.setItem('last_auto_processed_id', statusId);
                console.log(`[X-Assistant] 去重标记镌刻：本轮新推文 ID [${statusId}] 已写入缓存。`);
              }
              console.log('[X-Assistant] 首页进门：已跳过潜在广告，切入详情页...');
              window.location.href = timeLink.href;
              return;
            }
          } else {
            if (Math.random() < 0.1) {
              console.log('[X-Assistant] 首页搜寻中：正在过滤推荐/广告内容...');
            }
            window.scrollBy(0, 500);
            return;
          }
        }

        // --- 场景 D: 博主个人页 (Hub Navigation - Section 3.B) ---
        if (commentSession && commentSession.source === "comment") {
          return;
        }

        if (url.match(/x\.com\/[^\/]+(\?.*)?$/) && !url.includes("/status/") && !url.includes("/messages")) {
          const profileHandleMatch = url.match(/x\.com\/([^\/\?]+)/);
          const currentProfileHandle = profileHandleMatch ? String(profileHandleMatch[1] || "").toLowerCase() : "";
          const hubAuthor = String(sessionStorage.getItem("current_hub_author") || "").toLowerCase();
          const systemPaths = new Set(["home", "explore", "notifications", "messages", "settings", "i", "compose", "search"]);

          if (url === "https://x.com/home" || url === "https://x.com/" || url === "https://x.com") {
            return;
          }

          if (!hubAuthor || !currentProfileHandle || currentProfileHandle !== hubAuthor || systemPaths.has(currentProfileHandle)) {
            return;
          }

          console.log("[X-Assistant] Hub Navigation Active. Simulating Bio Browse...");

          setTimeout(() => {
            const followersLink = document.querySelector('a[href$="/followers"]');
            if (followersLink) {
              followersLink.click();
            } else {
              window.location.href = url.replace(/(\?.*)?$/, "/followers");
            }
          }, 3000);
          return;
        }

        // --- 场景 E: 粉丝列表页 (Pool Infiltration - Section 3.C) ---
        if (url.includes("/followers")) {
          let queue = getCommentQueue();
          if (queue.length > 0 && queue.some((item) => item && item.source === "comment")) {
            console.log("[X-Assistant] 检测到已切入粉丝池，清理残留评论队列。");
            clearCommentQueue();
            queue = [];
          }

          const followersLimit = Number(config.followersLimit || 30);
          const followerQueue = queue.filter((item) => item && item.source === "follower");
          const followersSessionCount = followerQueue.length;

          console.log("[X-Assistant] Followers branch entered.", {
            followersLimit,
            followersSessionCount,
            forceCheck,
            canProceed: res.canProceed,
            url
          });

          if (followersSessionCount >= followersLimit) {
            const nextQueued = peekCommentQueue();
            console.log(`[X-Assistant] 粉丝名单已攒够（${followersSessionCount}/${followersLimit}），开始统一处理。`);
            if (nextQueued && nextQueued.username && nextQueued.source === "follower") {
              processTarget(nextQueued.username, nextQueued.source, nextQueued);
              return;
            }
            clearCommentQueue();
            sessionStorage.removeItem("followers_session_count");
            scrollCount = 0;
            window.location.href = "https://x.com/home";
            return;
          }

          const cells = Array.from(document.querySelectorAll('[data-testid="primaryColumn"] [data-testid="UserCell"]'));
          console.log(`[X-Assistant] Followers visible cells: ${cells.length}`);
          if (cells.length === 0) {
            if (Math.random() < 0.1) {
              console.log("[X-Assistant] 等待粉丝列表 DOM 加载...");
            }
            return;
          }

          let addedInThisScroll = 0;
          const queuedUsernames = new Set(queue.map((item) => String(item?.username || "").toLowerCase()).filter(Boolean));
          for (let cell of cells) {
            const allSpans = Array.from(cell.querySelectorAll('span'));
            const handleText = allSpans.find((span) => {
              const text = (span.textContent || '').trim();
              return text.startsWith('@');
            })?.textContent?.trim() || "";

            if (!handleText.startsWith('@')) {
              if (Math.random() < 0.01) {
                console.warn("[X-Assistant] 警告: 无法从 UserCell 中提取用户名，请检查 DOM 结构。");
              }
              continue;
            }

            const username = handleText.slice(1);
            if (!username) continue;
            const normalizedUsername = username.toLowerCase();

            if (queuedUsernames.has(normalizedUsername)) {
              continue;
            }

            if (historySet.has(normalizedUsername) || blacklistSet.has(normalizedUsername) || sentSet.has(normalizedUsername)) {
              continue;
            }

            queue.push({
              username,
              source: "follower",
              tweetUrl: url,
              queuedAt: Date.now()
            });
            queuedUsernames.add(normalizedUsername);
            addedInThisScroll++;

            if ((followersSessionCount + addedInThisScroll) >= followersLimit) {
              break;
            }
          }

          if (addedInThisScroll > 0) {
            setCommentQueue(queue);
            sessionStorage.setItem("followers_session_count", String(followersSessionCount + addedInThisScroll));
            console.log(`[X-Assistant] 已采集入队 ${addedInThisScroll} 个粉丝，当前进度: ${followersSessionCount + addedInThisScroll}/${followersLimit}`);
          }

          if ((followersSessionCount + addedInThisScroll) >= followersLimit) {
            const nextQueued = peekCommentQueue();
            if (nextQueued && nextQueued.username && nextQueued.source === "follower") {
              processTarget(nextQueued.username, nextQueued.source, nextQueued);
              return;
            }
          }

          if (addedInThisScroll === 0) {
            if (scrollCount >= 15) {
              console.log("[X-Assistant] 粉丝列表已触底，开始处理已入队名单。");
              const nextQueued = peekCommentQueue();
              if (nextQueued && nextQueued.username && nextQueued.source === "follower") {
                processTarget(nextQueued.username, nextQueued.source, nextQueued);
                return;
              }
              clearCommentQueue();
              sessionStorage.removeItem("followers_session_count");
              scrollCount = 0;
              window.location.href = "https://x.com/home";
              return;
            }

            console.log(`[X-Assistant] 本轮未发现新粉丝，执行第 ${scrollCount + 1}/15 次滚动搜索...`);
            window.scrollBy(0, 1000);
            scrollCount++;
          } else {
            scrollCount = 0;
            window.scrollBy(0, 1000);
          }
          return;
        }

      });
    } catch (e) { console.error("[X-Assistant] Check Loop Error:", e); }
  }

  function getPostAuthorHandles() {
    // 优先使用详情页 URL 识别主贴作者，避免 DOM 结构变种误抓评论者。
    const urlHandle = getCurrentTopLevelUsername(window.location.href);
    if (urlHandle) {
      console.log("[X-Assistant] 目标作者锁定(URL识别):", urlHandle);
      return [urlHandle.toLowerCase()];
    }

    // URL 兜底失败时，再回退到首条 tweet 卡片识别。
    const firstArticle = document.querySelector('article[data-testid="tweet"]');
    if (!firstArticle) return [];

    const authorLink = firstArticle.querySelector('[data-testid="User-Name"] a[href^="/"]');
    const username = parseUsernameFromHref(authorLink?.getAttribute('href') || authorLink?.href || '');
    return username ? [username.toLowerCase()] : [];
  }

  function getCurrentStatusId() {
    const m = location.href.match(/\/status\/(\d+)/);
    return m ? m[1] : "";
  }

  function parseUsernameFromHref(href) {
    if (!href) return "";
    try {
      const u = href.startsWith("http") ? new URL(href) : new URL(href, location.origin);
      const first = (u.pathname || "").split("/").filter(Boolean)[0] || "";
      return /^[A-Za-z0-9_]{1,20}$/.test(first) ? first : "";
    } catch (_) {
      return "";
    }
  }

  function getCurrentTopLevelUsername(url) {
    try {
      const targetUrl = url || window.location.href;
      const u = new URL(targetUrl, location.origin);
      const first = (u.pathname || "").split("/").filter(Boolean)[0] || "";
      const systemPaths = ["home", "explore", "notifications", "messages", "settings", "i", "compose", "search"];
      if (!/^[A-Za-z0-9_]{1,20}$/.test(first)) return "";
      return systemPaths.includes(first.toLowerCase()) ? "" : first;
    } catch (_) {
      return "";
    }
  }

  function getLatestConversationMessageText() {
    const exactMessageNodes = Array.from(document.querySelectorAll('[data-testid^="message-text-"]'));
    for (let i = exactMessageNodes.length - 1; i >= 0; i--) {
      const text = (exactMessageNodes[i].innerText || exactMessageNodes[i].textContent || '').trim();
      if (text) return text;
    }

    const selectors = [
      '[data-testid="messageEntry"]',
      '[data-testid="message"]',
      '[data-testid="conversation"] [role="listitem"]',
      '[data-testid="cellInnerDiv"]'
    ];

    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      for (let i = nodes.length - 1; i >= 0; i--) {
        const text = (nodes[i].innerText || nodes[i].textContent || '').trim();
        if (text) return text;
      }
    }

    return '';
  }

  function getExpectedTemplateForSource(config, source) {
    const templatePool = Array.isArray(config?.dmTemplates) && config.dmTemplates.length > 0
      ? config.dmTemplates
      : FALLBACK_CONFIG.dmTemplates;
    const templates = templatePool.filter(t => t.type === source || !t.type);
    return ((templates.length > 0 ? templates[0] : templatePool[0])?.content || "hi").trim();
  }

  function tryFinalizeDeliveredCommentTarget(config) {
    const url = window.location.href;
    const isMessagingPage = url.includes("/messages") || url.includes("/i/chat/");
    if (!isMessagingPage) return false;

    const queuedTarget = peekCommentQueue();
      if (!queuedTarget || !queuedTarget.username || queuedTarget.source !== "comment") return false;

    const expectedTemplate = getExpectedTemplateForSource(config, queuedTarget.source);
    const latestMessage = getLatestConversationMessageText();
    if (!latestMessage || !latestMessage.includes(expectedTemplate)) return false;

    markDeliveredCommentTarget(queuedTarget.username);
    chrome.runtime.sendMessage({
      action: "MARK_SENT_CONFIRMED",
      payload: {
        username: queuedTarget.username,
        source: "comment"
      }
    }).catch(() => {
      console.warn("[X-Assistant] MARK_SENT_CONFIRMED dispatch failed during comment closeout.");
    });
    completeCurrentCommentTarget(queuedTarget.username);
    clearDeliveredCommentTarget(queuedTarget.username);
    clearPendingTarget();
    dmInjecting = false;
    navigateBackToSource("comment");
    return true;
  }

  function tryFinalizeDeliveredMarkRecovery() {
    const delivered = getDeliveredQueueMarks();
      if (!Array.isArray(delivered) || delivered.length === 0) return false;

    const queuedTarget = peekCommentQueue();
    if (!queuedTarget || !queuedTarget.username || queuedTarget.source !== "comment") return false;
    if (!delivered.includes(queuedTarget.username)) return false;

    chrome.runtime.sendMessage({
      action: "LOG_TASK",
      payload: {
        username: queuedTarget.username,
        status: "dm_sent_verified",
        details: "来源：评论区（由送达标记恢复）",
        source: "comment"
      }
    }).catch(() => {
      console.warn("[X-Assistant] LOG_TASK dispatch failed during delivered-mark recovery.");
    });
    completeCurrentCommentTarget(queuedTarget.username);
    clearDeliveredCommentTarget(queuedTarget.username);
    clearPendingTarget();
    dmInjecting = false;
    navigateBackToSource("comment");
    return true;
  }

  async function consumePendingDmVerification(config) {
    const marker = getPendingDmVerification();
    if (!marker) return false;

    const ageMs = Date.now() - (marker.timestamp || 0);
    if (ageMs > 300000) {
      clearPendingDmVerification();
      return false;
    }

    const url = window.location.href;
    const isMessagingPage = url.includes("/messages") || url.includes("/i/chat/");
    if (!isMessagingPage) {
      return false;
    }

    const latestMessage = getLatestConversationMessageText();
    if (!latestMessage || !latestMessage.includes(marker.template)) {
      return false;
    }

    await reliableBackgroundSignal("MARK_SENT_CONFIRMED", {
      username: marker.username,
      source: marker.source,
      statusId: marker.statusId || "",
      status: "dm_sent_verified",
      details: "跨页面校验成功"
    });
    appendDebugSentLedger(marker.username, marker.source);

    if (marker.source === "comment") {
      completeCurrentCommentTarget(marker.username);
    }
    if (marker.source === "follower") {
      sessionStorage.removeItem(`pending_${marker.username}`);
      clearActiveFollowerTarget();
    }
    clearPendingTarget();
    clearPendingDmVerification();
    dmInjecting = false;
    setTimeout(() => navigateBackToSource(marker.source), 2000);
    return true;
  }

  function isTargetProfilePage(username, url) {
    const currentUsername = getCurrentTopLevelUsername(url);
    if (!currentUsername || currentUsername.toLowerCase() !== String(username || "").toLowerCase()) {
      return false;
    }

    const currentUrl = url || window.location.href;
    if (currentUrl.includes("/status/") || currentUrl.includes("/followers") || currentUrl.includes("/messages") || currentUrl.includes("/i/chat/")) {
      return false;
    }

    return !!document.querySelector('[data-testid="primaryColumn"] [data-testid="UserName"]') ||
      !!document.querySelector('[data-testid="userActions"]') ||
      !!document.querySelector('a[href$="/followers"], a[href$="/verified_followers"]');
  }

  function getConversationTimelineContainer() {
    const selectors = [
      '[aria-label="时间线: 会话"]',
      '[aria-label="Timeline: Conversation"]',
      '[aria-label="Timeline: 會話"]',
      '[aria-label*="Timeline: Conversation"]',
      '[aria-label*="timeline: conversation"]'
    ];

    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node) {
        return node;
      }
    }

    return document.querySelector('[data-testid="primaryColumn"]') || null;
  }

  function scanHandles(res, authorHandle, recentDays) {
    // 仅扫描评论tweet卡片：用户名 + 时间都存在，且时间在最近N天内
    const maxAgeMs = Math.max(1, Number(recentDays || 3)) * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const statusId = getCurrentStatusId();
    const timelineContainer = getConversationTimelineContainer();
    const scopeRoot = timelineContainer || document;
    const discoverMoreMarker = Array.from(scopeRoot.querySelectorAll('span, h2, div[dir="ltr"]')).find((node) => {
      if (node.childElementCount > 1) return false;
      const text = (node.innerText || node.textContent || '').trim();
      return text === '发现更多' || text === '發現更多' || text === 'Discover more' || text === 'More Replies';
    });
    const markerTop = discoverMoreMarker ? discoverMoreMarker.getBoundingClientRect().top : Number.POSITIVE_INFINITY;
    const articles = Array.from(scopeRoot.querySelectorAll('article[data-testid="tweet"]')).filter((article, index) => {
      if (index === 0) return true;
      const rect = article.getBoundingClientRect();
      return rect.top < markerTop;
    });
    const authorHandles = getPostAuthorHandles().map(item => String(item || '').toLowerCase()).filter(Boolean);
    const authorLower = (authorHandle || "").toLowerCase();
    const historySet = new Set((res.history || []).map((item) => String(item || '').toLowerCase()).filter(Boolean));
    const blacklistSet = new Set((res.blacklist || []).map((item) => String(item || '').toLowerCase()).filter(Boolean));
    const sentSet = new Set(((res.sent || [])).map((item) => String(item || '').toLowerCase()).filter(Boolean));
    const hit = [];
    const debugDecisions = [];

    for (const article of articles) {
      const timeNode = article.querySelector("time[datetime]");
      const datetime = timeNode ? timeNode.getAttribute("datetime") : "";
      const ts = datetime ? Date.parse(datetime) : NaN;
      if (!Number.isFinite(ts)) {
        debugDecisions.push({ username: "", reason: "invalid_time" });
        continue;
      }

      const ageMs = now - ts;
      if (ageMs < 0 || ageMs > maxAgeMs) {
        debugDecisions.push({ username: "", reason: "outside_time_window", ageHours: Math.round(ageMs / 3600000) });
        continue;
      }

      const userAnchor = article.querySelector('[data-testid="User-Name"] a[href^="/"]') ||
        Array.from(article.querySelectorAll('a[href^="/"]')).find((a) => {
          const href = a.getAttribute("href") || "";
          return /^\/[A-Za-z0-9_]{1,20}$/.test(href);
        });

      const username = parseUsernameFromHref(userAnchor && userAnchor.getAttribute("href"));
      if (!username) {
        debugDecisions.push({ username: "", reason: "no_username" });
        continue;
      }
      if (username.toLowerCase() === authorLower) {
        debugDecisions.push({ username, reason: "same_as_author" });
        continue;
      }
      if (authorHandles.includes(username.toLowerCase())) {
        debugDecisions.push({ username, reason: "in_author_handles" });
        continue;
      }
      if (historySet.has(username.toLowerCase())) {
        debugDecisions.push({ username, reason: "in_history" });
        continue;
      }
      if (blacklistSet.has(username.toLowerCase())) {
        debugDecisions.push({ username, reason: "in_blacklist" });
        continue;
      }
      if (sentSet.has(username.toLowerCase())) {
        debugDecisions.push({ username, reason: "in_sent_list" });
        continue;
      }
      if (sessionStorage.getItem(`pending_${username}`)) {
        debugDecisions.push({ username, reason: "has_pending_marker" });
        continue;
      }

      const seenKey = `comment_seen_${statusId}_${username}`;
      if (sessionStorage.getItem(seenKey)) {
        debugDecisions.push({ username, reason: "already_seen" });
        continue;
      }

      sessionStorage.setItem(seenKey, String(now));
      hit.push(username);
      debugDecisions.push({ username, reason: "accepted" });
    }

    console.log("[X-Assistant] scanHandles decisions:", debugDecisions.slice(0, 50));
    console.log(`[X-Assistant] scanHandles accepted count: ${hit.length}`);

    return hit;
  }

  function processTarget(username, source, metadata) {
    console.log(`[X-Assistant] ENGAGING TARGET: ${username} FROM ${source}`);
    if (source === "comment") {
      const tweetUrl = metadata?.tweetUrl || getCanonicalTweetUrl();
      if (tweetUrl) {
        setCommentSession({
          source,
          tweetUrl,
          statusId: metadata?.statusId || getCurrentStatusId(),
          username,
          updatedAt: Date.now()
        });
      }
    } else {
      clearCommentSession();
    }
    const nextPendingTarget = { username, source, stage: "open_profile", createdAt: Date.now() };
    setPendingTarget(nextPendingTarget);
    if (source === "follower") {
      setActiveFollowerTarget(nextPendingTarget);
    }
    sessionStorage.setItem(`pending_${username}`, source);
    sessionStorage.setItem("last_engaged_username", username);
    sessionStorage.setItem("last_engaged_source", source);
    window.location.href = `https://x.com/${username}`;
  }

  async function injectDM(config, pending) {
    if (dmInjecting) return;
    if (stopRequested) return;
    dmInjecting = true;
    lastDmInjectAt = Date.now();

    let attempts = 0;
    const maxAttempts = 20; 

    const interval = setInterval(() => {
      attempts++;
      const msgBox = findDmComposer();

      if (msgBox) {
        clearInterval(interval);
        
        // 拟人化延迟 (Section 5)
        setTimeout(async () => {
          if (stopRequested) {
            dmInjecting = false;
            return;
          }

          const source = pending?.source || sessionStorage.getItem("last_engaged_source") || "comment";
          const username = pending?.username || sessionStorage.getItem("last_engaged_username") || "unknown";
          const hubAuthor = sessionStorage.getItem("current_hub_author") || "unknown";

          const templatePool = Array.isArray(config.dmTemplates) && config.dmTemplates.length > 0
            ? config.dmTemplates
            : FALLBACK_CONFIG.dmTemplates;
          const templates = templatePool.filter(t => t.type === source || !t.type);
          const templateObj = templates.length > 0
            ? templates[Math.floor(Math.random() * templates.length)]
            : templatePool[0];
          const template = (templateObj && templateObj.content ? templateObj.content : "hi").trim();
          
          const setComposerValue = (element, value) => {
            if (!element) return;
            element.focus();

            if ('value' in element) {
              const prototype = Object.getPrototypeOf(element);
              const descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, 'value') : null;
              if (descriptor && typeof descriptor.set === 'function') {
                descriptor.set.call(element, value);
              } else {
                element.value = value;
              }
            } else {
              element.textContent = value;
            }

            element.dispatchEvent(new InputEvent('input', {
              bubbles: true,
              inputType: 'insertText',
              data: value
            }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
          };

          setComposerValue(msgBox, template);

          const clickSendButtonSafely = (button) => {
            if (!button) return false;
            const target = button.closest('button') || button;
            if (!target) return false;
            if (target.disabled || target.getAttribute('aria-disabled') === 'true') return false;

            const events = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
            for (const eventName of events) {
              target.dispatchEvent(new MouseEvent(eventName, {
                bubbles: true,
                cancelable: true,
                view: window,
                buttons: 1
              }));
            }
            target.click();
            return true;
          };

          const sleep = async (ms) => {
            const slice = 100;
            let elapsed = 0;
            while (elapsed < ms) {
              if (shouldPauseExecution()) {
                throw new Error("STOP_REQUESTED");
              }
              const waitMs = Math.min(slice, ms - elapsed);
              await new Promise(resolve => setTimeout(resolve, waitMs));
              elapsed += waitMs;
            }
          };

          const getComposerDraftText = () => {
            const liveBox = findDmComposer() || msgBox;
            if (!liveBox) return "";
            const raw = (liveBox.value || liveBox.innerText || liveBox.textContent || "").trim();
            return raw === "Unencrypted message" ? "" : raw;
          };

          const getMessageCount = () => {
            const selectors = [
              '[data-testid="messageEntry"]',
              '[data-testid="message"]',
              '[data-testid="conversation"] [role="listitem"]',
              '[data-testid="cellInnerDiv"]'
            ];
            return selectors.reduce((total, selector) => total + document.querySelectorAll(selector).length, 0);
          };

          const getLatestMessageText = () => {
            const selectors = [
              '[data-testid="messageEntry"]',
              '[data-testid="message"]',
              '[data-testid="conversation"] [role="listitem"]',
              '[data-testid="cellInnerDiv"]'
            ];

            for (const selector of selectors) {
              const nodes = Array.from(document.querySelectorAll(selector));
              for (let i = nodes.length - 1; i >= 0; i--) {
                const text = (nodes[i].innerText || nodes[i].textContent || '').trim();
                if (text) return text;
              }
            }
            return '';
          };

          const verifySendSuccess = (beforeDraft, beforeCount) => {
            const afterDraft = getComposerDraftText();
            const afterCount = getMessageCount();
            const draftCleared = beforeDraft.length > 0 && afterDraft.length === 0;
            const messageIncreased = afterCount > beforeCount;
            const latestMessage = getLatestMessageText();
            const latestMatchesTemplate = latestMessage.includes(template);
            return draftCleared || messageIncreased || latestMatchesTemplate;
          };

          // 真实输入后发送按钮才会出现，必须在输入完成后重新抓取。
          const sendBtnSelectors = [
            '[data-testid="dm-composer-send-button"]',
            '[data-testid="dmComposerSendButton"]',
            'button[data-testid="dm-composer-send-button"] svg[data-icon="icon-arrow-up"]',
            'button.gap-1.inline-flex.items-center',
            'button[aria-label="发送"]',
            'button[aria-label="傳送"]',
            'button[aria-label="Send"]',
            'button.r-199wky7', 
            '.r-4qt09n.r-z2wwpe button', 
            'button.r-sdzlij.r-1phboty', // 适配截图中可能复用的类
            'button svg path[d*="M2.01 21L23 12 2.01 3"]', 
            'button svg path[d*="M3.4 20.4l17.45-7.48c.81-.35.81-1.49 0-1.84L3.4 3.6"]',
            'button svg path[d*="M12 3.59l7.457 7.45-1.414 1.42L13 7.41V21h-2V7.41l-5.043 5.05-1.414-1.42L12 3.59z"]',
            'button svg path[d*="M12 2.59l9.41 9.41-1.41 1.41L13 6.41V20h-2V6.41l-6.94 7.06-1.41-1.41L12 2.59z"]', // 黑色圆形向上箭头精确路径
            '.r-107hfka button'
          ];
          const findSendButton = () => {
            for (const sel of sendBtnSelectors) {
              const btn = document.querySelector(sel);
              if (!btn) continue;

              const realBtn = btn.closest('button') || btn;
              if (realBtn && !realBtn.disabled && realBtn.getAttribute('aria-disabled') !== 'true') {
                return { button: realBtn, selector: sel };
              }
            }
            return null;
          };

          const waitForSendButton = async (timeoutMs = 5000) => {
            const startedAt = Date.now();
            while (Date.now() - startedAt < timeoutMs) {
              const match = findSendButton();
              if (match) return match;
              await sleep(150);
            }
            return null;
          };

          let sendMatch;
          try {
            sendMatch = await waitForSendButton();
          } catch (error) {
            if (error && error.message === "STOP_REQUESTED") {
              dmInjecting = false;
              return;
            }
            throw error;
          }
          const selectedButton = sendMatch?.button || null;
          const selectedSelector = sendMatch?.selector || "";
          const sent = !!selectedButton;

          let sendVerified = false;
          try {
            if (!sent || !selectedButton) {
              console.log("[X-Assistant] INJECTED. Send button not found, please send manually.");
            } else {
              const beforeDraft = getComposerDraftText();
              const beforeCount = getMessageCount();

              setPendingDmVerification({
                username,
                source,
                statusId: getCurrentStatusId() || "",
                template,
                timestamp: Date.now()
              });

              await sleep(1000);
              if (shouldPauseExecution()) {
                throw new Error("STOP_REQUESTED");
              }
              const firstClick = clickSendButtonSafely(selectedButton);
              console.log("[X-Assistant] DM SEND BUTTON CLICKED:", firstClick, selectedSelector);
              await sleep(1600);
              sendVerified = verifySendSuccess(beforeDraft, beforeCount);

              if (!sendVerified) {
                console.warn("[X-Assistant] Send verify failed after first click. Retrying once...");
                if (shouldPauseExecution()) {
                  throw new Error("STOP_REQUESTED");
                }
                const secondClick = clickSendButtonSafely(selectedButton);
                console.log("[X-Assistant] DM SEND BUTTON RETRY CLICKED:", secondClick, selectedSelector);
                await sleep(1800);
                sendVerified = verifySendSuccess(beforeDraft, beforeCount);
              }

              if (sendVerified) {
                console.log("[X-Assistant] INJECTED & SENT (verified).");
              } else {
                console.warn("[X-Assistant] INJECTED but send not verified after retry.");
              }
            }
          } catch (error) {
            if (error && error.message === "STOP_REQUESTED") {
              clearPendingDmVerification();
              dmInjecting = false;
              return;
            }
            throw error;
          }

          if (shouldPauseExecution()) {
            clearPendingDmVerification();
            dmInjecting = false;
            return;
          }

          await reliableBackgroundSignal(sendVerified ? "MARK_SENT_CONFIRMED" : "LOG_TASK", {
            username: username,
            status: sendVerified ? "dm_sent_verified" : "failed",
            details: sendVerified
              ? `Source: ${source} (Hub: @${hubAuthor})`
              : `Send not verified after retry. Source: ${source} (Hub: @${hubAuthor})`,
            source: source,
            statusId: getCurrentStatusId()
          });

          if (sendVerified) {
            appendDebugSentLedger(username, source);
          }

          if (sendVerified && source === "comment") {
            completeCurrentCommentTarget(username);
          }

          clearPendingTarget();
          clearPendingDmVerification();
          dmInjecting = false;

          // 单兵测试不自动返回，避免“还没发就回主页”死循环
          if (source === "manual_test") {
            console.log("[X-Assistant] Manual test mode: sent (or attempted), stay on DM page without auto-back.");
            clearManualTestState();
            return;
          }

          // 自动流程才返回闭环
          const returnDelay = sendVerified ? 3000 : 10000;
          setTimeout(() => {
            console.log("[X-Assistant] Closing Loop. Returning...");
            navigateBackToSource(source);
          }, returnDelay); 
        }, 3000); 

      } else {
        if (attempts >= maxAttempts) {
          clearInterval(interval);
          console.log("[X-Assistant] DM Box not found, returning...");
          const source = pending?.source || sessionStorage.getItem("last_engaged_source") || "comment";
          const username = pending?.username || sessionStorage.getItem("last_engaged_username") || "unknown";
          chrome.runtime.sendMessage({
            action: "LOG_TASK",
            payload: {
              username,
              status: "failed",
              details: "DM composer not found",
              source
            }
          });
          clearPendingTarget();
          dmInjecting = false;
          if (source !== "manual_test") {
            navigateBackToSource(source);
          } else {
            clearManualTestState();
          }
        }
      }
    }, 1000);
  }

  setInterval(check, 4000);
  check();
})();