// ==UserScript==
// @name         EveChat Mobile 2
// @namespace    https://eve-chat.com/
// @version      0.7.1
// @description  모바일 렉 회피용: 미러 textarea에서 타이핑 → 전송 시 원본에 1회 커밋. 버튼 영역은 가리지 않음(4px 거리). 크기/색상/위치 자동 동기화 + 디버깅 로그.
// @match        https://www.eve-chat.com/chat*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  // ====== 스타일 상수 ======
  const GUTTER  = 4;   // 버튼 행(첫 버튼)과의 안전 거리 (사용자 요청: 4px)
  const PAD_FIX = 200;  // 우측 여백 보정(음수면 조금 더 넓혀 씀). 필요 없으면 0
  const LOG = {
    base: 'padding:2px 6px;border-radius:6px;font-weight:600;',
    boot: 'background:#111;color:#9cf;border:1px solid #39f;',
    good: 'background:#041;color:#8f8;border:1px solid #3c6;',
    warn: 'background:#220;color:#fd6;border:1px solid #c90;',
    bad : 'background:#200;color:#f88;border:1px solid #c33;',
    info: 'background:#002;color:#7af;border:1px solid #37f;',
    step: 'background:#013;color:#7ff;border:1px solid #0af;'
  };

  // ====== 셀렉터 ======
  const TEXTAREA_Q  = 'textarea[placeholder*="메세지를 입력해주세요"]';
  const BTN_ROW_Q   = 'div.absolute.right-2.top-1\\/2'; // 모바일 버튼 3개 묶음 컨테이너
  const SEND_SVG_Q  = 'svg.lucide-send';
  // send button은 BTN_ROW 내에서 SEND_SVG_Q의 closest('button')

  // ====== 상태 ======
  let mirror, origTextarea, btnRow, sendBtn;
  let syncing = false;
  let lastRects = null;

  // ====== 부속 유틸 ======
  const log = (tag, style, ...args) =>
    console.log(`%c[EveChatMirror] ${tag}`, `${LOG.base};${style}`, ...args);

  function findCoreElements() {
    const ta = document.querySelector(TEXTAREA_Q);
    const row = document.querySelector(BTN_ROW_Q);
    const svg = row?.querySelector(SEND_SVG_Q);
    const btn = svg?.closest('button') || null;

    return { ta, row, btn };
  }

  function buildMirror() {
    if (mirror && mirror.isConnected) return mirror;
    mirror = document.createElement('textarea');
    mirror.id = 'ec-mirror-input';
    mirror.setAttribute('placeholder', '메세지를 입력해주세요');
    mirror.setAttribute('rows', '1');
    mirror.style.cssText = [
      'position:absolute',
      'z-index:1',              // 버튼은 z-index:2로 올려 버튼 클릭 가능
      'resize:none',
      'outline:none',
      'border:none',
      'background:transparent',
      'color:inherit',
      'font:inherit',
      'line-height:inherit',
      'letter-spacing:inherit',
      'padding:inherit',
      'margin:0',
      'overflow:auto',
      'box-sizing:border-box',
      'opacity:1',
      'transition:none',
      'caret-color:inherit'
    ].join(';');

    // 입력 이벤트 → 원본에 실시간 반영 NO. (Plan B)
    mirror.addEventListener('input', () => {
      log('typing', LOG.step, `"${mirror.value}"`);
      syncSendStateHint(); // 시각적 힌트만 갱신
      autosizeMirror();
    });

    // Enter(한줄 입력) → 기본은 줄바꿈. Shift+Enter 줄바꿈 유지.
    // 별도 전송키 강제하지 않음(모바일 IME 고려).
    mirror.addEventListener('keydown', (e) => {
      // 필요시 커스텀 전송 단축키 넣고 싶으면 여기서 처리
    });

    return mirror;
  }

  function ensureButtonsClickable() {
    if (!btnRow) return;
    // 버튼 묶음이 mirror 위에 보이도록
    btnRow.style.position = 'absolute'; // 이미 absolute이지만 확실히 고정
    btnRow.style.zIndex = '2';
    // 버튼 자신들도 포인터 허용
    btnRow.style.pointerEvents = 'auto';
  }

  function getFirstButtonLeft(rectRow) {
    // 실제로는 DOM에서 첫 버튼의 left를 계산
    const firstBtn = btnRow?.querySelector('button');
    if (!firstBtn) return rectRow.left + rectRow.width; // fallback
    return firstBtn.getBoundingClientRect().left;
  }

  // ---- 중요: 손본 computeRects ----
  function computeRects({ textarea, btnRow }) {
    const iRect = textarea.getBoundingClientRect();

    // 첫 번째 버튼의 left 사용
    let firstBtnRect = null;
    if (btnRow) {
      const firstBtn = btnRow.querySelector('button');
      if (firstBtn) {
        firstBtnRect = firstBtn.getBoundingClientRect();
      }
    }
    const btnLeft = firstBtnRect ? firstBtnRect.left : iRect.right;

    // textarea style 얻어서 참고(디자인 동기화에 활용 가능)
    const cs = getComputedStyle(textarea);
    const padRight = parseFloat(cs.paddingRight) || 0;

    // 오른쪽 경계 계산: 버튼 시작점 - GUTTER + PAD_FIX
    const desiredRight = btnLeft - GUTTER + PAD_FIX;
    const hardRight = iRect.right;
    const rightEdge = Math.max(0, Math.min(desiredRight, hardRight));
    const width = Math.max(0, Math.floor(rightEdge - iRect.left));

    const bRect = firstBtnRect || { left: iRect.right, top: iRect.top, height: iRect.height };

    log('computeRects', LOG.info, {
      iRect: { left: iRect.left, right: iRect.right, w: iRect.width, h: iRect.height },
      firstBtnLeft: btnLeft, GUTTER, PAD_FIX, padRight,
      rightEdge, width
    });

    return {
      input: iRect,
      btn: bRect,
      mirror: { top: iRect.top, left: iRect.left, width, height: iRect.height, rightEdge }
    };
  }

  function applyMirrorStyle(rects) {
    const { input, mirror: m } = rects;

    // mirror 박스 위치/크기
    mirror.style.top    = `${m.top + window.scrollY}px`;
    mirror.style.left   = `${m.left + window.scrollX}px`;
    mirror.style.width  = `${m.width}px`;
    mirror.style.height = `${m.height}px`;

    // 원본 textarea의 타이포·색상 계승
    const cs = getComputedStyle(origTextarea);
    mirror.style.color         = cs.color;
    mirror.style.font          = cs.font;
    mirror.style.lineHeight    = cs.lineHeight;
    mirror.style.letterSpacing = cs.letterSpacing;
    mirror.style.padding       = cs.padding;
    mirror.style.borderRadius  = cs.borderRadius;
    mirror.style.caretColor    = cs.caretColor || cs.color;

    // 원본은 그대로 보이지만 포커스는 mirror에
    if (document.activeElement === origTextarea) mirror.focus();

    log('sync', LOG.step, 'style/position updated', {
      top: m.top, left: m.left, w: m.width, h: m.height
    });
  }

  function autosizeMirror() {
    // 간단한 오토사이즈(한도는 원본 height 내에서)
    const cs = getComputedStyle(origTextarea);
    const lineH = parseFloat(cs.lineHeight) || 20;
    const maxH  = parseFloat(cs.maxHeight || '200') || 200;
    mirror.style.height = 'auto';
    const needed = Math.min(maxH, mirror.scrollHeight);
    mirror.style.height = `${Math.max(needed, parseFloat(cs.minHeight) || 56)}px`;
  }

  function isSendEnabled() {
    // send 버튼 disabled 속성 또는 cursor-not-allowed/opacity-40 등 클래스로 판단
    if (!sendBtn) return false;
    if (sendBtn.disabled) return false;
    const cs = getComputedStyle(sendBtn);
    // 시각적 비활성: opacity 낮거나 pointer-events none?
    if (parseFloat(cs.opacity) < 0.9) return false;
    return true;
  }

  function syncSendStateHint() {
    // 디버깅용: 전송 버튼 상태/미러 값 길이 보여줌
    log('state', isSendEnabled() ? LOG.good : LOG.warn, `send button: ${isSendEnabled() ? 'ENABLED' : 'DISABLED'} | mirror.length=${mirror.value.length}`);
  }

  // ---- Plan B: 전송 시 한 번에 커밋 ----
  async function commitToSiteAndSend() {
    if (!origTextarea || !sendBtn) return;
    const text = mirror.value.trim();
    if (!text) {
      log('commit', LOG.warn, 'mirror is empty. Abort.');
      return;
    }

    // 1) 원본 textarea에 값 주입 + input 이벤트 디스패치(사이트 내부 검증 통과)
    origTextarea.value = text;
    origTextarea.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
    log('commit', LOG.step, 'orig textarea injected via input event');

    await microDelay(20);

    // 2) 전송 버튼 활성화 체크 후 클릭
    if (!isSendEnabled()) {
      // 일부 사이트는 추가 tick 필요
      log('commit', LOG.warn, 'send disabled after inject → wait 80ms');
      await microDelay(80);
    }

    if (isSendEnabled()) {
      sendBtn.click();
      log('send', LOG.good, 'clicked original SEND button');
    } else {
      log('send', LOG.bad, 'SEND still disabled. Abort for safety.');
      return;
    }

    // 3) 사이트가 입력창 해제·재활성화할 때까지 mirror 잠시 잠금
    mirror.readOnly = true;
    mirror.style.opacity = '0.8';
    log('post', LOG.info, 'waiting site feedback… mirror locked');

    // 4) 재활성 감지(원본 textarea가 다시 “편집 가능” 상태로 돌아오면 mirror도 해제)
    await waitUntil(() => {
      // 지연 후 다시 활성화되는 조건: send 버튼이 disable 되었고 다시 enable 되거나,
      // textarea가 다시 값 입력 가능(readonly/disabled 아님)
      const taDisabled = origTextarea.disabled || origTextarea.readOnly;
      const btnAble = isSendEnabled(); // 다음 입력 가능한 상태로 돌았는지는 서비스 정책마다 다름
      // 여기서는 "원본이 입력 가능(=disabled/readonly 아님)"을 기준으로 삼음
      return !taDisabled;
    }, 8000).catch(() => {});

    // 5) 초기화
    mirror.value = '';
    mirror.readOnly = false;
    mirror.style.opacity = '1';
    origTextarea.value = ''; // 사이트가 자체적으로 비우는 경우도 있지만 안전하게 동기화
    origTextarea.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
    syncSendStateHint();
    autosizeMirror();

    log('post', LOG.good, 'site seems ready for next input. mirror unlocked.');
  }

  function installOverlayUI() {
    // 오버레이 textarea 추가
    document.body.appendChild(mirror);

    // 버튼은 클릭 가능해야 하므로 버튼 묶음 z-index ↑
    ensureButtonsClickable();

    // 전송 버튼 위에 “미러 전송 트리거(보이지 않는 히트 영역)”를 얹어
    // 사용자가 원래 버튼을 터치하면 → 우리가 가로채서 commit + 원본 버튼 클릭
    // (pointer-events: none 을 쓰지 않고, 캡처 단계에서 한 번 먹고 끝)
    sendBtn.addEventListener('click', onSendIntercept, { capture: true });
  }

  function onSendIntercept(e) {
    // 사용자가 원래 전송 버튼을 눌렀을 때 가로채서 Plan B 실행
    e.stopPropagation();
    e.preventDefault();
    log('ui', LOG.step, 'SEND tapped → Plan B commit');
    commitToSiteAndSend();
  }

  // ====== 동기화 루프 ======
  function syncLoop() {
    if (!origTextarea) return;
    const rects = computeRects({ textarea: origTextarea, btnRow });
    lastRects = rects;
    applyMirrorStyle(rects);
    autosizeMirror();
  }

  // 레이아웃 변화(리사이즈/스크롤/DOM 변경)에 반응
  function installSyncers() {
    const onTick = () => {
      if (syncing) return;
      syncing = true;
      requestAnimationFrame(() => {
        try { syncLoop(); } finally { syncing = false; }
      });
    };

    window.addEventListener('resize', onTick, { passive: true });
    window.addEventListener('scroll',  onTick, { passive: true });

    const mo = new MutationObserver(onTick);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true });

    // 주기적 보정(모바일 소프트키보드/IME 변화)
    setInterval(onTick, 400);

    // 초기 1회
    onTick();
  }

  // ====== 대기/헬퍼 ======
  function microDelay(ms) { return new Promise(res => setTimeout(res, ms)); }

  function waitForStableTextarea(timeout=10000) {
    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      const iv = setInterval(() => {
        const { ta, row, btn } = findCoreElements();
        if (ta && row && btn) {
          // 한 번 더 확인: textarea가 화면 하단 고정 UI로 렌더 완료됐는지(높이/너비 0 아님)
          const r = ta.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            clearInterval(iv);
            resolve({ ta, row, btn });
          }
        }
        if (performance.now() - t0 > timeout) {
          clearInterval(iv);
          reject(new Error('timeout: stable textarea not found'));
        }
      }, 120);
    });
  }

  async function waitUntil(pred, timeout=5000, step=120) {
    const t0 = performance.now();
    while (performance.now() - t0 < timeout) {
      try {
        if (pred()) return true;
      } catch {}
      await microDelay(step);
    }
    throw new Error('waitUntil timeout');
  }

  // ====== 부팅 ======
  (async function boot() {
    log('boot', LOG.boot, 'watching for stable textarea…');

    try {
      const found = await waitForStableTextarea(15000);
      origTextarea = found.ta;
      btnRow       = found.row;
      sendBtn      = found.btn;

      log('found', LOG.good, {
        textarea: '<textarea…>',
        btnRow: true,
        sendBtn: true
      });

      buildMirror();
      installOverlayUI();
      installSyncers();

      log('ready', LOG.good, 'mirror ready (Plan B, buttons-safe, 4px gutter)');
      syncSendStateHint();
    } catch (err) {
      log('boot-fail', LOG.bad, err.message || err);
    }
  })();
})();
