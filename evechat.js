// ==UserScript==
// @name         EveChat Mirror Stable
// @namespace    https://www.eve-chat.com/
// @version      2.0
// @description  Smart input mirroring for EveChat: monitors textarea activation, feedback lock, and conditional mirroring.
// @match        https://www.eve-chat.com/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function() {
  'use strict';
  console.groupCollapsed('%c[EveChatMirror] 초기화', 'color:#06f;font-weight:bold;');

  const inputSelector = 'textarea[placeholder*="메세지를 입력해주세요"]';
  const sendSelector = 'button[title*="전송"], button svg.lucide-send';
  let input = null, sendBtn = null, mirror = null, buffer = '', isMirrorActive = false;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  /** ✅ mirror textarea 생성 **/
  function createMirror(base) {
    if (mirror) return mirror;

    const ta = document.createElement('textarea');
    ta.id = 'evechat-mirror';
    ta.placeholder = 'EveChat Mirror (입력 후 전송버튼 클릭)';
    ta.style.position = 'fixed';
    ta.style.bottom = '10px';
    ta.style.left = '10px';
    ta.style.width = 'calc(100% - 20px)';
    ta.style.height = '70px';
    ta.style.zIndex = 99999;
    ta.style.background = 'rgba(0,0,0,0.75)';
    ta.style.color = 'white';
    ta.style.border = '1px solid #ff66cc';
    ta.style.borderRadius = '10px';
    ta.style.padding = '10px';
    ta.style.fontSize = '14px';
    ta.style.resize = 'none';
    ta.style.opacity = '0.9';
    ta.style.boxShadow = '0 0 10px rgba(255,105,180,0.3)';
    ta.spellcheck = false;
    document.body.appendChild(ta);

    ta.addEventListener('input', () => {
      buffer = ta.value;
      console.log('[EveChatMirror] mirror 입력:', buffer);
    });

    mirror = ta;
    return ta;
  }

  /** ✅ 전송 수행 **/
  function sendText() {
    if (!input || !buffer.trim()) {
      console.warn('[EveChatMirror] 전송불가: 입력창이 없거나 buffer가 비어있음.');
      return;
    }
    input.value = buffer;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    console.log('[EveChatMirror] 실제 입력창에 내용 주입 완료:', buffer);

    // 비활성 버튼 예외 처리
    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click();
      console.log('[EveChatMirror] 버튼 클릭 이벤트 전송');
    } else {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      console.log('[EveChatMirror] Enter 키 이벤트 전송 (대체 경로)');
    }

    buffer = '';
    mirror.value = '';
  }

  /** ✅ 상태 감시 루프 **/
  async function monitorState() {
    while (true) {
      await sleep(500);
      const newInput = document.querySelector(inputSelector);
      const newBtn = document.querySelector(sendSelector)?.closest('button');
      input = newInput;
      sendBtn = newBtn;

      if (!input) {
        console.warn('[EveChatMirror] 입력창 탐색 실패 (페이지 로딩 중이거나 비활성).');
        continue;
      }

      const active = !input.disabled && !sendBtn?.disabled;
      const classInfo = input.className.slice(0, 80) + (input.className.length > 80 ? '...' : '');
      console.log(`[EveChatMirror] 감시: 활성=${active}, input.class=${classInfo}`);

      // 입력창 활성화 → 미러링 시작
      if (active && !isMirrorActive) {
        createMirror(input);
        isMirrorActive = true;
        console.log('%c[EveChatMirror] ✅ 입력창 활성화 감지 → 미러링 시작', 'color:lime');
      }

      // 입력창 비활성화 → 미러링 일시중지
      if (!active && isMirrorActive) {
        isMirrorActive = false;
        if (mirror) mirror.value = '';
        console.log('%c[EveChatMirror] ⛔ 입력창 비활성화 감지 → 미러링 중단', 'color:orange');
      }

      // 전송 버튼 감시 (활성 상태에서만)
      if (sendBtn && isMirrorActive) {
        sendBtn.removeEventListener('click', sendText);
        sendBtn.addEventListener('click', sendText);
      }
    }
  }

  /** ✅ 초기 대기 및 시작 **/
  async function init() {
    console.log('[EveChatMirror] DOM 탐색 중...');
    while (!document.querySelector(inputSelector)) await sleep(500);
    console.log('[EveChatMirror] 입력창 탐색 성공.');
    monitorState();
    console.groupEnd();
  }

  init();
})();
