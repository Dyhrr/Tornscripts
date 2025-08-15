// ==UserScript==
// @name         Torn Trade Log (Auto) — Created by Dyhr
// @namespace    dyhrrr.torn.tradelog
// @version      1.7.0
// @description  First/Last trade + Total unique trades with this player in a chosen time window (1–5y). Dedupe by trade_id / 15-min bucket. Robust XID + optional name matching. Local notes, mark, backup.
// @author       Dyhr
// @match        https://www.torn.com/profiles.php*
// @match        https://www.torn.com/*profiles.php*
// @match        https://www.torn.com/loader.php*
// @match        https://www.torn.com/*#*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// ==/UserScript==

(function () {
  'use strict';

  // ---------------- keys / state ----------------
  const DB_KEY = 'tornTradeLog_v2';
  const ST_KEY = 'tornTradeLog_settings_v4'; // { apiKey, logoURL, historyYears, cacheDays, autoRefresh, nameFallback }
  const recheckTimers = {}; // { [xid]: timeoutId } — one silent recheck if count didn't move

  // ---------------- storage ----------------
  const loadDB = () => { try { return JSON.parse(GM_getValue(DB_KEY, '{}')); } catch { return {}; } };
  const saveDB = (db) => GM_setValue(DB_KEY, JSON.stringify(db || {}));
  const loadST = () => {
    let st = {};
    try { st = JSON.parse(GM_getValue(ST_KEY, '{}')) || {}; } catch {}
    if (st.historyYears == null) st.historyYears = 3;  // default depth
    if (st.cacheDays == null)    st.cacheDays = 7;
    if (st.autoRefresh == null)  st.autoRefresh = true;
    if (st.nameFallback == null) st.nameFallback = true; // match by name if XID is missing in log line
    return st;
  };
  const saveST = (st) => GM_setValue(ST_KEY, JSON.stringify(st || {}));

  // ---------------- utils ----------------
  const nowISO = () => new Date().toISOString();
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString() : '—');
  const ms = (d)=>d*24*3600*1000;
  const sleep = (t)=>new Promise(r=>setTimeout(r,t));
  const dateStamp = () => { const d=new Date(),p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
  const csvCell = (v)=>{ const s=String(v ?? ''); return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; };

  function httpJSON(url){
    return new Promise((resolve, reject) => {
      const handler = (raw) => {
        try {
          const j = JSON.parse(raw.responseText || raw);
          if (j && j.error) {
            const e = new Error(`API error ${j.error.code}: ${j.error.error}`);
            e.code = j.error.code; throw e;
          }
          resolve(j);
        } catch (err) { reject(err || new Error('Bad JSON')); }
      };
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({ method:'GET', url, onload:handler, onerror:()=>reject(new Error('Network error')) });
      } else {
        fetch(url).then(r=>r.text()).then(t=>handler({responseText:t})).catch(reject);
      }
    });
  }

  // ---------------- page data ----------------
  function getXID() {
    try { const u=new URL(location.href); const p=u.searchParams.get('XID'); if (p) return p; } catch {}
    const can=document.querySelector('link[rel="canonical"]'); if (can && /XID=(\d+)/.test(can.href)) return RegExp.$1;
    const header = Array.from(document.querySelectorAll('h1,h2,div,span,a')).map(el=>el.textContent||'').find(t=>/\[\d{3,10}\]/.test(t));
    if (header && /\[(\d{3,10})\]/.test(header)) return RegExp.$1;
    const t=document.body.innerText||''; const m=t.match(/\[(\d{3,10})\]/); return m?m[1]:null;
  }

  function cleanName(s) {
    if (!s) return '';
    let n = s.replace(/\s+/g,' ').trim();
    n = n.replace(/[:|]/g,'').replace(/[^\w\s.'-]/g,'').trim();
    if (n.length > 30) n = n.slice(0,30);
    return n;
  }

  function getDisplayName() {
    const xid = getXID();
    if (xid) {
      const m = (document.title || '').match(new RegExp(`([^\\[]+)\\s*\\[\\s*${xid}\\s*\\]`));
      if (m) { const n = cleanName(m[1]); if (n) return n; }
    }
    if (xid) {
      const nodes = Array.from(document.querySelectorAll('h1,h2,div,span,a,li,td,th'));
      for (const el of nodes) {
        const t = (el.textContent || '').trim();
        const rx = new RegExp(`([^\\[]{2,60})\\s*\\[\\s*${xid}\\s*\\]`);
        const m = t.match(rx);
        if (m) { const n = cleanName(m[1]); if (n) return n; }
      }
    }
    if (xid) {
      const anchors = Array.from(document.querySelectorAll(`a[href*="profiles.php?XID=${xid}"]`));
      const candidates = anchors.map(a => (a.textContent||'').trim())
        .filter(s => s && s.length <= 30 && !/[#:]/.test(s));
      if (candidates.length) { candidates.sort((a,b)=>b.length-a.length); return cleanName(candidates[0]); }
    }
    return `Player ${xid||''}`.trim();
  }

  function ensureRecord(xid, name, db) {
    const d = db || loadDB();
    d.players ||= {};
    if (!d.players[xid]) d.players[xid] = { name: name || `Player ${xid}`, mark:false, notes:'' };
    if (name && d.players[xid].name !== name) d.players[xid].name = name;
    if (!db) saveDB(d);
    return d.players[xid];
  }

  // ---------------- log parsing ----------------
  function normalizeLogs(p){
    if(!p) return [];
    if (Array.isArray(p.log)) return p.log;
    if (p.log && typeof p.log==='object') return Object.values(p.log);
    if (Array.isArray(p.logs)) return p.logs;
    if (p.logs && typeof p.logs==='object') return Object.values(p.logs);
    return [];
  }

  function isTradeCategory(e) {
    const c = String(e.category || '').toLowerCase();
    if (c === 'trades' || c === 'trade') return true;
    const t = String(e.title || e.event || '').toLowerCase();
    return /trade/.test(t);
  }

  function getTradeId(e) {
    const d = e?.data || {};
    return d.trade_id || d.tradeId || d.tid || d.tradeid || null;
  }

  function isFinalTradeEvent(e) {
    if (!isTradeCategory(e)) return false;
    const txt = `${e.title || ''} ${e.event || ''} ${e.action || ''}`.toLowerCase();
    if (/cancel(l)?ed|declined|aborted/.test(txt)) return false;
    return /(finali[sz]ed|completed|finished|accepted)/.test(txt);
  }

  function entryMentionsName(entry, name){
    if (!name) return false;
    const needle = name.trim().toLowerCase();
    const top = [entry.title, entry.event, entry.action, entry.description]
      .map(x=>String(x||'').toLowerCase());
    if (top.some(s => s.includes(needle))) return true;
    const d = entry.data || {};
    for (const v of Object.values(d)){
      if (typeof v === 'string' && v.toLowerCase().includes(needle)) return true;
      if (v && typeof v === 'object') {
        for (const vv of Object.values(v)) {
          if (typeof vv === 'string' && vv.toLowerCase().includes(needle)) return true;
        }
      }
    }
    return false;
  }

  function entryMatchesCounterpart(entry, xid, name, allowName){
    const n=String(xid);
    const fields=['other_id','target_id','player_id','counterpart_id','attacker_id','defender_id','user_id','partner_id','user'];
    for (const f of fields){
      if (String(entry[f] ?? '') === n) return true;
      if (entry.data && String(entry.data[f] ?? '') === n) return true;
    }
    const br = `[${n}]`;
    const top = [entry.title, entry.event, entry.action, entry.description].map(x=>String(x||''));
    if (top.some(s => s.includes(br))) return true;
    const d = entry.data || {};
    for (const v of Object.values(d)){
      if (typeof v === 'string' && v.includes(br)) return true;
      if (v && typeof v === 'object' && Object.values(v).some(vv => typeof vv==='string' && vv.includes(br))) return true;
    }
    if (allowName && isTradeCategory(entry) && entryMentionsName(entry, name)) return true;
    return false;
  }

  const tsToISO = (v)=>{ const n=Number(v); if(!Number.isFinite(n)) return null; const m=n<2e10?n*1000:n; const d=new Date(m); return isNaN(d.getTime())?null:d.toISOString(); };

  /** Group lines to unique trades (by trade_id; else 15-min buckets) */
  function collapseToUniqueTrades(entries, targetXID, targetName, allowName) {
    const groups = new Map(); // key -> events[]
    for (const e of entries) {
      if (!isTradeCategory(e)) continue;
      if (!entryMatchesCounterpart(e, targetXID, targetName, allowName)) continue;
      const ts = Number(e.timestamp || e.time || e.t || 0) || 0;
      const tid = getTradeId(e);
      const key = tid ? `tid:${tid}` : `approx:${targetXID}:${Math.floor(ts / 900)}`; // 15 min bucket
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    const finals = [];
    for (const arr of groups.values()) {
      let cand = arr.find(isFinalTradeEvent);
      if (!cand) cand = arr.slice().sort((a,b)=>(Number(a.timestamp||a.time||0)-Number(b.timestamp||b.time||0))).at(-1);
      if (cand) finals.push(cand);
    }
    return finals;
  }

  // ---------------- API sweep (strictly respect window) ----------------
  async function fetchTradeStatsViaAPI(targetXID, { apiKey, historyYears, nameFallback }) {
    if (!apiKey) throw new Error('Missing API key.');

    const end = Math.floor(Date.now()/1000) + 300; // include a little skew
    const start = end - Math.floor((historyYears || 1) * 365 * 24 * 3600);
    const chunk = 90 * 24 * 3600; // 90 days

    const targetName = getDisplayName();
    let to = end, from = Math.max(start, to - chunk), raw = [], guard = 0;

    while (to > start && guard < 24) {
      guard++;
      const tsBypass = encodeURIComponent(new Date().toISOString());
      const comment = 'Trader Log v1.7.0';
      const url =
        `https://api.torn.com/user/?selections=log&from=${from}&to=${to}` +
        `&timestamp=${tsBypass}&comment=${encodeURIComponent(comment)}` +
        `&key=${encodeURIComponent(apiKey)}`;
      const data = await httpJSON(url);
      const entries = normalizeLogs(data);
      for (const e of entries) {
        if (!e) continue;
        if (isTradeCategory(e) && entryMatchesCounterpart(e, targetXID, targetName, !!nameFallback)) raw.push(e);
      }
      to = from; from = Math.max(start, to - chunk);
      await sleep(200);
    }

    const trades = collapseToUniqueTrades(raw, targetXID, targetName, !!nameFallback);
    if (!trades.length) return { firstISO:null, lastISO:null, count:0, lastFetched: nowISO(), source:'live', historyYears };
    const ts = trades.map(e => tsToISO(e.timestamp || e.time || e.t || e.date)).filter(Boolean).sort();
    return { firstISO: ts[0]||null, lastISO: ts.at(-1)||null, count: trades.length, lastFetched: nowISO(), source:'live', historyYears };
  }

  // ---------------- UI ----------------
  GM_addStyle(`
    .ttn-card { position: fixed; top: 90px; right: 16px; z-index: 99999; background:#101214; color:#e6e6e6; border:1px solid #3a3f44; padding:10px; border-radius:12px; font:13px/1.35 system-ui,Arial; box-shadow:0 6px 18px rgba(0,0,0,.35); width:360px; max-width:92vw; }
    .ttn-row { display:flex; gap:8px; align-items:center; margin:6px 0; flex-wrap:wrap; }
    .ttn-row.space { justify-content:space-between; }
    .ttn-pill { padding:2px 8px; border:1px solid #555; border-radius:999px; }
    .ttn-btn { cursor:pointer; border:1px solid #555; background:#171a1c; color:#eee; padding:6px 10px; border-radius:8px; }
    .ttn-btn:active { transform: translateY(1px); }
    .ttn-btn.warn { border-color:#775; } .ttn-btn.prim { border-color:#5a7; }
    .ttn-input,.ttn-textarea { width:100%; background:#0f1113; color:#eee; border:1px solid #444; border-radius:8px; padding:6px 8px; }
    .ttn-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; width:100%; }
    .ttn-muted { opacity:.75; } .ttn-sep { height:1px; background:#2a2f33; margin:8px 0; width:100%; }
    .ttn-logo { width:18px; height:18px; object-fit:contain; border-radius:4px; background:#222; }
    .ttn-badge { font-size:11px; opacity:.8; }
    .ttn-chip { font-size:11px; padding:2px 6px; border:1px solid #444; border-radius:999px; }
    .ttn-err { background:#a33; color:#fff; padding:6px 8px; border-radius:6px; }
    #ttn-name { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display:inline-block; vertical-align:bottom; }
  `);

  function buildCard() {
    const st = loadST();
    const xid = getXID();
    const name = getDisplayName();
    if (xid) ensureRecord(xid, name);

    const card = document.createElement('div');
    card.className = 'ttn-card'; card.id = 'ttn-card';
    card.innerHTML = `
      <div class="ttn-row space">
        <div><strong>Trader Log</strong> <span class="ttn-badge ttn-muted">Created by Dyhr</span></div>
        <div style="display:flex;gap:6px;align-items:center;">
          <span id="ttn-source" class="ttn-chip ttn-muted">—</span>
          <button class="ttn-btn" id="ttn-settings">Settings</button>
        </div>
      </div>
      <div class="ttn-row">
        <img class="ttn-logo" id="ttn-logo" src="${st.logoURL || ''}" alt="">
        <div class="ttn-pill">Player: <strong id="ttn-name">${name}</strong></div>
        <div class="ttn-pill">XID: <strong id="ttn-xid">${xid || '—'}</strong></div>
        <button class="ttn-btn" id="ttn-mark" title="Mark/unmark this player (local only)">☆</button>
      </div>

      <div class="ttn-grid">
        <div><div class="ttn-muted">First trade</div><div id="ttn-first">—</div></div>
        <div><div class="ttn-muted">Last trade</div><div id="ttn-last">—</div></div>
      </div>
      <div class="ttn-row">
        <div class="ttn-muted">Total trades:</div>
        <div id="ttn-count"><strong>0</strong></div>
        <button class="ttn-btn prim" id="ttn-refresh">Refresh via API</button>
      </div>

      <div id="ttn-error" class="ttn-row" style="display:none;"></div>

      <div class="ttn-sep"></div>

      <div class="ttn-row">
        <textarea class="ttn-textarea" id="ttn-notes" rows="5" placeholder="Notes (local to this browser)"></textarea>
      </div>
      <div class="ttn-row" style="justify-content:flex-end; gap:6px;">
        <button class="ttn-btn prim" id="ttn-save">Save notes</button>
      </div>

      <div class="ttn-row space" style="margin-top:8px;">
        <div style="display:flex; gap:6px;">
          <button class="ttn-btn" id="ttn-export-json">Export JSON</button>
          <button class="ttn-btn" id="ttn-export-csv">Export CSV</button>
        </div>
        <button class="ttn-btn warn" id="ttn-import">Import JSON</button>
      </div>

      <div class="ttn-row ttn-muted" style="font-size:12px;">Data is API-driven for the selected window. Export JSON for backup. Import will MERGE.</div>
    `;
    document.body.appendChild(card);

    // hydrate cached state
    if (xid) {
      const db = loadDB(); const rec = db.players?.[xid];
      if (rec) {
        card.querySelector('#ttn-notes').value = rec.notes || '';
        card.querySelector('#ttn-mark').textContent = rec.mark ? '★' : '☆';
        if (rec.stats) { applyStatsToUI(card, rec.stats); setSourceChip(card, 'cached', rec.stats.lastFetched); }
      }
    }

    const stNow = loadST();
    if (!stNow.apiKey) openSettingsModal(card, true);
    else if (stNow.autoRefresh) hydrateFromAPI(card);

    card.querySelector('#ttn-settings').addEventListener('click', () => openSettingsModal(card, false));
    card.querySelector('#ttn-refresh').addEventListener('click', () => hydrateFromAPI(card));
    card.querySelector('#ttn-mark').addEventListener('click', () => {
      const xx = getXID(); if (!xx) return flash('XID not detected yet.');
      const db = loadDB(); const r = ensureRecord(xx, getDisplayName(), db);
      r.mark = !r.mark; saveDB(db);
      card.querySelector('#ttn-mark').textContent = r.mark ? '★' : '☆';
    });
    card.querySelector('#ttn-save').addEventListener('click', () => {
      const xx = getXID(); if (!xx) return flash('XID not detected yet.');
      const db = loadDB(); const r = ensureRecord(xx, getDisplayName(), db);
      r.notes = card.querySelector('#ttn-notes').value; saveDB(db); flash('Notes saved.');
    });
    card.querySelector('#ttn-export-json').addEventListener('click', () => {
      const json = JSON.stringify(loadDB(), null, 2);
      download(`torn-trade-notes-${dateStamp()}.json`, json, 'application/json');
    });
    card.querySelector('#ttn-export-csv').addEventListener('click', () => {
      const db = loadDB();
      const rows = [['xid','name','first_trade','last_trade','total_trades','mark','notes','last_synced','window_years']];
      for (const [idx, r] of Object.entries(db.players || {})) {
        const s = r.stats || {};
        rows.push([ idx, r.name ?? '', s.firstISO ?? '', s.lastISO ?? '', String(s.count ?? 0), r.mark ? '1' : '0', String(r.notes ?? '').replace(/\n/g,'\\n'), s.lastFetched ?? '', s.historyYears ?? '' ]);
      }
      const csv = rows.map(r => r.map(csvCell).join(',')).join('\n');
      download(`torn-trade-notes-${dateStamp()}.csv`, csv, 'text/csv');
    });
    card.querySelector('#ttn-import').addEventListener('click', () => {
      const text = prompt('Paste JSON exported from this tool. This will MERGE with your current data.');
      if (!text) return;
      try { const merged = mergeDB(loadDB(), JSON.parse(text)); saveDB(merged); flash('Import successful. Reload page.'); }
      catch { alert('Invalid JSON.'); }
    });
  }

  function applyStatsToUI(card, stats) {
    card.querySelector('#ttn-first').textContent = stats.firstISO ? fmtDate(stats.firstISO) : '—';
    card.querySelector('#ttn-last').textContent  = stats.lastISO  ? fmtDate(stats.lastISO)  : '—';
    card.querySelector('#ttn-count').innerHTML   = `<strong>${stats.count ?? 0}</strong>`;
  }
  function setSourceChip(card, source, lastFetchedISO) {
    const el = card.querySelector('#ttn-source'); if (!el) return;
    if (source === 'live') { el.textContent = 'API: live'; el.classList.remove('ttn-muted'); }
    else { const age = lastFetchedISO ? humanAge(new Date() - new Date(lastFetchedISO)) : ''; el.textContent = `cached${age ? ' · ' + age : ''}`; el.classList.add('ttn-muted'); }
  }
  function humanAge(ms){ const mins=Math.floor(ms/60000); if(mins<60) return `${mins}m`; const hrs=Math.floor(mins/60); if(hrs<24) return `${hrs}h`; const days=Math.floor(hrs/24); return `${days}d`; }

  async function hydrateFromAPI(card) {
    const st = loadST();
    const xid = getXID();
    if (!xid) return flash('XID not detected yet.');
    if (!st.apiKey) return flash('Set API key in Settings.');

    clearError(card);

    const db = loadDB();
    const rec = db.players?.[xid] || {};
    const prevCount = rec.stats?.count ?? null;

    // if the saved stats were computed for a different window, treat as stale
    const staleByWindow = rec.stats && rec.stats.historyYears !== st.historyYears;
    const staleByAge = !rec.stats || (Date.now() - new Date(rec.stats.lastFetched || 0).getTime()) > ms(st.cacheDays);

    if (!staleByWindow && !staleByAge) setSourceChip(card, 'cached', rec.stats?.lastFetched);

    const btn = card.querySelector('#ttn-refresh'); btn.disabled = true; btn.textContent = 'Fetching…';
    try {
      const stats = await fetchTradeStatsViaAPI(xid, st);
      const r = ensureRecord(xid, getDisplayName(), db);
      r.stats = stats; // includes historyYears
      saveDB(db);

      applyStatsToUI(card, stats);
      setSourceChip(card, 'live');

      // one silent recheck (handles occasional CDN lag)
      if (prevCount !== null && stats.count <= prevCount && !recheckTimers[xid]) {
        recheckTimers[xid] = setTimeout(async () => {
          try {
            const s2 = await fetchTradeStatsViaAPI(xid, st);
            const rr = ensureRecord(xid, getDisplayName(), loadDB());
            rr.stats = s2; saveDB(loadDB());
            applyStatsToUI(card, s2);
            setSourceChip(card, 'live');
          } finally {
            clearTimeout(recheckTimers[xid]); delete recheckTimers[xid];
          }
        }, 35000);
      }
    } catch (e) {
      showError(card, e);
    } finally {
      btn.disabled = false; btn.textContent = 'Refresh via API';
    }
  }

  function showError(card, err){
    const e = card.querySelector('#ttn-error');
    if (!e) return;
    e.style.display = 'block';
    e.innerHTML = `<div class="ttn-err">API error: ${err.message || err}</div>`;
  }
  function clearError(card){ const e = card.querySelector('#ttn-error'); if (e){ e.style.display='none'; e.innerHTML=''; } }

  function openSettingsModal(card, auto=false) {
    const st = loadST();
    const wrap = document.createElement('div');
    wrap.style.cssText = `position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:100000; display:flex; align-items:center; justify-content:center;`;
    wrap.innerHTML = `
      <div class="ttn-card" style="max-width:560px; position:relative; top:0; right:0;">
        <div class="ttn-row space">
          <strong>Trader Log — Settings</strong>
          <button class="ttn-btn" id="ttn-close">${auto?'Skip':'Close'}</button>
        </div>

        <div class="ttn-row"><div class="ttn-muted">API key (must allow user → log)</div></div>
        <div class="ttn-row" style="gap:8px;">
          <input class="ttn-input" id="st-api" placeholder="API key" value="${st.apiKey || ''}" style="flex:1;">
          <button class="ttn-btn" id="st-create">Create API key</button>
        </div>

        <div class="ttn-row"><div class="ttn-muted">Logo URL (optional)</div></div>
        <div class="ttn-row"><input class="ttn-input" id="st-logo" placeholder="https://..." value="${st.logoURL || ''}"></div>

        <div class="ttn-grid" style="grid-template-columns:1fr 1fr;">
          <div>
            <div class="ttn-row"><div class="ttn-muted">History depth (years)</div></div>
            <div class="ttn-row"><input class="ttn-input" id="st-years" type="number" min="1" max="5" value="${st.historyYears}"></div>
          </div>
          <div>
            <div class="ttn-row"><div class="ttn-muted">Cache validity (days)</div></div>
            <div class="ttn-row"><input class="ttn-input" id="st-cache" type="number" min="1" max="60" value="${st.cacheDays}"></div>
          </div>
        </div>

        <div class="ttn-row"><label><input id="st-auto" type="checkbox" ${st.autoRefresh ? 'checked':''}> Auto refresh on profile open</label></div>
        <div class="ttn-row"><label><input id="st-namefb" type="checkbox" ${st.nameFallback ? 'checked':''}> Allow name-based matching if XID absent</label></div>

        <div class="ttn-row" style="justify-content:flex-end;gap:6px;">
          <button class="ttn-btn prim" id="st-save">Save</button>
        </div>
        <div class="ttn-row ttn-muted" style="font-size:12px;">Settings are stored locally (Tampermonkey).</div>
      </div>
    `;
    document.body.appendChild(wrap);
    wrap.querySelector('#ttn-close').addEventListener('click', ()=>wrap.remove());
    wrap.querySelector('#st-create').addEventListener('click', () => window.open('https://www.torn.com/preferences.php#tab=api', '_blank'));
    wrap.querySelector('#st-save').addEventListener('click', ()=>{
      const next = {
        apiKey: document.getElementById('st-api').value.trim(),
        logoURL: document.getElementById('st-logo').value.trim(),
        historyYears: Math.max(1, Math.min(5, Number(document.getElementById('st-years').value || 3))),
        cacheDays: Math.max(1, Math.min(60, Number(document.getElementById('st-cache').value || 7))),
        autoRefresh: !!document.getElementById('st-auto').checked,
        nameFallback: !!document.getElementById('st-namefb').checked,
      };
      saveST(next);
      const logo = document.getElementById('ttn-logo'); if (logo) logo.src = next.logoURL || '';
      wrap.remove(); flash('Settings saved.');
    });
  }

  function mergeDB(current, incoming) {
    const out = JSON.parse(JSON.stringify(current || {}));
    out.players ||= {};
    const incPlayers = (incoming && incoming.players) || {};
    for (const [xid, rec] of Object.entries(incPlayers)) {
      if (!out.players[xid]) out.players[xid] = { name:'', mark:false, notes:'' };
      const dst = out.players[xid];
      dst.name = rec.name || dst.name;
      dst.notes = (dst.notes && rec.notes && dst.notes !== rec.notes) ? `${dst.notes}\n---\n${rec.notes}` : (rec.notes || dst.notes);
      dst.mark = dst.mark || !!rec.mark;
      if (rec.stats) {
        const cur = dst.stats || {};
        const curT = new Date(cur.lastFetched || 0).getTime();
        const incT = new Date(rec.stats.lastFetched || 0).getTime();
        if (!curT || (incT && incT > curT)) dst.stats = rec.stats;
      }
    }
    return out;
  }

  function flash(msg){
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;bottom:16px;right:16px;background:#0b3;color:#fff;padding:8px 12px;border-radius:8px;z-index:100001;box-shadow:0 2px 10px rgba(0,0,0,.3);';
    document.body.appendChild(el);
    setTimeout(()=>el.remove(), 1600);
  }
  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---------------- boot ----------------
  function mountOnce(){ if (!document.getElementById('ttn-card')) buildCard(); }
  const obs = new MutationObserver(()=>{ if (/profiles\.php/i.test(location.href) || document.querySelector('h1,[class*="title___"]')) mountOnce(); });
  function start(){ mountOnce(); obs.observe(document.documentElement,{childList:true,subtree:true}); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
