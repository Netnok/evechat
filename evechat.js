// ==UserScript==
// @name         EveChat Mirror Overlay (Stable Init, Buttons-safe, Colored Debug)
// @namespace    http://tampermonkey.net/
// @version      2025.10.22-stable
// @description  안정화된 mirror: 진짜 입력창 준비되기 전엔 붙지 않음. 버튼 미가림. 색상 디버그(입력값/버튼상태/클릭/동기화).
// @match        https://www.eve-chat.com/chat*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ===== Debug palette =====
  const C = {
    boot:  'color:#00c2ff;font-weight:600',
    ok:    'color:#22c55e;font-weight:600',
    warn:  'color:#f97316;font-weight:600',
    err:   'color:#ef4444;font-weight:700',
    info:  'color:#a855f7;font-weight:600',
    value: 'color:#ff67b3;font-weight:700',
    click: 'color:#ff3b3b;font-weight:700',
    state: 'color:#f59e0b;font-weight:700',
    sync:  'color:#14b8a6;font-weight:600',
  };
  const slog = (style, ...a) => console.log('%c[EveChatMirror]', style, ...a);

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const state = {
    initting: false,
    ready: false,
    mirror: null,
    input: null,
    lastBox: { top: -1, left: -1, w: -1, h: -1, t: 0 },
  };

  // ===== Utils =====
  const isVisible = (el) => {
    if (!el || !el.isConnected) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const withinFooterBand = (rect, viewportH) => {
    // 입력창은 보통 하단 근처. 너무 위(top<20px)면 아직 자리 미정일 수 있음.
    return rect.bottom > viewportH * 0.4; // 화면 하단 60% 영역에 있으면 OK
  };

  const boxesDiffer = (a, b) =>
    Math.abs(a.top - b.top) > 1 ||
    Math.abs(a.left - b.left) > 1 ||
    Math.abs(a.w - b.w) > 1 ||
    Math.abs(a.h - b.h) > 1;

  // ===== 안정화된 textarea 찾기 =====
  async function waitForStableTextarea({ timeoutMs = 15000, stableMs = 500 } = {}) {
    const t0 = performance.now();
    let stableStart = 0;
    let lastRect = null;

    while (performance.now() - t0 < timeoutMs) {
      const ta = document.querySelector('div.relative.flex-1.group textarea[placeholder*="메세지를 입력해주세요"]')
             || document.querySelector('textarea[placeholder*="메세지를 입력해주세요"]');

      if (ta && isVisible(ta)) {
        const container = ta.closest('div.relative.flex-1.group') || ta.parentElement;
        const btnRow = container && container.querySelector('.absolute.right-2.top-1\\/2, .absolute.right-2'); // 우측 버튼 묶음 존재 확인
        const r = ta.getBoundingClientRect();

        const sizeOK = r.width >= 200 && r.height >= 40; // 너무 작은 스켈레톤/초기치 배제
        const bandOK = withinFooterBand(r, window.innerHeight);
        const btnOK  = !!btnRow;

        if (container && btnOK && sizeOK && bandOK) {
          if (!lastRect || boxesDiffer(lastRect, r)) {
            // 아직 흔들리는 중 → 타임스탬프 리셋
            stableStart = performance.now();
            lastRect = { top: r.top, left: r.left, w: r.width, h: r.height };
          } else {
            // 박스가 유지되는 중
            if (performance.now() - stableStart >= stableMs) {
              slog(C.ok, 'stable textarea detected:', {
                top: Math.round(r.top), left: Math.round(r.left),
                w: Math.round(r.width), h: Math.round(r.height)
              });
              return ta;
            }
          }
        }
      }
      await sleep(100);
    }
    return null;
  }

  // ===== 모바일 전송 버튼(같은 컨테이너 내) =====
  function findMobileSendButton(container) {
    const byTitle = container.querySelector('button[title*="전송"]');
    if (byTitle) return byTitle;
    const svg = container.querySelector('svg.lucide-send');
    if (svg) return svg.closest('button');
    return null;
  }

  // ===== 스타일/좌표 적용 (스로틀 + 변경 있을 때만 로그) =====
  let syncRAF = null;
  function applyStyleThrottled(mirror, input) {
    if (syncRAF) return;
    syncRAF = requestAnimationFrame(() => {
      syncRAF = null;
      const cs = getComputedStyle(input);
      const top = input.offsetTop;
      const left = input.offsetLeft;
      const w = input.offsetWidth;
      const h = input.offsetHeight;

      // 변화 감지(1px 이상)일 때만 로그
      const now = performance.now();
      const prev = state.lastBox;
      const changed = boxesDiffer(prev, { top, left, w, h });
      const throttleOK = now - prev.t > 300;

      mirror.style.position     = 'absolute';
      mirror.style.top          = `${top}px`;
      mirror.style.left         = `${left}px`;
      mirror.style.width        = `${w}px`;
      mirror.style.height       = `${h}px`;
      mirror.style.zIndex       = '1';

      mirror.style.boxSizing    = 'border-box';
      mirror.style.margin       = '0';
      mirror.style.padding      = cs.padding;
      mirror.style.border       = cs.border;
      mirror.style.borderRadius = cs.borderRadius;
      mirror.style.background   = cs.background;
      mirror.style.color        = cs.color;
      mirror.style.font         = cs.font;
      mirror.style.lineHeight   = cs.lineHeight;
      mirror.style.letterSpacing= cs.letterSpacing;
      mirror.style.textAlign    = cs.textAlign;
      mirror.style.caretColor   = cs.caretColor || cs.color;
      mirror.style.boxShadow    = cs.boxShadow;

      mirror.style.overflowY    = cs.overflowY || 'auto';
      mirror.style.resize       = 'none';
      mirror.style.pointerEvents= 'auto';

      if (changed && throttleOK) {
        state.lastBox = { top, left, w, h, t: now };
        slog(C.sync, 'sync: style/position updated', { top, left, w, h });
      }
    });
  }

  // ===== 미러 생성 (버튼 미가림: textarea 바로 뒤에 삽입) =====
  function createMirror(input) {
    const mirror = document.createElement('textarea');
    mirror.id = 'evechat-mirror-input';

    mirror.placeholder    = input.placeholder || '';
    mirror.autocapitalize = input.autocapitalize || 'none';
    mirror.autocorrect    = input.autocorrect || 'off';
    mirror.spellcheck     = input.spellcheck ?? false;
    mirror.rows           = input.rows || 1;
    mirror.setAttribute('autocomplete', input.getAttribute('autocomplete') || 'off');
    const inputmode = input.getAttribute('inputmode');
    if (inputmode) mirror.setAttribute('inputmode', inputmode);

    const container = input.closest('div.relative.flex-1.group') || input.parentElement;
    if (container) input.after(mirror);
    else (document.body || document.documentElement).appendChild(mirror);

    return mirror;
  }

  // ===== 입력 동기화 + 디버그 =====
  function bindInputSync(mirror, input) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;

    mirror.addEventListener('input', () => {
      setter.call(input, mirror.value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      slog(C.value, `input: "${mirror.value}"`);
    });

    input.addEventListener('input', () => {
      if (mirror.value !== input.value) {
        mirror.value = input.value;
        slog(C.info, 'mirror catch-up from input (site logic changed value).');
      }
    });
  }

  // ===== Enter 전송 + 클릭 로그 =====
  function bindEnterToSend(mirror, sendBtn) {
    if (!sendBtn) return;

    mirror.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (mirror.value && !sendBtn.disabled) {
          slog(C.click, 'send: Enter → click()');
          sendBtn.click();
        } else {
          slog(C.warn, 'send blocked: empty or button disabled');
        }
      }
    });

    sendBtn.addEventListener('click', () => {
      slog(C.click, 'send: button clicked');
    });
  }

  // ===== 전송 버튼 상태 감시 =====
  function observeSendState(sendBtn) {
    if (!sendBtn) return null;
    const report = () => {
      const disabled = !!sendBtn.disabled;
      slog(C.state, `send button state: ${disabled ? 'DISABLED' : 'ENABLED'}`);
    };
    report();
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'attributes' && (m.attributeName === 'disabled' || m.attributeName === 'class')) {
          report();
        }
      }
    });
    mo.observe(sendBtn, { attributes: true, attributeFilter: ['disabled', 'class'] });
    return mo;
  }

  // ===== 동기화 옵저버 =====
  function observeSync(mirror, input) {
    const ro = new ResizeObserver(() => applyStyleThrottled(mirror, input));
    ro.observe(input);

    const mo = new MutationObserver(() => applyStyleThrottled(mirror, input));
    mo.observe(input, { attributes: true, attributeFilter: ['style', 'class'] });

    window.addEventListener('resize', () => applyStyleThrottled(mirror, input), { passive: true });
    window.addEventListener('orientationchange', () => applyStyleThrottled(mirror, input), { passive: true });

    return { ro, mo };
  }

  // ===== 리렌더 교체 대응 (진짜 교체일 때만 재init) =====
  function observeReplacement(inputNode, mirrorNode) {
    const root = document.querySelector('#__next') || document.body;
    const mo = new MutationObserver(() => {
      const ta = document.querySelector('div.relative.flex-1.group textarea[placeholder*="메세지를 입력해주세요"]')
             || document.querySelector('textarea[placeholder*="메세지를 입력해주세요"]');
      // input 노드가 바뀌었고, 새 노드가 안정화 조건을 곧 만족할 때만 재init
      if (ta && ta !== inputNode) {
        slog(C.warn, 'textarea node replaced → re-init when stable');
        try { mirrorNode?.remove(); } catch {}
        state.ready = false;
        state.initting = false;
        bootOnce(); // 다시 부팅 루틴
      }
    });
    mo.observe(root, { childList: true, subtree: true });
    return mo;
  }

  async function init() {
    if (state.initting || state.ready) return;
    state.initting = true;

    const input = await waitForStableTextarea();
    if (!input) {
      state.initting = false;
      slog(C.err, 'stable textarea not found (timeout)');
      return;
    }

    const container = input.closest('div.relative.flex-1.group') || input.parentElement;
    const sendBtn = container ? findMobileSendButton(container) : null;

    const mirror = createMirror(input);
    state.mirror = mirror;
    state.input = input;
    state.lastBox = { top: -1, left: -1, w: -1, h: -1, t: 0 };

    applyStyleThrottled(mirror, input);
    bindInputSync(mirror, input);
    bindEnterToSend(mirror, sendBtn);
    observeSync(mirror, input);
    observeSendState(sendBtn);
    observeReplacement(input, mirror);

    // 포커스 보정
    input.addEventListener('focus', () => mirror.focus(), true);

    state.ready = true;
    state.initting = false;
    slog(C.ok, 'mirror ready (overlay absolute, buttons-safe, STABLE INIT)');
  }

  function bootOnce() {
    if (state.initting || state.ready) return;
    const root = document.querySelector('#__next') || document;
    const boot = new MutationObserver(async () => {
      const ta = document.querySelector('div.relative.flex-1.group textarea[placeholder*="메세지를 입력해주세요"]')
             || document.querySelector('textarea[placeholder*="메세지를 입력해주세요"]');
      if (ta && isVisible(ta) && !document.querySelector('#evechat-mirror-input')) {
        boot.disconnect();
        await sleep(150);
        init();
      }
    });
    boot.observe(root, { childList: true, subtree: true });
    slog(C.boot, 'boot: watching for real textarea…');
  }

  // start
  bootOnce();
})();
