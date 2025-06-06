# 🤖 Codex Agents: Torn Script Optimizer

This repo contains multiple standalone userscripts. Each script is written for Tampermonkey use on torn.com, and each can be treated as a separate optimization target.

---

## 🧠 Goals for Codex

Codex, your role is to assist in refactoring, optimizing, and enhancing each script in this repository. Focus areas include:

- ✅ **Performance**  
  - Remove unnecessary DOM polling  
  - Optimize `setInterval` and replace with `MutationObserver` where possible

- ✅ **Modularity**  
  - Suggest shared utilities for repetitive tasks (e.g., logging, UI injection)  
  - Split large monolithic functions into manageable parts

- ✅ **UI Enhancements**  
  - Add in-game toggles, settings menus, and collapsible panels  
  - Adapt to Torn’s light/dark modes

- ✅ **Quality of Life**  
  - Add error handling for missing elements  
  - Auto-detect state and react accordingly (e.g., auto-refresh, retry logic)

---

## 📜 Script Metadata

All scripts:
- Use `// ==UserScript==` headers
- Are triggered on Torn game subpages (e.g. `sid=crimes`, `sid=gym`, etc.)
- May contain embedded links to Torn guides or tools

---

## 🔍 Example Optimization Task

Script: `Torn Crimes 2.0 Helper`

| Task | Priority | Description |
|------|----------|-------------|
| Replace `setInterval` with `MutationObserver` | High | Reduce performance hit on low-end machines |
| Modularize guide link injection | Medium | Separate guide logic from DOM scanner |
| Add chain progress bar | Medium | Visual enhancement for ongoing chains |
| Config panel for guide style and button layout | Low | User customization |

---

## 📦 Notes

- Codex is allowed to rewrite scripts into module-based JS (ES6) if it improves reusability
- Do not remove MIT headers or author credits
- If multiple scripts perform similar tasks (e.g., price tracking), suggest merging functionality into one configurable module
