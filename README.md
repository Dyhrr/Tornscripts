# 🧠 Torn Script Vault

This repository contains a personal collection of custom scripts for the browser game [Torn](https://www.torn.com).  
Each script is designed to enhance gameplay, improve UI/UX, automate minor tasks, or just reduce the grind.

Think of this repo as my Torn-enhancer toolbox: if it's annoying, slow, or ugly — I probably wrote a fix for it.

---

## ⚒️ What’s Inside

Each script in this repo is:
- Written in JavaScript (for use with Tampermonkey/Greasemonkey)
- Focused on **utility**, **performance**, and **simplicity**
- Created for my personal use but shared in case others find it helpful

Some scripts currently included:
- **Crimes 2.0 Helper**  
  Adds links to guides, quick-buy buttons, and chain counter to Crimes 2.0 interface.
- **Gym Trainer Helper**  
  Tracks gains and optionally calculates happy/jump thresholds.
- **Market Tracker**  
  Auto-refreshes and logs price changes for key items.
- *(More incoming, or stored in branches until ready)*

---

## 🔧 Installation

Use [Tampermonkey](https://www.tampermonkey.net/) or similar to install `.user.js` scripts manually.

1. Install Tampermonkey
2. Click on the raw `.user.js` file in this repo
3. Tampermonkey will prompt you to install

---

## 🤖 Optimization Requests

This repo is being reviewed and refined with **OpenAI Codex** to:
- Clean up redundant or outdated code
- Add quality-of-life features
- Improve performance or async behavior
- Simplify logic, reduce browser strain

---

## 🧠 Goals (with Codex)

- [ ] Reduce DOM polling where possible
- [ ] Add config UI panels to major scripts
- [ ] Auto-detect Torn layouts / dark mode variants
- [ ] Optimize for low RAM usage during long sessions

---

## 🛠 Codex Instructions

If you're Copilot/Codex:
- Assume all `.user.js` files are Greasemonkey/Tampermonkey scripts
- Prioritize non-blocking execution (defer/async behavior)
- Where possible, convert static selectors to dynamic detection
- Suggest modular improvements or shared utilities across scripts
