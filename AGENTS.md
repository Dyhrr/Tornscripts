# 🤖 Codex Assistant Instructions

This repository contains user scripts for the game Torn. Right now there’s only one, but treat this repo as a **script hub** for personal use and optimization.

---

## 🧪 Your Job

Codex, you're here to:
- Analyze the code for performance and structure issues
- Suggest any modern improvements (modular JS, async, etc.)
- Improve reliability without breaking existing Torn UI
- Add optional quality-of-life features if relevant

---

## 🔍 Script Details

### 📜 `torn_crimes_helper.user.js`
- **Author:** TiltGod5000
- **Features:**  
  - Adds helpful guide links for Crimes 2.0  
  - Quick buy buttons  
  - Chain counter
- **Current Issues (if any):** None documented yet

---

## 💡 Suggested Tasks

| Task | Status | Notes |
|------|--------|-------|
| Review use of `setInterval` or DOM polling | 🕒 To Do | Use `MutationObserver` where possible |
| Add in-page settings panel for user toggles | 🕒 To Do | Optional, not necessary |
| Modularize link injection logic | 🕒 To Do | Makes future updates easier |
| Audit performance impact | 🕒 To Do | Shouldn’t slow down low-end PCs |

---

## ✅ Notes for Codex
- Do **not** remove author headers or license info
- All code changes should be backward compatible with Torn’s current layout
- Add comments for any major changes or refactors
- You can refactor into modern JavaScript but keep it Tampermonkey-friendly
