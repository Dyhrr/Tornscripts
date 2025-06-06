// ==UserScript==
// @name         Torn Stock Lock
// @namespace    https://github.com/user/tornscripts
// @version      1.0
// @description  Prevents accidental selling of selected stocks by locking them.
// @author       Dyhr
// @license      MIT
// @match        https://www.torn.com/loader.php?sid=stocks*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const LOCK_KEY = 'tornStockLocks';
  const lockData = JSON.parse(localStorage.getItem(LOCK_KEY)) || {};

  const styles = `
    .stock-lock-btn {
      cursor: pointer;
      margin-right: 0.25rem;
      user-select: none;
    }
    .stock-locked {
      opacity: 0.5;
      pointer-events: none;
    }
  `;

  GM_addStyle(styles);

  function saveLocks() {
    localStorage.setItem(LOCK_KEY, JSON.stringify(lockData));
  }

  function updateRow(row, symbol) {
    const lockBtn = row.querySelector('.stock-lock-btn');
    const sellBtn = row.querySelector('button, a.button');
    if (!lockBtn || !sellBtn) return;
    if (lockData[symbol]) {
      lockBtn.textContent = '🔒';
      sellBtn.classList.add('stock-locked');
      sellBtn.title = 'This stock is locked. Unlock to sell.';
    } else {
      lockBtn.textContent = '🔓';
      sellBtn.classList.remove('stock-locked');
      sellBtn.title = '';
    }
  }

  function processRow(row) {
    const cells = row.querySelectorAll('td');
    if (!cells.length) return;
    const symbol = cells[0].textContent.trim();
    if (!symbol) return;
    if (row.dataset.lockProcessed) return;
    row.dataset.lockProcessed = 'true';

    const lockBtn = document.createElement('span');
    lockBtn.className = 'stock-lock-btn';
    lockBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      lockData[symbol] = !lockData[symbol];
      saveLocks();
      updateRow(row, symbol);
    });
    cells[0].prepend(lockBtn);

    const sellBtn = row.querySelector('button, a.button');
    if (sellBtn) {
      sellBtn.addEventListener(
        'click',
        (e) => {
          if (lockData[symbol]) {
            e.preventDefault();
            e.stopImmediatePropagation();
            alert('This stock is locked. Unlock to sell.');
          }
        },
        true
      );
    }

    updateRow(row, symbol);
  }

  function init() {
    document
      .querySelectorAll('table tbody tr')
      .forEach((row) => processRow(row));
  }

  const observer = new MutationObserver(() => init());
  observer.observe(document.body, { childList: true, subtree: true });

  init();
})();

