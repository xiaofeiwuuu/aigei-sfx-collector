// 运行在页面上下文(MAIN world)。
// 站点点击试听后:XHR 响应 {statusCode, message} 的 message 是编码的,
// 由站点自己的 prest() 解码后交给 window.callBackAudioFilePlay(itemId, 解码后的JSON字符串, ...)。
// 这里包一层该回调,读取它收到的 url;不自己解码,也不发起任何请求。
(() => {
  const post = (url) => window.postMessage({ source: 'aigei-sfx-collector', url }, '*');

  function wrap() {
    const orig = window.callBackAudioFilePlay;
    if (typeof orig !== 'function' || orig.__sfxWrapped) return typeof orig === 'function';
    const wrapped = function (itemId, msg) {
      try {
        const q = typeof msg === 'string' ? JSON.parse(msg) : msg;
        if (q && typeof q.url === 'string') post(q.url);
      } catch (_) {}
      return orig.apply(this, arguments);
    };
    wrapped.__sfxWrapped = true;
    window.callBackAudioFilePlay = wrapped;
    return true;
  }

  // 内容脚本询问:这条音效是否已被播放过(站点把链接缓存在播放器对象上)
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.source !== 'aigei-sfx-collector-req' || d.type !== 'getCachedUrl') return;
    let url = null;
    try {
      const el = window.$ && window.$(`.js-audio-container[itemid='${d.itemId}']`);
      const player = el && el.length && window.AudioPlayerManager && window.AudioPlayerManager.getByEl(el);
      url = (player && player.audioSound && player.audioSound.url) || null;
      if (typeof url !== 'string') url = null;
    } catch (_) {}
    window.postMessage({ source: 'aigei-sfx-collector-res', reqId: d.reqId, url }, '*');
  });

  // 站点脚本加载完才有该函数:加载过程中轮询,直到包上为止
  let tries = 0;
  const timer = setInterval(() => { if (wrap() || ++tries > 200) clearInterval(timer); }, 100);
  window.addEventListener('load', wrap);
})();
