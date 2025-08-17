// ==UserScript==
// @name         Torn Trade Log — Manual (Created by Dyhr)
// @namespace    dyhrrr.torn.tradelog.manual
// @version      2.0.0
// @description  Manual-only trade logger per player. Add as Buyer/Seller with timestamp, auto-calculated first/last trade + totals, notes/mark, undo, export/import. 100% local. No API.
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
// ==/UserScript==

(function () {
  'use strict';

  // ---------------- state / storage ----------------
  const DB_KEY = 'tornTradeLog_manual_v1';
  const TAG = '[TraderLogManual]';
  const DEBUG = true;

  const dbg  = (...a)=>DEBUG&&console.log(TAG, ...a);
  const warn = (...a)=>DEBUG&&console.warn(TAG, ...a);

  const loadDB = () => { try { return JSON.parse(GM_getValue(DB_KEY, '{}')); } catch { return {}; } };
  const saveDB = (db) => GM_setValue(DB_KEY, JSON.stringify(db || {}));

  // ---------------- utils ----------------
  const csvCell = (v)=>{ const s=String(v ?? ''); return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; };
  const dateStamp = () => { const d=new Date(),p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString() : '—');
  const toLocalInputValue = (d) => {
    const pad = (n)=>String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function flash(msg){
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;bottom:16px;right:16px;background:#0b3;color:#fff;padding:8px 12px;border-radius:8px;z-index:100001;box-shadow:0 2px 10px rgba(0,0,0,.3);';
    document.body.appendChild(el);
    setTimeout(()=>el.remove(), 1600);
  }

  // ---------------- page data ----------------
  function getXID() {
    try { const u=new URL(location.href); const p=u.searchParams.get('XID'); if (p) return p; } catch {}
    const can=document.querySelector('link[rel="canonical"]'); if (can && /XID=(\d+)/.test(can.href)) return RegExp.$1;
    const t=document.body?.innerText||''; const m=t.match(/\[(\d{3,10})\]/); return m?m[1]:null;
  }
  function cleanName(s){ if(!s) return ''; let n=s.replace(/\s+/g,' ').trim(); n=n.replace(/[:|]/g,'').replace(/[^\w\s.'-]/g,'').trim(); if(n.length>30)n=n.slice(0,30); return n; }
  function getDisplayName() {
    const xid = getXID();
    if (xid) {
      const m = (document.title || '').match(new RegExp(`([^\\[]+)\\s*\\[\\s*${xid}\\s*\\]`));
      if (m) { const n = cleanName(m[1]); if (n) return n; }
    }
    return `Player ${xid||''}`.trim();
  }

  function ensureRecord(xid, name, db) {
    const d = db || loadDB();
    d.players ||= {};
    if (!d.players[xid]) d.players[xid] = {
      name: name || `Player ${xid}`,
      mark: false,
      notes: '',
      entries: [], // [{iso, dir:'buy'|'sell'}]
      stats: { count:0, buys:0, sells:0, firstISO:null, lastISO:null }
    };
    if (name && d.players[xid].name !== name) d.players[xid].name = name;
    if (!db) saveDB(d);
    return d.players[xid];
  }

  function recomputeStats(rec) {
    const e = rec.entries || [];
    const count = e.length;
    let buys = 0, sells = 0;
    let firstISO = null, lastISO = null;
    for (const it of e) {
      if (it.dir === 'buy') buys++;
      else if (it.dir === 'sell') sells++;
      const iso = it.iso;
      if (!iso) continue;
      if (!firstISO || iso < firstISO) firstISO = iso;
      if (!lastISO  || iso > lastISO)  lastISO  = iso;
    }
    rec.stats = { count, buys, sells, firstISO, lastISO };
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
    .ttn-chip { font-size:11px; padding:2px 6px; border:1px solid #444; border-radius:999px; }
    .ttn-err { background:#a33; color:#fff; padding:6px 8px; border-radius:6px; }
    #ttn-name { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display:inline-block; vertical-align:bottom; }
    .ttn-list { width:100%; font-size:12px; border:1px solid #2b2f33; border-radius:8px; overflow:hidden; }
    .ttn-list table { width:100%; border-collapse:collapse; }
    .ttn-list th, .ttn-list td { padding:6px 8px; border-bottom:1px solid #2b2f33; }
    .ttn-list tr:last-child td { border-bottom:none; }
    .ttn-badge { font-size:11px; opacity:.8; }
  `);

  function applyStatsToUI(card, stats) {
    card.querySelector('#ttn-first').textContent = stats.firstISO ? fmtDate(stats.firstISO) : '—';
    card.querySelector('#ttn-last').textContent  = stats.lastISO  ? fmtDate(stats.lastISO)  : '—';
    card.querySelector('#ttn-count').innerHTML   = `<strong>${stats.count ?? 0}</strong>`;
    card.querySelector('#ttn-buys').textContent  = String(stats.buys ?? 0);
    card.querySelector('#ttn-sells').textContent = String(stats.sells ?? 0);
  }

  function renderRecentEntries(card, rec) {
    const box = card.querySelector('#ttn-entries');
    if (!box) return;
    const recent = (rec.entries || []).slice(-8).reverse();
    const rows = recent.map(it => `<tr><td>${fmtDate(it.iso)}</td><td>${it.dir === 'buy' ? 'Buyer' : 'Seller'}</td></tr>`).join('');
    box.innerHTML = `
      <div class="ttn-list">
        <table>
          <thead><tr><th style="text-align:left;">When</th><th style="text-align:left;">Role</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="2" class="ttn-muted">No entries yet.</td></tr>`}</tbody>
        </table>
      </div>`;
  }

  function buildCard() {
    const xid = getXID();
    const name = getDisplayName();
    if (!xid) return;

    if (document.getElementById('ttn-card')) return;

    // ensure record exists
    const db = loadDB();
    const rec = ensureRecord(xid, name, db);
    saveDB(db);

    const card = document.createElement('div');
    card.className = 'ttn-card'; card.id = 'ttn-card';
    card.innerHTML = `
      <div class="ttn-row space">
        <div><strong>Trader Log</strong> <span class="ttn-badge ttn-muted">Manual · Created by Dyhr</span></div>
        <div class="ttn-chip">local-only</div>
      </div>

      <div class="ttn-row">
        <div class="ttn-pill">Player: <strong id="ttn-name">${name}</strong></div>
        <div class="ttn-pill">XID: <strong id="ttn-xid">${xid}</strong></div>
        <button class="ttn-btn" id="ttn-mark" title="Mark/unmark this player (local only)">${rec.mark ? '★' : '☆'}</button>
      </div>

      <div class="ttn-grid">
        <div><div class="ttn-muted">First trade</div><div id="ttn-first">—</div></div>
        <div><div class="ttn-muted">Last trade</div><div id="ttn-last">—</div></div>
      </div>

      <div class="ttn-row" style="align-items:flex-end;">
        <div>
          <div class="ttn-muted">Total trades</div>
          <div id="ttn-count"><strong>0</strong></div>
        </div>
        <div class="ttn-chip">Buyer: <span id="ttn-buys">0</span></div>
        <div class="ttn-chip">Seller: <span id="ttn-sells">0</span></div>
      </div>

      <div class="ttn-row">
        <label class="ttn-muted" for="ttn-when">Timestamp</label>
        <input id="ttn-when" class="ttn-input" type="datetime-local" />
      </div>

      <div class="ttn-row" style="gap:6px;">
        <button class="ttn-btn prim" id="ttn-add-buy">Add as Buyer</button>
        <button class="ttn-btn prim" id="ttn-add-sell">Add as Seller</button>
        <button class="ttn-btn warn" id="ttn-undo" title="Remove most recent entry">Undo last</button>
      </div>

      <div class="ttn-sep"></div>

      <div id="ttn-entries"></div>

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
    `;
    document.body.appendChild(card);

    // hydrate UI
    if (rec.stats) applyStatsToUI(card, rec.stats);
    card.querySelector('#ttn-notes').value = rec.notes || '';
    // default timestamp = now (rounded to minute)
    const now = new Date(); now.setSeconds(0,0);
    card.querySelector('#ttn-when').value = toLocalInputValue(now);
    renderRecentEntries(card, rec);

    // wire actions
    const addEntry = (dir) => {
      const whenVal = (card.querySelector('#ttn-when').value || '').trim();
      let iso;
      if (whenVal) {
        const d = new Date(whenVal);
        if (isNaN(d.getTime())) return flash('Invalid date/time.');
        iso = d.toISOString();
      } else {
        iso = new Date().toISOString();
      }
      const db2 = loadDB();
      const r = ensureRecord(xid, getDisplayName(), db2);
      r.entries ||= [];
      r.entries.push({ iso, dir: dir === 'sell' ? 'sell' : 'buy' });
      recomputeStats(r);
      saveDB(db2);
      applyStatsToUI(card, r.stats);
      renderRecentEntries(card, r);
      flash(dir === 'sell' ? 'Logged: Seller' : 'Logged: Buyer');
    };

    card.querySelector('#ttn-add-buy').addEventListener('click', ()=>addEntry('buy'));
    card.querySelector('#ttn-add-sell').addEventListener('click', ()=>addEntry('sell'));

    card.querySelector('#ttn-undo').addEventListener('click', ()=>{
      const db2 = loadDB();
      const r = ensureRecord(xid, getDisplayName(), db2);
      if (!r.entries || !r.entries.length) return flash('No entries to undo.');
      r.entries.pop();
      recomputeStats(r);
      saveDB(db2);
      applyStatsToUI(card, r.stats);
      renderRecentEntries(card, r);
      flash('Undid last entry.');
    });

    card.querySelector('#ttn-mark').addEventListener('click', () => {
      const db2 = loadDB();
      const r = ensureRecord(xid, getDisplayName(), db2);
      r.mark = !r.mark; saveDB(db2);
      card.querySelector('#ttn-mark').textContent = r.mark ? '★' : '☆';
    });

    card.querySelector('#ttn-save').addEventListener('click', () => {
      const db2 = loadDB();
      const r = ensureRecord(xid, getDisplayName(), db2);
      r.notes = card.querySelector('#ttn-notes').value;
      saveDB(db2);
      flash('Notes saved.');
    });

    card.querySelector('#ttn-export-json').addEventListener('click', () => {
      const json = JSON.stringify(loadDB(), null, 2);
      download(`torn-trade-notes-${dateStamp()}.json`, json, 'application/json');
    });

    card.querySelector('#ttn-export-csv').addEventListener('click', () => {
      const db2 = loadDB();
      const rows = [['xid','name','first_trade','last_trade','total_trades','buys','sells','mark','notes']];
      for (const [idx, r] of Object.entries(db2.players || {})) {
        const s = r.stats || {};
        rows.push([
          idx, r.name ?? '', s.firstISO ?? '', s.lastISO ?? '',
          String(s.count ?? 0), String(s.buys ?? 0), String(s.sells ?? 0),
          r.mark ? '1' : '0',
          String(r.notes ?? '').replace(/\n/g,'\\n')
        ]);
      }
      const csv = rows.map(r => r.map(csvCell).join(',')).join('\n');
      download(`torn-trade-notes-${dateStamp()}.csv`, csv, 'text/csv');
    });

    function mergeDB(current, incoming) {
      const out = JSON.parse(JSON.stringify(current || {}));
      out.players ||= {};
      const incPlayers = (incoming && incoming.players) || {};
      for (const [xid, recIn] of Object.entries(incPlayers)) {
        if (!out.players[xid]) out.players[xid] = {
          name:'', mark:false, notes:'', entries:[], stats:{count:0,buys:0,sells:0,firstISO:null,lastISO:null}
        };
        const dst = out.players[xid];
        if (recIn.name) dst.name = recIn.name;
        // merge notes (append if both non-empty and different)
        if (recIn.notes) {
          dst.notes = dst.notes && dst.notes !== recIn.notes ? `${dst.notes}\n---\n${recIn.notes}` : (dst.notes || recIn.notes);
        }
        dst.mark = dst.mark || !!recIn.mark;
        // merge entries (dedupe by iso+dir)
        const key = (it)=>`${it.iso}#${it.dir}`;
        const have = new Set((dst.entries||[]).map(key));
        for (const it of (recIn.entries || [])) {
          const k = key(it);
          if (!have.has(k)) {
            dst.entries.push({ iso: it.iso, dir: it.dir === 'sell' ? 'sell' : 'buy' });
            have.add(k);
          }
        }
        recomputeStats(dst);
      }
      return out;
    }

    card.querySelector('#ttn-import').addEventListener('click', () => {
      const text = prompt('Paste JSON exported from this tool. This will MERGE with your current data.');
      if (!text) return;
      try {
        const merged = mergeDB(loadDB(), JSON.parse(text));
        saveDB(merged);
        flash('Import successful. Reload page.');
      } catch (e) {
        warn('import error', e);
        alert('Invalid JSON.');
      }
    });
  }

  // ---------------- mount ----------------
  function isProfileCtx(){ return /profiles\.php/i.test(location.href) || !!document.querySelector('a[href*="profiles.php?XID="]'); }
  function mountOnce(){ if (!document.getElementById('ttn-card') && isProfileCtx()) buildCard(); }
  function start(){ mountOnce(); const obs = new MutationObserver(()=>mountOnce()); obs.observe(document.documentElement,{childList:true,subtree:true}); setInterval(mountOnce,1500); dbg('Initialized Manual v2.0.0'); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

})();
