export function buildStats(s) {
    return {
        phase: s.phase,
        call_count: s.calls.length,
        scan_count: s.scanCount,
        locked_addresses: Array.from(s.locks),
        cache_size: s.cache.size,
        evidence_count: s.evidence.length,
        hypothesis_count: s.hypotheses.length,
        audit_count: s.audit.length,
        summary: s.summary,
        elapsed_seconds: Math.round((Date.now() - s.startTime) / 1000),
        recent_calls: s.calls.slice(-10).reverse().map((c) => ({ tool: c.tool, ok: c.ok })),
        recent_events: s.recentEvents.slice(-5).reverse(),
    };
}
export function renderStatusHtml(s) {
    const stats = buildStats(s);
    const lockList = stats.locked_addresses.map((a) => `<li><code>${a}</code></li>`).join('') || '<li>none</li>';
    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>DSH Cheat Engine Status</title>
<style>
body{font-family:system-ui,sans-serif;background:#111;color:#eee;margin:2rem;max-width:720px}
h1{font-size:1.4rem}
.card{background:#1c1c1c;border:1px solid #333;border-radius:10px;padding:1rem;margin:1rem 0}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.k{color:#999;font-size:.8rem;text-transform:uppercase}
.v{font-size:1.1rem;font-weight:600}
ul{padding-left:1.2rem}
li{margin:.2rem 0}
</style>
</head>
<body>
<h1>🧊 DSH Cheat Engine Status</h1>
<div class="card"><div class="grid">
<div><div class="k">Phase</div><div class="v">${stats.phase}</div></div>
<div><div class="k">Calls</div><div class="v">${stats.call_count}</div></div>
<div><div class="k">Scan count</div><div class="v">${stats.scan_count}</div></div>
<div><div class="k">Elapsed</div><div class="v">${stats.elapsed_seconds}s</div></div>
<div><div class="k">Evidence</div><div class="v">${stats.evidence_count}</div></div>
<div><div class="k">Hypotheses</div><div class="v">${stats.hypothesis_count}</div></div>
</div></div>
<div class="card"><h2>Locked</h2><ul>${lockList}</ul></div>
<div class="card"><h2>Recent calls</h2><ul>${stats.recent_calls.map((c) => `<li>${c.ok ? '✅' : '❌'} ${c.tool}</li>`).join('') || '<li>none</li>'}</ul></div>
<script>setTimeout(()=>location.reload(), 2000)</script>
</body>
</html>`;
}
export function panelScript() {
    return `(function(){
  var PANEL_ID='dsh-ce-status-panel';
  var STYLE_ID='dsh-ce-status-panel-style';
  function ensureStyle(){
    if(document.getElementById(STYLE_ID)) return;
    var s=document.createElement('style');
    s.id=STYLE_ID;
    s.textContent='#dsh-ce-status-panel{position:fixed;right:16px;bottom:16px;z-index:99999;width:260px;background:var(--dsw-alias-bg-layer-3, #1c1c1c);color:var(--dsw-alias-label-primary, #eee);border:1px solid var(--dsw-alias-border-l2, #333);border-radius:12px;padding:12px 14px;font:12px/1.5 var(--ds-font-family-ui, system-ui);box-shadow:var(--dsw-shadow-lv1, 0 8px 30px rgba(0,0,0,.4));backdrop-filter:blur(6px)}' +
      '#dsh-ce-status-panel h3{margin:0 0 8px;font-size:13px;color:var(--dsw-alias-label-primary, #eee)}' +
      '#dsh-ce-status-panel .row{display:flex;justify-content:space-between;padding:2px 0;color:var(--dsw-alias-label-secondary, #ccc)}' +
      '#dsh-ce-status-panel .sum{margin-top:6px;color:var(--dsw-alias-label-tertiary, #999);white-space:pre-wrap}' +
      '#dsh-ce-status-panel .close{position:absolute;top:6px;right:10px;cursor:pointer;color:var(--dsw-alias-label-tertiary, #999)}';
    document.head.appendChild(s);
  }
  function ensurePanel(){
    var el=document.getElementById(PANEL_ID);
    if(el) return el;
    ensureStyle();
    el=document.createElement('div');
    el.id=PANEL_ID;
    el.innerHTML='<span class="close" onclick="this.parentNode.remove()">×</span>' +
      '<h3>🧊 CE Status</h3>' +
      '<div class="row"><span>Phase</span><b data-field="phase">-</b></div>' +
      '<div class="row"><span>Calls</span><b data-field="calls">-</b></div>' +
      '<div class="row"><span>Scan</span><b data-field="scan">-</b></div>' +
      '<div class="row"><span>Locks</span><b data-field="locks">-</b></div>' +
      '<div class="sum" data-field="summary"></div>';
    document.body.appendChild(el);
    return el;
  }
  function render(d){
    var el=ensurePanel();
    el.querySelector('[data-field=phase]').textContent=d.phase||'-';
    el.querySelector('[data-field=calls]').textContent=d.call_count;
    el.querySelector('[data-field=scan]').textContent=d.scan_count;
    el.querySelector('[data-field=locks]').textContent=d.locked_addresses?d.locked_addresses.length:0;
    el.querySelector('[data-field=summary]').textContent=d.summary||'';
  }
  function tick(){
    fetch('/ce-status/api').then(function(r){return r.json()}).then(render).catch(function(){});
  }
  if(window.MutationObserver){
    new MutationObserver(function(){ if(!document.getElementById(PANEL_ID)) ensurePanel(); }).observe(document.body,{childList:true});
  }
  tick(); setInterval(tick,2000);
})();`;
}
export function injectStatusPanel(html) {
    if (html.includes('/ce-status-panel.js'))
        return html;
    return html.replace('</body>', '<script src="/ce-status-panel.js"></script></body>');
}
//# sourceMappingURL=web.js.map