// 后台只负责把页面取到的字节保存成文件。
// 注意:后台自己 fetch 爱给 CDN 会因缺少 aigei.com 的 Referer 而 403,所以下载请求都在页面里发起。
chrome.runtime.onMessage.addListener((msg, _s, send) => {
  if (msg.type === 'save') {
    chrome.downloads
      .download({ url: 'data:application/octet-stream;base64,' + msg.b64, filename: msg.filename, conflictAction: 'overwrite' })
      .then(() => send({ ok: true }))
      .catch((e) => send({ ok: false, error: String(e.message || e) }));
    return true; // 异步响应
  }
});
