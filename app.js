(function () {
  "use strict";

  // Telegram.WebApp faqat Telegram ichida to'liq ishlaydi.
  // Tashqarida ochilganda skript yuklanmagan yoki initData bo'sh bo'lishi mumkin.
  var tg = (window.Telegram && window.Telegram.WebApp) || null;
  var insideTelegram = !!(tg && tg.initData);

  var greetingEl = document.getElementById("greeting");
  var envNoteEl = document.getElementById("env-note");
  var countEl = document.getElementById("count");
  var buttonEl = document.getElementById("counter-btn");

  // themeParams kalitlari -> CSS o'zgaruvchilari
  var THEME_MAP = {
    bg_color: "--bg",
    text_color: "--text",
    hint_color: "--hint",
    button_color: "--button",
    button_text_color: "--button-text",
    secondary_bg_color: "--secondary-bg"
  };

  function applyTheme() {
    if (!tg || !tg.themeParams) return;
    var root = document.documentElement.style;
    Object.keys(THEME_MAP).forEach(function (key) {
      var value = tg.themeParams[key];
      if (value) root.setProperty(THEME_MAP[key], value);
    });
  }

  function getUserName() {
    try {
      var user = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
      if (!user) return null;
      var name = [user.first_name, user.last_name].filter(Boolean).join(" ");
      return name || user.username || null;
    } catch (e) {
      return null;
    }
  }

  function init() {
    if (tg) {
      try {
        tg.ready();
        tg.expand();
      } catch (e) {
        // Telegram'dan tashqarida ba'zi metodlar ishlamasligi mumkin — e'tiborsiz qoldiramiz
      }
      applyTheme();
      if (typeof tg.onEvent === "function") {
        tg.onEvent("themeChanged", applyTheme);
      }
    }

    var name = getUserName();
    // textContent — ismdagi maxsus belgilar HTML sifatida talqin qilinmasligi uchun
    greetingEl.textContent = "Salom, " + (name || "mehmon") + "!";

    if (!insideTelegram) {
      envNoteEl.textContent = "Ilova Telegram'dan tashqarida ochildi.";
    }

    var count = 0;
    buttonEl.addEventListener("click", function () {
      count += 1;
      countEl.textContent = String(count);
      try {
        if (insideTelegram && tg.HapticFeedback) {
          tg.HapticFeedback.impactOccurred("light");
        }
      } catch (e) { /* ixtiyoriy */ }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
