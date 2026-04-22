// popup.js - UI Sync for X-Assistant
(async function(){
  const el = (id) => document.getElementById(id);
  const statusBadge = el('status-badge');
  const todayDMs = el('todayDMs');
  const todayOps = el('todayOps');
  const startBtn = el('start');
  const stopBtn = el('stop');
  const runStep = el('runStep');
  const runMeta = el('runMeta');
  const licenseKeyInput = el('licenseKey');
  const verifyLicenseBtn = el('verifyLicense');
  const licenseMeta = el('licenseMeta');

  const LICENSE_STORAGE_KEY = 'licenseState';
  const RUNTIME_STORAGE_KEY = 'runtimeState';
  const COOLDOWN_REASON_TEXT = {
    daily_limit: '原因：达到每日私信上限',
    hourly_limit: '原因：达到每小时操作上限',
    ops_cooldown: '原因：达到累计操作冷却阈值',
    rate_limited: '原因：触发限流保护'
  };

  function withTimeout(promise, ms, label) {
    const timeoutMs = Number(ms);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${label || 'operation'} timeout`));
      }, timeoutMs);
      Promise.resolve(promise)
        .then((v) => {
          clearTimeout(timer);
          resolve(v);
        })
        .catch((e) => {
          clearTimeout(timer);
          reject(e);
        });
    });
  }

  async function broadcastStopToAllTabs() {
    const tabs = await chrome.tabs.query({ url: ["https://x.com/*", "https://*.x.com/*"] });
    await Promise.allSettled(tabs.map((tab) => chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        try {
          window.postMessage({ type: "X_STOP_NOW" }, "*");
        } catch (_) {}
      }
    })));
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (res) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(res);
      });
    });
  }

  function md5(message) {
    message = unescape(encodeURIComponent(String(message ?? '')));

    function rotateLeft(lValue, iShiftBits) {
      return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits));
    }

    function addUnsigned(lX, lY) {
      let lX4, lY4, lX8, lY8, lResult;
      lX8 = (lX & 0x80000000);
      lY8 = (lY & 0x80000000);
      lX4 = (lX & 0x40000000);
      lY4 = (lY & 0x40000000);
      lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF);
      if (lX4 & lY4) {
        return (lResult ^ 0x80000000 ^ lX8 ^ lY8);
      }
      if (lX4 | lY4) {
        if (lResult & 0x40000000) {
          return (lResult ^ 0xC0000000 ^ lX8 ^ lY8);
        } else {
          return (lResult ^ 0x40000000 ^ lX8 ^ lY8);
        }
      } else {
        return (lResult ^ lX8 ^ lY8);
      }
    }

    function F(x, y, z) {
      return (x & y) | ((~x) & z);
    }

    function G(x, y, z) {
      return (x & z) | (y & (~z));
    }

    function H(x, y, z) {
      return (x ^ y ^ z);
    }

    function I(x, y, z) {
      return (y ^ (x | (~z)));
    }

    function FF(a, b, c, d, x, s, ac) {
      a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac));
      return addUnsigned(rotateLeft(a, s), b);
    }

    function GG(a, b, c, d, x, s, ac) {
      a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac));
      return addUnsigned(rotateLeft(a, s), b);
    }

    function HH(a, b, c, d, x, s, ac) {
      a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac));
      return addUnsigned(rotateLeft(a, s), b);
    }

    function II(a, b, c, d, x, s, ac) {
      a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac));
      return addUnsigned(rotateLeft(a, s), b);
    }

    function convertToWordArray(message) {
      let lWordCount;
      const lMessageLength = message.length;
      const lNumberOfWords_temp1 = lMessageLength + 8;
      const lNumberOfWords_temp2 = (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64;
      const lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16;
      const lWordArray = new Array(lNumberOfWords);
      for (lWordCount = 0; lWordCount < lNumberOfWords; lWordCount++) {
        lWordArray[lWordCount] = 0;
      }
      for (lWordCount = 0; lWordCount < lMessageLength; lWordCount++) {
        lWordArray[lWordCount >> 2] |= message.charCodeAt(lWordCount) << ((lWordCount % 4) * 8);
      }
      lWordArray[lWordCount >> 2] |= 0x80 << ((lWordCount % 4) * 8);
      lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
      lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
      return lWordArray;
    }

    function wordToHex(lValue) {
      let wordToHexValue = '';
      let wordToHexValue_temp = '';
      let lByte;
      let lCount;
      for (lCount = 0; lCount <= 3; lCount++) {
        lByte = (lValue >>> (lCount * 8)) & 255;
        wordToHexValue_temp = '0' + lByte.toString(16);
        wordToHexValue += wordToHexValue_temp.substr(wordToHexValue_temp.length - 2, 2);
      }
      return wordToHexValue;
    }

    let x = [];
    let k;
    let AA;
    let BB;
    let CC;
    let DD;
    let a;
    let b;
    let c;
    let d;
    const S11 = 7;
    const S12 = 12;
    const S13 = 17;
    const S14 = 22;
    const S21 = 5;
    const S22 = 9;
    const S23 = 14;
    const S24 = 20;
    const S31 = 4;
    const S32 = 11;
    const S33 = 16;
    const S34 = 23;
    const S41 = 6;
    const S42 = 10;
    const S43 = 15;
    const S44 = 21;
    x = convertToWordArray(message);
    a = 0x67452301;
    b = 0xEFCDAB89;
    c = 0x98BADCFE;
    d = 0x10325476;
    for (k = 0; k < x.length; k += 16) {
      AA = a;
      BB = b;
      CC = c;
      DD = d;
      a = FF(a, b, c, d, x[k + 0], S11, 0xD76AA478);
      d = FF(d, a, b, c, x[k + 1], S12, 0xE8C7B756);
      c = FF(c, d, a, b, x[k + 2], S13, 0x242070DB);
      b = FF(b, c, d, a, x[k + 3], S14, 0xC1BDCEEE);
      a = FF(a, b, c, d, x[k + 4], S11, 0xF57C0FAF);
      d = FF(d, a, b, c, x[k + 5], S12, 0x4787C62A);
      c = FF(c, d, a, b, x[k + 6], S13, 0xA8304613);
      b = FF(b, c, d, a, x[k + 7], S14, 0xFD469501);
      a = FF(a, b, c, d, x[k + 8], S11, 0x698098D8);
      d = FF(d, a, b, c, x[k + 9], S12, 0x8B44F7AF);
      c = FF(c, d, a, b, x[k + 10], S13, 0xFFFF5BB1);
      b = FF(b, c, d, a, x[k + 11], S14, 0x895CD7BE);
      a = FF(a, b, c, d, x[k + 12], S11, 0x6B901122);
      d = FF(d, a, b, c, x[k + 13], S12, 0xFD987193);
      c = FF(c, d, a, b, x[k + 14], S13, 0xA679438E);
      b = FF(b, c, d, a, x[k + 15], S14, 0x49B40821);
      a = GG(a, b, c, d, x[k + 1], S21, 0xF61E2562);
      d = GG(d, a, b, c, x[k + 6], S22, 0xC040B340);
      c = GG(c, d, a, b, x[k + 11], S23, 0x265E5A51);
      b = GG(b, c, d, a, x[k + 0], S24, 0xE9B6C7AA);
      a = GG(a, b, c, d, x[k + 5], S21, 0xD62F105D);
      d = GG(d, a, b, c, x[k + 10], S22, 0x2441453);
      c = GG(c, d, a, b, x[k + 15], S23, 0xD8A1E681);
      b = GG(b, c, d, a, x[k + 4], S24, 0xE7D3FBC8);
      a = GG(a, b, c, d, x[k + 9], S21, 0x21E1CDE6);
      d = GG(d, a, b, c, x[k + 14], S22, 0xC33707D6);
      c = GG(c, d, a, b, x[k + 3], S23, 0xF4D50D87);
      b = GG(b, c, d, a, x[k + 8], S24, 0x455A14ED);
      a = GG(a, b, c, d, x[k + 13], S21, 0xA9E3E905);
      d = GG(d, a, b, c, x[k + 2], S22, 0xFCEFA3F8);
      c = GG(c, d, a, b, x[k + 7], S23, 0x676F02D9);
      b = GG(b, c, d, a, x[k + 12], S24, 0x8D2A4C8A);
      a = HH(a, b, c, d, x[k + 5], S31, 0xFFFA3942);
      d = HH(d, a, b, c, x[k + 8], S32, 0x8771F681);
      c = HH(c, d, a, b, x[k + 11], S33, 0x6D9D6122);
      b = HH(b, c, d, a, x[k + 14], S34, 0xFDE5380C);
      a = HH(a, b, c, d, x[k + 1], S31, 0xA4BEEA44);
      d = HH(d, a, b, c, x[k + 4], S32, 0x4BDECFA9);
      c = HH(c, d, a, b, x[k + 7], S33, 0xF6BB4B60);
      b = HH(b, c, d, a, x[k + 10], S34, 0xBEBFBC70);
      a = HH(a, b, c, d, x[k + 13], S31, 0x289B7EC6);
      d = HH(d, a, b, c, x[k + 0], S32, 0xEAA127FA);
      c = HH(c, d, a, b, x[k + 3], S33, 0xD4EF3085);
      b = HH(b, c, d, a, x[k + 6], S34, 0x4881D05);
      a = HH(a, b, c, d, x[k + 9], S31, 0xD9D4D039);
      d = HH(d, a, b, c, x[k + 12], S32, 0xE6DB99E5);
      c = HH(c, d, a, b, x[k + 15], S33, 0x1FA27CF8);
      b = HH(b, c, d, a, x[k + 2], S34, 0xC4AC5665);
      a = II(a, b, c, d, x[k + 0], S41, 0xF4292244);
      d = II(d, a, b, c, x[k + 7], S42, 0x432AFF97);
      c = II(c, d, a, b, x[k + 14], S43, 0xAB9423A7);
      b = II(b, c, d, a, x[k + 5], S44, 0xFC93A039);
      a = II(a, b, c, d, x[k + 12], S41, 0x655B59C3);
      d = II(d, a, b, c, x[k + 3], S42, 0x8F0CCC92);
      c = II(c, d, a, b, x[k + 10], S43, 0xFFEFF47D);
      b = II(b, c, d, a, x[k + 1], S44, 0x85845DD1);
      a = II(a, b, c, d, x[k + 8], S41, 0x6FA87E4F);
      d = II(d, a, b, c, x[k + 15], S42, 0xFE2CE6E0);
      c = II(c, d, a, b, x[k + 6], S43, 0xA3014314);
      b = II(b, c, d, a, x[k + 13], S44, 0x4E0811A1);
      a = II(a, b, c, d, x[k + 4], S41, 0xF7537E82);
      d = II(d, a, b, c, x[k + 11], S42, 0xBD3AF235);
      c = II(c, d, a, b, x[k + 2], S43, 0x2AD7D2BB);
      b = II(b, c, d, a, x[k + 9], S44, 0xEB86D391);
      a = addUnsigned(a, AA);
      b = addUnsigned(b, BB);
      c = addUnsigned(c, CC);
      d = addUnsigned(d, DD);
    }
    const temp = wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d);
    return temp.toLowerCase();
  }

  function utf8Encode(str) {
    return unescape(encodeURIComponent(String(str ?? '')));
  }

  function hex2bin(hex) {
    const bytes = [];
    for (let i = 0; i < hex.length - 1; i += 2) {
      bytes.push(parseInt(hex.substr(i, 2), 16));
    }
    return String.fromCharCode.apply(String, bytes);
  }

  function bin2hex(bin) {
    let hex = '';
    for (let i = 0; i < bin.length; i++) {
      hex += ('0' + bin.charCodeAt(i).toString(16)).slice(-2);
    }
    return hex;
  }

  function rc4Encrypt(text, key) {
    text = utf8Encode(text);
    key = utf8Encode(key);

    const s = new Array(256);
    let j = 0;
    let x;

    for (let i = 0; i < 256; i++) {
      s[i] = i;
    }

    for (let i = 0; i < 256; i++) {
      j = (j + s[i] + key.charCodeAt(i % key.length)) % 256;
      x = s[i];
      s[i] = s[j];
      s[j] = x;
    }

    let i = 0;
    j = 0;
    let ciphertext = '';

    for (let n = 0; n < text.length; n++) {
      i = (i + 1) % 256;
      j = (j + s[i]) % 256;
      x = s[i];
      s[i] = s[j];
      s[j] = x;
      ciphertext += String.fromCharCode(text.charCodeAt(n) ^ s[(s[i] + s[j]) % 256]);
    }

    return bin2hex(ciphertext);
  }

  function rc4Decrypt(ciphertext, key) {
    ciphertext = hex2bin(ciphertext);
    key = utf8Encode(key);

    const s = new Array(256);
    let j = 0;
    let x;

    for (let i = 0; i < 256; i++) {
      s[i] = i;
    }

    for (let i = 0; i < 256; i++) {
      j = (j + s[i] + key.charCodeAt(i % key.length)) % 256;
      x = s[i];
      s[i] = s[j];
      s[j] = x;
    }

    let i = 0;
    j = 0;
    let plaintext = '';

    for (let n = 0; n < ciphertext.length; n++) {
      i = (i + 1) % 256;
      j = (j + s[i]) % 256;
      x = s[i];
      s[i] = s[j];
      s[j] = x;
      plaintext += String.fromCharCode(ciphertext.charCodeAt(n) ^ s[(s[i] + s[j]) % 256]);
    }

    return decodeURIComponent(escape(plaintext));
  }

  function getDeviceId() {
    const key = 'x_assistant_device_id';
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (data) => {
        const existing = String(data?.[key] || '').trim();
        if (existing) {
          resolve(existing);
          return;
        }
        const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let deviceId = '';
        for (let i = 0; i < 16; i++) {
          deviceId += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        chrome.storage.local.set({ [key]: deviceId }, () => resolve(deviceId));
      });
    });
  }

  function wyDateTime(timestampSec) {
    const t = Number(timestampSec);
    if (!Number.isFinite(t) || t <= 0) return '-';
    const date = new Date(t * 1000);
    return date.toLocaleString();
  }

  // 微验配置（从对接示例迁移过来；建议你后续放到 options 配置里）
  const WY_CONFIG = {
    appid: '61230',
    appkey: '0v58Vy959MpZlu19',
    rc4key: 'epk03ES3AwF61230',
    url: 'https://wy.llua.cn/api/',
  };

  async function verifyKami(kamiRaw) {
    const kami = String(kamiRaw || '').trim();
    if (!kami) throw new Error('请输入卡密');
    if (WY_CONFIG.appid === '应用ID' || WY_CONFIG.appkey === '应用key' || WY_CONFIG.rc4key === '应用rc4密钥') {
      throw new Error('卡密验证未配置：请先填写微验 appid/appkey/rc4key');
    }

    const time = Math.floor(Date.now() / 1000);
    const markcode = await getDeviceId();
    const value = Math.floor(Math.random() * (99999 - 10000 + 1)) + 10000;
    const sign = md5(`kami=${kami}&markcode=${markcode}&t=${time}&${WY_CONFIG.appkey}`);
    const dataEnc = rc4Encrypt(`kami=${kami}&markcode=${markcode}&t=${time}&sign=${sign}&value=${value}`, WY_CONFIG.rc4key);

    const form = new URLSearchParams();
    form.set('id', 'kmlogon');
    form.set('app', WY_CONFIG.appid);
    form.set('data', dataEnc);
    form.set('sign', sign);

    const res = await fetch(WY_CONFIG.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const text = await res.text();

    let parsed;
    try {
      parsed = JSON.parse(rc4Decrypt(text, WY_CONFIG.rc4key));
    } catch (e) {
      throw new Error('卡密验证响应解析失败');
    }

    const serverTime = Number(parsed?.time);
    if (!Number.isFinite(serverTime)) throw new Error('卡密验证响应异常');

    // 部分设备系统时间不准会导致误判“失效”。
    // 这里不再因时间偏差直接失败：签名校验（serverTime+value）仍可防止伪造响应。
    const skewSec = Math.abs(serverTime - time);
    const timeSkewHint = skewSec > 600 ? `设备时间偏差较大（约 ${Math.round(skewSec)} 秒），建议校准系统时间` : '';

    const expected = md5(`${serverTime}${WY_CONFIG.appkey}${value}`);
    if (parsed?.check !== expected) throw new Error('卡密验证：签名校验失败');

    if (Number(parsed?.code) !== 200) {
      throw new Error(String(parsed?.msg || '卡密验证失败'));
    }

    const vipUntil = Number(parsed?.msg?.vip);
    return {
      ok: true,
      vipUntil: Number.isFinite(vipUntil) ? vipUntil : null,
      raw: parsed,
      reason: timeSkewHint,
    };
  }

  async function getCachedLicenseState() {
    const d = await chrome.storage.local.get([LICENSE_STORAGE_KEY]);
    const s = d[LICENSE_STORAGE_KEY] || null;
    if (!s || typeof s !== 'object') return null;
    return s;
  }

  async function setCachedLicenseState(state) {
    await chrome.storage.local.set({ [LICENSE_STORAGE_KEY]: state });
  }

  async function updateLicenseUI() {
    if (!licenseMeta || !startBtn) return;

    const s = await getCachedLicenseState();
    const nowSec = Math.floor(Date.now() / 1000);
    const isValid = Boolean(s?.ok) && (s?.vipUntil == null || Number(s.vipUntil) > nowSec);
    startBtn.disabled = !isValid;

    if (!s) {
      licenseMeta.textContent = '状态：未验证';
      return;
    }

    const exp = s?.vipUntil ? `\n到期：${wyDateTime(s.vipUntil)}` : '';
    const reason = s?.reason ? `\n原因：${String(s.reason)}` : '';
    if (!isValid) {
      licenseMeta.textContent = `状态：已失效${exp}${reason}`;
      return;
    }
    licenseMeta.textContent = `状态：已验证${exp}${reason}`;
  }

  function setLicenseNotice(text) {
    if (!licenseMeta) return;
    licenseMeta.textContent = String(text || '').trim() || '状态：未验证';
  }

  async function refresh() {
    try {
      await updateLicenseUI();
      let uiLockedByCooldown = false;
      let uiLockedByStopped = false;
      const d = await chrome.storage.local.get(["taskLogs"]);
      const logs = d.taskLogs || [];

      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const endOfToday = startOfToday + 24 * 60 * 60 * 1000;

      const todaysLogs = logs.filter((l) => {
        const ts = Number(l?.timestamp);
        if (!Number.isFinite(ts)) return false;
        return ts >= startOfToday && ts < endOfToday;
      });

      const todaysSuccessLogs = todaysLogs.filter(
        (l) => l.status === 'success' || l.status === 'dm_sent_verified'
      );

      if (todayDMs) todayDMs.textContent = String(todaysSuccessLogs.length);
      if (todayOps) todayOps.textContent = String(todaysLogs.length);

      let statsRes = null;
      try {
        statsRes = await sendRuntimeMessage({ action: "GET_STATS" });
      } catch (_) {
        statsRes = null;
      }

      if (statsRes) {
        if (statusBadge) {
          const nowTs = Date.now();
          const cooldownUntil = Number(statsRes.cooldownUntil) || 0;
          const isPaused = Boolean(statsRes.cooldowned) && cooldownUntil > nowTs;

          if (isPaused) {
            uiLockedByCooldown = true;
            const remainSec = Math.max(0, Math.ceil((cooldownUntil - nowTs) / 1000));
            const mm = String(Math.floor(remainSec / 60)).padStart(2, '0');
            const ss = String(remainSec % 60).padStart(2, '0');
            statusBadge.textContent = `冷却中 ${mm}:${ss}`;
            statusBadge.className = "status-idle";
            if (runStep) runStep.textContent = '冷却中';
            if (runMeta) {
              const reasonText = COOLDOWN_REASON_TEXT[String(statsRes.cooldownReason || '')] || '原因：执行策略触发暂停';
              runMeta.textContent = `${reasonText}\n恢复：${mm}:${ss}`;
            }
          } else {
            statusBadge.textContent = statsRes.running ? "运行中" : "已停止";
            statusBadge.className = statsRes.running ? "status-running" : "status-idle";
            if (!statsRes.running) {
              uiLockedByStopped = true;
              if (runStep) runStep.textContent = '已停止';
              if (runMeta) runMeta.textContent = '队列：0\n状态：等待启动';
            }
          }
        }
        if (startBtn) startBtn.style.display = statsRes.running ? "none" : "flex";
        if (stopBtn) stopBtn.style.display = statsRes.running ? "flex" : "none";
      }

      const tabs = await chrome.tabs.query({ active: true, currentWindow: true, url: ["https://x.com/*", "https://*.x.com/*"] });
      const activeTab = tabs[0];
      if (activeTab) {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          func: () => {
            const queue = (() => {
              try {
                return JSON.parse(localStorage.getItem("comment_queue") || sessionStorage.getItem("comment_queue") || "[]");
              } catch (_) {
                return [];
              }
            })();
            const head = localStorage.getItem("__DEBUG_QUEUE_HEAD__") || queue[0]?.username || "-";
            const pendingRaw = localStorage.getItem("pending_target") || sessionStorage.getItem("pending_target");
            let pending = null;
            try {
              pending = pendingRaw ? JSON.parse(pendingRaw) : null;
            } catch (_) {
              pending = null;
            }
            const step = pending?.username
              ? `正在处理 @${pending.username}`
              : queue.length > 0
                ? "队列已就绪"
                : "等待启动";
            return {
              queueLength: queue.length,
              head,
              pendingUsername: pending?.username || "-",
              step,
              url: location.href
            };
          }
        });

        const state = result?.result;
        if (state && runStep && runMeta && !uiLockedByCooldown && !uiLockedByStopped) {
          runStep.textContent = state.step;
          runMeta.textContent = `队列：${state.queueLength}\n队头：${state.head}\n当前：${state.pendingUsername}`;
        }
      } else if (runStep && runMeta && !uiLockedByCooldown && !uiLockedByStopped) {
        runStep.textContent = "等待启动";
        runMeta.textContent = "队列：0\n队头：-\n状态：未定位 X 页面";
      }
    } catch(e) {}
  }

  if (verifyLicenseBtn) {
    verifyLicenseBtn.onclick = async () => {
      verifyLicenseBtn.disabled = true;
      try {
        const kami = licenseKeyInput ? licenseKeyInput.value : '';
        setLicenseNotice('状态：验证中...');
        const result = await verifyKami(kami);
        await setCachedLicenseState({
          ok: true,
          vipUntil: result.vipUntil,
          verifiedAt: Date.now(),
          reason: result?.reason ? String(result.reason) : undefined,
        });
        chrome.runtime.sendMessage({ action: 'LICENSE_UPDATED' }, () => void 0);
        if (licenseKeyInput) licenseKeyInput.value = '';
        await updateLicenseUI();
        // 不使用 alert，避免超出 popup 且风格不一致
      } catch (e) {
        const prev = await getCachedLicenseState();
        await setCachedLicenseState({
          ok: false,
          vipUntil: prev?.vipUntil ?? null,
          verifiedAt: Date.now(),
          reason: String(e?.message || e)
        });
        chrome.runtime.sendMessage({ action: 'LICENSE_UPDATED' }, () => void 0);
        const reason = String(e?.message || e);
        setLicenseNotice(`状态：验证失败\n原因：${reason}`);
        await updateLicenseUI();
      } finally {
        verifyLicenseBtn.disabled = false;
      }
    };
  }

  if (startBtn) {
    startBtn.onclick = async () => {
      startBtn.disabled = true;
      try {
        const s = await getCachedLicenseState();
        const nowSec = Math.floor(Date.now() / 1000);
        const isValid = Boolean(s?.ok) && (s?.vipUntil == null || Number(s.vipUntil) > nowSec);
        if (!isValid) {
          throw new Error('请先完成卡密验证');
        }
        const startRes = await withTimeout(sendRuntimeMessage({ action: "START" }), 2500, 'START');
        if (!startRes || startRes.success !== true) {
          const errCode = String(startRes?.error || 'start_failed');
          if (errCode === 'license_invalid') {
            throw new Error('卡密已失效，请重新验证');
          }
          throw new Error(`后台拒绝启动：${errCode}`);
        }

        // 兜底：即使后台写入 runtimeState 异常，前台也能显示“运行中”，并给 content 脚本一个硬闸门参考。
        await chrome.storage.local.set({
          [RUNTIME_STORAGE_KEY]: { running: true, cooldowned: false }
        });

        await chrome.storage.local.set({ startSignal: Date.now() });
        const tabs = await chrome.tabs.query({ url: ["https://x.com/*", "https://*.x.com/*"] });
        const [activeXTab] = await chrome.tabs.query({ active: true, currentWindow: true, url: ["https://x.com/*", "https://*.x.com/*"] });
        await Promise.allSettled(tabs.map(async (tab) => {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => {
                const keysToRemove = [];
                for (let i = 0; i < sessionStorage.length; i++) {
                  const key = sessionStorage.key(i);
                  if (key && (key.startsWith("pending_") || key.startsWith("comment_"))) {
                    keysToRemove.push(key);
                  }
                }
                keysToRemove.forEach((key) => sessionStorage.removeItem(key));

                sessionStorage.removeItem("pending_target");
                localStorage.removeItem("pending_target");
                sessionStorage.removeItem("active_follower_target");
                localStorage.removeItem("active_follower_target");
                localStorage.removeItem("comment_queue");
                sessionStorage.removeItem("comment_queue");
                localStorage.removeItem("comment_session");
                sessionStorage.removeItem("comment_session");
                sessionStorage.removeItem("pending_dm_verify");
                localStorage.removeItem("pending_dm_verify");
                sessionStorage.removeItem("followers_session_count");
                localStorage.removeItem("followers_session_count");
                sessionStorage.removeItem("current_hub_author");
                localStorage.removeItem("current_hub_author");
                sessionStorage.removeItem("delivered_comment_targets");
                localStorage.removeItem("delivered_comment_targets");
                localStorage.removeItem("manual_test_active");
                localStorage.removeItem("manual_test_username");
                localStorage.removeItem("__DEBUG_QUEUE_HEAD__");
                if (document.visibilityState === "visible") {
                  window.postMessage({ type: "X_START_NOW", intent: "fresh_start" }, "*");
                }
              }
            });
          } catch (error) {
            console.warn(`[X-Assistant] 无法在标签页 ${tab.id} 注入启动脚本，可能是孤儿脚本。`);
          }

          // 当前活动的 X 页面优先强制刷新重建，其他页面只保留启动令牌等待自举。
          if (activeXTab && tab.id === activeXTab.id) {
            await chrome.tabs.reload(tab.id);
          }
        }));
      } catch (error) {
        // 避免 alert 破坏 popup 体验；尽量在状态区提示
        const msg = String(error?.message || error);
        setLicenseNotice(`状态：未就绪\n提示：${msg}`);
      } finally {
        await updateLicenseUI();
        refresh();
      }
    };
  }

  if (stopBtn) {
    stopBtn.onclick = async () => {
      stopBtn.disabled = true;
      try {
        // 先硬停：不依赖后台响应，直接通知所有 x.com 页面停机，并清掉启动信号。
        await chrome.storage.local.set({ startSignal: null });
        await chrome.storage.local.set({
          [RUNTIME_STORAGE_KEY]: { running: false, cooldowned: false }
        });
        // 注入广播可能在个别异常 tab 上卡住；这里加超时，避免 popup 体验“转圈”。
        try {
          await withTimeout(broadcastStopToAllTabs(), 1200, 'BROADCAST_STOP');
        } catch (_) {}

        // 再尽力通知后台更新状态（后台异常/超时也不影响前台已停止）。
        try {
          await withTimeout(sendRuntimeMessage({ action: "STOP" }), 2500, 'STOP');
        } catch (_) {}
      } catch (error) {
        const msg = String(error?.message || error);
        setLicenseNotice(`状态：停止失败\n提示：${msg}`);
      } finally {
        stopBtn.disabled = false;
        refresh();
      }
    };
  }

  const optBtn = el('openOptions');
  if (optBtn) {
    optBtn.onclick = () => {
      chrome.runtime.openOptionsPage();
    };
  }

  setInterval(refresh, 1000);
  refresh();
})();