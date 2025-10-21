// ==UserScript==
// @name         EveChat Mobile Input Mirror
// @namespace    https://www.eve-chat.com/
// @version      1.3
// @description  Reduce input lag on EveChat mobile by using a mirror textarea and batching updates
// @author       사용자님
// @match        https://www.eve-chat.com/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  if (window.__EVECHAT_MIRROR_ACTIVE__) return;
  window.__EVECHAT_MIRROR_ACTIVE__ = true;

  const inputSelector = 'div.chat-input[contenteditable="true"]';
  const sendSelector = 'button.send-btn';
  let mirror = null, input = null, sendBtn = null, buffer = '';

  /** Utility: delay helper **/
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  /** Create the overlay mirror textarea **/
  function createMirror(target) {
    if (document.getElementById('evechat-mirror')) return document.getElementById('evechat-mirror');

    const rect = target.getBoundingClientRect();
    const ta = document.createElement('textarea');
    ta.id = 'evechat-mirror';
    ta.style.position = 'fixed';
    ta.style.left = `${rect.left + window.scrollX}px`;
    ta.style.top = `${rect.top + window.scrollY}px`;
    ta.style.width = `${rect.width}px`;
    ta.style.height = `${rect.height}px`;
    ta.style.zIndex = '999999';
    ta.style.fontSize = window.getComputedStyle(target).fontSize;
    ta.style.color = '#000';
    ta.style.background = '#fff';
    ta.style.border = '1px solid #ccc';
    ta.style.borderRadius = '6px';
    ta.style.boxSizing = 'border-box';
    ta.style.padding = window.getComputedStyle(target).padding;
    ta.style.resize = 'none';
    ta.style.opacity = '0.9';
    ta.style.lineHeight = window.getComputedStyle(target).lineHeight;
    ta.autocorrect = 'off';
    ta.autocomplete = 'off';
    ta.spellcheck = false;
    document.body.appendChild(ta);

    target.style.opacity = '0.3';
    target.setAttribute('data-mirror-disabled', 'true');
    return ta;
  }

  /** Send routine **/
  function sendText() {
    if (!buffer.trim()) return;
    input.textContent = buffer;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    buffer = '';
    mirror.value = '';
  }

  /** Main setup loop **/
  async function setup() {
    while (!document.querySelector(inputSelector) || !document.querySelector(sendSelector)) {
      await sleep(500);
    }

    input = document.querySelector(inputSelector);
    sendBtn = document.querySelector(sendSelector);
    mirror = createMirror(input);

    mirror.addEventListener('input', () => { buffer = mirror.value; });

    // 버튼 이벤트 후킹
    const triggerSend = (e) => {
      e.preventDefault();
      e.stopPropagation();
      sendText();
    };
    sendBtn.addEventListener('click', triggerSend, true);
    sendBtn.addEventListener('touchstart', triggerSend, true);

    console.log('[EveChat Mirror] initialized.');
  }

  setup();
})();