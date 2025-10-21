// ==UserScript==
// @name         EveChat Mobile Mirror (Plan B) — Buttons-Safe + Diagnostics
// @namespace    https://eve-chat.com/
// @match        https://www.eve-chat.com/chat*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  // ---------- helpers ----------
  const L = {
    ok: (...a) => console.log("%c[EveChatMirror]", "color:#16a34a;font-weight:700", ...a),
    info: (...a) => console.log("%c[EveChatMirror]", "color:#06b6d4;font-weight:700", ...a),
    warn: (...a) => console.log("%c[EveChatMirror]", "color:#f59e0b;font-weight:700", ...a),
    err: (...a) => console.log("%c[EveChatMirror]", "color:#ef4444;font-weight:700", ...a),
  };

  const GUTTER = 4; // px (요청대로 4px)
  let mirror, proxySend, lastRects, rafSync = null, stableReady = false;

  const q = (sel, root = document) => root.querySelector(sel);
  const qa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // Eve 입력영역 탐색 (모바일 구조)
  function findParts() {
    // 입력 래퍼: textarea를 감싸는 .relative.flex-1.group
    const inputWrapper = qa('div.relative.flex-1.group')
      .find(div => div.querySelector('textarea[placeholder*="메세지를 입력해주세요"]'));
    if (!inputWrapper) return {};

    const textarea = q('textarea[placeholder*="메세지를 입력해주세요"]', inputWrapper);

    // 모바일 버튼행: absolute + right-2 + top-1/2 + lg:hidden 을 모두 포함하는 div
    const btnRow = qa('div', inputWrapper).find(d => {
      const c = d.getAttribute('class') || '';
      return c.includes('absolute') && c.includes('right-2') && c.includes('top-1/2') && c.includes('lg:hidden');
    });

    // 전송 버튼: lucide-send svg를 품은 button
    const sendBtn = btnRow ? (q('button svg.lucide-send', btnRow)?.closest('button') || null) : null;

    return { inputWrapper, textarea, btnRow, sendBtn };
  }

  // rect 계산 & 버튼안전 폭 산출
  function computeRects({ textarea, btnRow }) {
    const iRect = textarea.getBoundingClientRect();
    const bRect = btnRow?.getBoundingClientRect?.() || { left: iRect.right };
    const rightEdge = Math.max(0, Math.min(bRect.left - GUTTER, iRect.right));
    const width = Math.max(0, Math.floor(rightEdge - iRect.left));
    return {
      input: iRect,
      btn: bRect,
      mirror: { top: iRect.top, left: iRect.left, width, height: iRect.height, rightEdge }
    };
  }

  // 안정화 체크: 연속 3프레임 내 위치 변화가 거의 없을 때만 ready 처리
  async function waitStableRects(parts) {
    const hist = [];
    return new Promise(resolve => {
      function tick() {
        const r = computeRects(parts).mirror;
        hist.push(r);
        if (hist.length >= 3) {
          const [a, b, c] = hist.slice(-3);
          const near = (x, y) => Math.abs(x - y) <= 1;
          if (
            near(a.top, b.top) && near(b.top, c.top) &&
            near(a.left, b.left) && near(b.left, c.left) &&
            near(a.width, b.width) && near(b.width, c.width) &&
            near(a.height, b.height) && near(b.height, c.height)
          ) return resolve();
        }
        requestAnimationFrame(tick);
      }
      tick();
    });
  }

  // 미러 생성
  function ensureMirror(parts) {
    if (mirror && mirror.isConnected) return mirror;

    mirror = document.createElement('textarea');
    mirror.setAttribute('data-ecm', 'mirror');
    mirror.autocapitalize = 'none';
    mirror.autocomplete = 'off';
    mirror.autocorrect = 'off';
    mirror.spellcheck = false;

    // 원본 텍스트스타일 일부 반영 (가독·느낌 유지)
    const cs = getComputedStyle(parts.textarea);
    Object.assign(mirror.style, {
      position: 'fixed', // rect 동기화를 위해 viewport 좌표 기준
      zIndex: '1',       // 버튼보다 아래, 하지만 터치 받게
      boxSizing: 'border-box',
      resize: 'none',
      borderRadius: cs.borderRadius,
      padding: cs.padding,
      font: cs.font,
      lineHeight: cs.lineHeight,
      color: cs.color,
      background: cs.backgroundColor,
      border: cs.border,
      outline: 'none',
      boxShadow: cs.boxShadow,
      // Eve 테마와 어울리게 placeholder 색상은 그대로 두고 빠른 전환
      transition: 'none',
    });

    mirror.style.paddingRight = '12px'
    // IME 대응: input/composition 로깅
    mirror.addEventListener('compositionstart', () => L.info('composition start'));
    mirror.addEventListener('compositionend',   () => L.info('composition end ->', `"${mirror.value}"`));
    mirror.addEventListener('input', () => L.info('mirror typing:', `"${mirror.value.slice(-10)}"`, 'len=', mirror.value.length));

    // 포커스 프록시: 원래 입력창 탭 → 미러에 포커스
    parts.textarea.addEventListener('pointerdown', () => {
      setTimeout(() => mirror.focus(), 0);
    }, { passive: true });

    document.body.appendChild(mirror);
    L.ok('mirror created.');
    return mirror;
  }

  // 전송 프록시 오버레이(원본이 disabled일 때만 pointer-events ON)
  function ensureProxySend(parts) {
    if (proxySend && proxySend.isConnected) return proxySend;

    proxySend = document.createElement('div');
    proxySend.setAttribute('data-ecm', 'proxy-send');
    Object.assign(proxySend.style, {
      position: 'fixed',
      zIndex: '9',           // 버튼(아래)보다 약간 위, 미러(1)보다 훨씬 위
      pointerEvents: 'none', // 기본은 OFF, disabled일 때만 ON
      background: 'transparent',
    });
    document.body.appendChild(proxySend);

    const tryCommitAndSend = async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      const text = mirror.value ?? '';
      if (!text.trim()) {
        L.warn('send proxy tapped but mirror empty.');
        return;
      }

      L.warn('send proxy tapped → Plan B commit start.');
      // 1) sentinel trick: 공백→텍스트로 전환하여 input 핸들러를 강제
      const t = parts.textarea;
      const setVal = (v) => {
        const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(t), 'value');
        desc?.set?.call(t, v);
        t.dispatchEvent(new Event('input', { bubbles: true }));
      };
      setVal(' ');
      setVal(text);

      // 2) (가능하면) 버튼 활성화 대기
      const ok = await waitFor(() => !parts.sendBtn.disabled, 600);
      if (!ok) {
        L.err('send button did not enable in time; clicking anyway.');
      } else {
        L.ok('send button enabled.');
      }

      // 3) 전송 클릭
      try { parts.sendBtn.click(); L.warn('original sendBtn.click()'); } catch (e) { L.err(e); }

      // 4) 미러 비우기(옵션)
      mirror.value = '';
    };

    // 터치/클릭 바인딩 (pointerdown이 가장 빠르게 잡힘)
    proxySend.addEventListener('pointerdown', tryCommitAndSend, { passive: false });
    proxySend.addEventListener('click', tryCommitAndSend, { passive: false });

    return proxySend;
  }

  function syncZ(parts) {
    // 버튼은 위, 미러는 아래
    if (parts.btnRow) parts.btnRow.style.zIndex = '8';
    if (parts.sendBtn) parts.sendBtn.style.zIndex = '8';
  }

  // rect 동기화(미러 위치/폭, 프록시 버튼 위치)
  function syncRects(parts) {
    const rects = computeRects(parts);
    lastRects = rects;

    // 미러 위치/크기
    if (mirror) {
      Object.assign(mirror.style, {
        top: rects.mirror.top + 'px',
        left: rects.mirror.left + 'px',
        width: rects.mirror.width + 'px',
        height: rects.mirror.height + 'px',
      });
    }

    // 전송 프록시 위치/활성화
    if (proxySend && parts.sendBtn) {
      const sRect = parts.sendBtn.getBoundingClientRect();
      Object.assign(proxySend.style, {
        top: sRect.top + 'px',
        left: sRect.left + 'px',
        width: sRect.width + 'px',
        height: sRect.height + 'px',
      });
      proxySend.style.pointerEvents = parts.sendBtn.disabled ? 'auto' : 'none';
      L.info('send button state:', parts.sendBtn.disabled ? 'DISABLED' : 'ENABLED');
    }

    // 진단
    L.ok('sync box', { top: rects.mirror.top, left: rects.mirror.left, w: rects.mirror.width, h: rects.mirror.height });
  }

  // 변화에 반응: 키보드/뷰포트/레이아웃 변경
  function armSync(parts) {
    const sync = () => {
      if (!document.body.contains(parts.textarea)) return;
      syncRects(parts);
    };
    const throttled = () => {
      if (rafSync) cancelAnimationFrame(rafSync);
      rafSync = requestAnimationFrame(sync);
    };

    window.addEventListener('resize', throttled);
    window.addEventListener('scroll', throttled, true);
    window.visualViewport && window.visualViewport.addEventListener('resize', throttled);
    window.visualViewport && window.visualViewport.addEventListener('scroll', throttled);

    const mo = new MutationObserver(throttled);
    mo.observe(parts.inputWrapper, { attributes: true, subtree: true, childList: true });
    mo.observe(parts.btnRow || parts.inputWrapper, { attributes: true, subtree: true, childList: true });
  }

  // 유틸: 조건 대기
  function waitFor(cond, ms = 800) {
    const t0 = performance.now();
    return new Promise(resolve => {
      function loop() {
        if (cond()) return resolve(true);
        if (performance.now() - t0 > ms) return resolve(false);
        requestAnimationFrame(loop);
      }
      loop();
    });
  }

  // ---------- boot ----------
  (async function boot() {
    L.warn('boot: watching for stable textarea…');
    const parts = await (async function waitParts() {
      while (true) {
        const p = findParts();
        if (p.inputWrapper && p.textarea && p.btnRow && p.sendBtn) return p;
        await new Promise(r => setTimeout(r, 60));
      }
    })();

    // z-index 정렬
    syncZ(parts);

    // 안정화 대기 후 시작
    await waitStableRects(parts);
    stableReady = true;

    ensureMirror(parts);
    ensureProxySend(parts);

    // 초기 동기화 + 웜업 로그
    syncRects(parts);
    L.warn('— Mobile Diagnostics —');
    const r = lastRects;
    const btnCenter = { x: r.btn.left + (parts.sendBtn.getBoundingClientRect().width / 2), y: r.btn.top + (parts.sendBtn.getBoundingClientRect().height / 2) };
    const elAtBtn = document.elementFromPoint(btnCenter.x, btnCenter.y);
    L.info('parent ok?', !!parts.inputWrapper, 'btnRow?', !!parts.btnRow);
    L.info('rects:', { mirror: r.mirror, input: r.input, btn: r.btn });
    L.info('z-index:', { mirror: mirror.style.zIndex || 'auto', btn: (parts.btnRow.style.zIndex || 'auto') });
    L.warn('overlap(mirror vs btnRow):', r.mirror.rightEdge > r.btn.left ? 'true' : 'false');
    L.info('elementFromPoint on btn center:', elAtBtn);

    // 변화 반영
    armSync(parts);

    L.ok('mirror ready (Plan B active; buttons-safe; gutter=2px)');
  })();
})();
