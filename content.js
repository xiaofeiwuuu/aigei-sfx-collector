const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let waiter = null;
window.addEventListener('message', (e) => {
  if (e.source === window && e.data?.source === 'aigei-sfx-collector' && waiter) waiter(e.data.url);
});

async function findPlayBtn(li) {
  for (let i = 0; i < 15; i++) {
    const btn = li.querySelector('.audio-player-btn');
    if (btn) return btn;
    await sleep(200);
  }
  return null;
}

function askCachedUrl(itemId) {
  return new Promise((resolve) => {
    const reqId = Math.random().toString(36).slice(2);
    const onMsg = (e) => {
      const d = e.data;
      if (e.source === window && d?.source === 'aigei-sfx-collector-res' && d.reqId === reqId) {
        window.removeEventListener('message', onMsg); clearTimeout(timer); resolve(d.url);
      }
    };
    const timer = setTimeout(() => { window.removeEventListener('message', onMsg); resolve(null); }, 600);
    window.addEventListener('message', onMsg);
    window.postMessage({ source: 'aigei-sfx-collector-req', type: 'getCachedUrl', itemId, reqId }, '*');
  });
}

async function captureOne(li) {
  // 1) 你已经手动试听过:站点不会再发请求,链接在播放器对象上,直接读
  const cached = await askCachedUrl(li.getAttribute('itemid'));
  if (cached) return cached;
  // 2) 没播放过:点播放,等站点自己的回调把链接交给我们
  const btn = await findPlayBtn(li);
  if (!btn) return null;
  const url = await new Promise((resolve) => {
    const timer = setTimeout(() => { waiter = null; resolve(null); }, 8000);
    waiter = (u) => { clearTimeout(timer); waiter = null; resolve(u); };
    btn.click();
  });
  if (url) setTimeout(() => btn.click(), 300); // 再点一次暂停,避免多条同时播放
  return url;
}

// ---------- 注入 UI ----------
const previewCache = new Map();
let busy = false; // 同一时间只处理一条,避免播放响应对不上条目
let stopFlag = false;

const safeName = (s) => String(s).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
const extOf = (u) => (u.split('?')[0].match(/\.(mp3|m4a|wav|ogg)$/i) || [, 'mp3'])[1].toLowerCase();

async function getPreview(li) {
  const id = li.getAttribute('itemid');
  if (previewCache.has(id)) return previewCache.get(id);
  const url = await captureOne(li);
  if (url) previewCache.set(id, url);
  return url;
}

async function fetchB64(url) {
  // 在页面上下文发起:浏览器自动带 aigei.com 的 Referer;force-cache 优先用试听时已缓存的那份
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const buf = new Uint8Array(await res.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function downloadRow(li) {
  const id = li.getAttribute('itemid');
  // 详情页的主音效没有 .title-name,退回用页面标题(去掉站点后缀)
  const title = li.querySelector('.title-name')?.title || document.title.split(' - ')[0].trim() || id;
  const url = await getPreview(li);
  if (!url) return { ok: false, why: '没取到试听链接' };
  try {
    const b64 = await fetchB64(url);
    const res = await chrome.runtime.sendMessage({ type: 'save', b64, filename: `aigei/${id}_${safeName(title)}.${extOf(url)}` });
    return res?.ok ? { ok: true } : { ok: false, why: res?.error || '保存失败' };
  } catch (e) {
    return { ok: false, why: String(e.message || e) };
  }
}

function setBtn(btn, text, disabled, state) {
  btn.textContent = text;
  btn.disabled = !!disabled;
  const color = { ok: ['#27ae60', '#1e8449'], fail: ['#b71c1c', '#8e1515'], busy: ['#999', '#888'] }[state] || ['#ff4d2e', '#e03a1c'];
  btn.style.background = color[0];
  btn.style.borderColor = color[1];
}

function injectRowButtons() {
  document.querySelectorAll('li.audio-item-box').forEach((li) => {
    if (li.querySelector('.sfx-direct-dl')) return;
    // 列表行(rowPc)放在下载按钮旁;热门卡片(boxPc)很窄,放在时长那一行并缩小
    const isBox = li.getAttribute('js-audio-wave-type') === 'boxPc';
    const host = isBox ? li.querySelector('.audio-item-row1 .info') : li.querySelector('.audio-download-box');
    if (!host) return;
    const btn = document.createElement('button');
    btn.className = 'sfx-direct-dl btn btn-default';
    btn.type = 'button';
    btn.textContent = '直接下载';
    btn.style.cssText = (isBox
      ? 'float:right;padding:0 8px;font-size:12px;line-height:22px;height:24px;margin-left:6px;'
      : 'margin-left:8px;font-weight:bold;')
      + 'background:#ff4d2e;border:1px solid #e03a1c;color:#fff;font-weight:bold;border-radius:3px;cursor:pointer;';
    btn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      if (busy) return;
      busy = true; setBtn(btn, '处理中…', true, 'busy');
      const r = await downloadRow(li);
      busy = false;
      setBtn(btn, r.ok ? '已下载 ✓' : '失败:' + r.why, false, r.ok ? 'ok' : 'fail');
    });
    host.appendChild(btn);
  });
}

function injectBulkBar() {
  if (document.getElementById('sfx-bulk-bar')) return;
  const bar = document.createElement('div');
  bar.id = 'sfx-bulk-bar';
  bar.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99999;background:#fff;border:1px solid #ccc;border-radius:6px;padding:10px 12px;box-shadow:0 2px 10px rgba(0,0,0,.2);font-size:13px;max-width:300px';
  bar.innerHTML = '<button id="sfx-all" class="btn btn-primary">下载本页全部试听</button> <button id="sfx-stop" class="btn btn-default" disabled>停止</button><div id="sfx-msg" style="margin-top:6px;color:#555">就绪</div>';
  document.body.appendChild(bar);
  const all = bar.querySelector('#sfx-all'), stop = bar.querySelector('#sfx-stop'), msg = bar.querySelector('#sfx-msg');
  stop.onclick = () => { stopFlag = true; msg.textContent = '正在停止…'; };
  all.onclick = async () => {
    if (busy) return;
    busy = true; stopFlag = false; all.disabled = true; stop.disabled = false;
    const rows = [...document.querySelectorAll('li.audio-item-box')].filter((li) => li.offsetParent !== null);
    if (rows.length > 30 && !confirm(`当前页有 ${rows.length} 个音效(含热门/原创等多个区块),逐条下载约需 ${Math.ceil(rows.length * 3 / 60)} 分钟。确认全部下载吗?`)) {
      busy = false; all.disabled = false; stop.disabled = true; return;
    }
    let ok = 0, fail = 0, misses = 0;
    for (let i = 0; i < rows.length && !stopFlag; i++) {
      msg.textContent = `处理 ${i + 1}/${rows.length}:${rows[i].querySelector('.title-name')?.title?.slice(0, 20) || ''}`;
      const r = await downloadRow(rows[i]);
      if (r.ok) { ok++; misses = 0; } else { fail++; misses++; }
      if (misses >= 3) { msg.textContent = `连续 3 条失败,已停止(可能出现验证码或页面结构变了)。成功 ${ok} 失败 ${fail}`; break; }
      await sleep(1200 + Math.random() * 1000);
    }
    if (misses < 3) msg.textContent = `${stopFlag ? '已停止' : '完成'}:成功 ${ok},失败 ${fail}(保存在「下载」/aigei/)`;
    busy = false; all.disabled = false; stop.disabled = true;
  };
}

function initUi() {
  if (!document.querySelector('li.audio-item-box')) return; // 非音效页面不注入任何东西
  injectRowButtons();
  injectBulkBar();
}
initUi();
new MutationObserver(initUi).observe(document.body, { childList: true, subtree: true });
