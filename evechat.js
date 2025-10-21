// ==UserScript==
// @name         EveChat Mirror Overlay (Final Absolute Sync Version)
// @namespace    http://tampermonkey.net/
// @version      2025.10.22
// @description  완전 렉 제거용 EveChat 미러 입력창 (원본 비활성화 금지, 크기 및 스타일 자동 동기화)
// @match        https://www.eve-chat.com/chat*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  console.log('%c[EveChatMirror] Script loaded. Waiting for textarea...', 'color:#ff69b4;');

  async function waitForTextarea() {
    for (let i = 0; i < 60; i++) {
      const el = document.querySelector('textarea[placeholder*="메세지를 입력해주세요"]');
      if (el) return el;
      await sleep(500);
    }
    return null;
  }

  async function waitForSendButton() {
    for (let i = 0; i < 60; i++) {
      const btn = document.querySelector('button[title*="전송"], button svg.lucide-send');
      if (btn) return btn.closest('button') || btn;
      await sleep(500);
    }
    return null;
  }

  async function initMirror() {
    const input = await waitForTextarea();
    const sendBtn = await waitForSendButton();

    if (!input || !sendBtn) {
      console.error('[EveChatMirror] ❌ input or send button not found.');
      return;
    }

    console.log('%c[EveChatMirror] ✅ Textarea found. Initializing mirror...', 'color:limegreen;');

    // --- 미러 생성 ---
    const mirror = document.createElement('textarea');
    mirror.id = 'mirrorInput';
    mirror.placeholder = input.placeholder;
    mirror.autocapitalize = input.autocapitalize;
    mirror.autocorrect = input.autocorrect;
    mirror.spellcheck = input.spellcheck;
    mirror.rows = input.rows || 1;
    mirror.style.position = 'absolute';
    mirror.style.zIndex = '99999';
    mirror.style.resize = 'none';
    mirror.style.overflowY = 'auto';
    mirror.style.boxSizing = 'border-box';
    mirror.style.transition = 'none';
    mirror.style.border = 'none';
    mirror.style.outline = 'none';
    mirror.style.background = 'transparent'; // 배경은 초기 투명, 이후 동기화
    mirror.style.color = 'inherit';
    mirror.style.pointerEvents = 'auto';

    document.body.appendChild(mirror);

    // --- 원본과 스타일/위치/크기 동기화 ---
    const syncStyle = () => {
      const rect = input.getBoundingClientRect();
      const cs = getComputedStyle(input);

      mirror.style.top = `${rect.top + window.scrollY}px`;
      mirror.style.left = `${rect.left + window.scrollX}px`;
      mirror.style.width = `${rect.width}px`;
      mirror.style.height = `${rect.height}px`;

      mirror.style.fontSize = cs.fontSize;
      mirror.style.fontFamily = cs.fontFamily;
      mirror.style.lineHeight = cs.lineHeight;
      mirror.style.padding = cs.padding;
      mirror.style.borderRadius = cs.borderRadius;
      mirror.style.background = cs.background;
      mirror.style.color = cs.color;
      mirror.style.boxShadow = cs.boxShadow || 'none';
    };

    syncStyle();

    new ResizeObserver(syncStyle).observe(input);
    new MutationObserver(syncStyle).observe(input, { attributes: true, attributeFilter: ['style', 'class'] });
    window.addEventListener('scroll', syncStyle, true);
    window.addEventListener('resize', syncStyle, true);

    // --- 입력 이벤트 전달 ---
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    mirror.addEventListener('input', () => {
      setter.call(input, mirror.value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // --- 전송 버튼 클릭 시 ---
    sendBtn.addEventListener('click', () => {
      mirror.value = '';
      setter.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    console.log('%c[EveChatMirror] Mirror active and fully synced with textarea.', 'color:cyan;');
  }

  // --- React-safe 렌더 감시 ---
  const root = document.querySelector('#__next');
  const obs = new MutationObserver(async () => {
    const ta = document.querySelector('textarea[placeholder*="메세지를 입력해주세요"]');
    if (ta && !document.querySelector('#mirrorInput')) {
      obs.disconnect();
      await sleep(800); // 렌더 안정화 대기
      await initMirror();
    }
  });
  obs.observe(root || document, { childList: true, subtree: true });
})();
