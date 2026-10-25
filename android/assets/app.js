(() => {
  'use strict';

  const bridge = window.whale || null;

  function callNative(name, fallback, ...args) {
    if (bridge && typeof bridge[name] === 'function') {
      try { return bridge[name](...args); } catch (e) { /* fall through */ }
    }
    return typeof fallback === 'function' ? fallback(...args) : fallback;
  }

  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => Array.prototype.slice.call(document.querySelectorAll(sel));

  const PREF_KEY = 'whalego.prefs';
  const PREVIEW_A11Y_OFF = /[?&]a11y=off(?:&|$)/.test(location.search);
  const MODES = ['default', 'white', 'black', 'system', 'off'];
  const ASSET_VERSION = '3';
  const FALLBACK_WALL = {
    id: '00',
    src: 'w00.jpg',
    thumb: 't00.jpg',
    source: 'default'
  };

  function assetUrl(path, retry) {
    if (!path) return '';
    const sep = path.indexOf('?') >= 0 ? '&' : '?';
    return path + sep + 'v=' + ASSET_VERSION + (retry ? '&r=' + retry : '');
  }

  const listed = Array.isArray(window.WALLPAPERS) ? window.WALLPAPERS : [];
  const WALLS = listed.length ? listed.slice() : [FALLBACK_WALL];
  if (!WALLS.some((w) => w && w.id === '00')) WALLS.unshift(FALLBACK_WALL);
  const WALL_BY_ID = new Map();
  WALLS.forEach((w) => { if (w && w.id && !WALL_BY_ID.has(w.id)) WALL_BY_ID.set(w.id, w); });

  const splash = $('splash');
  const wallBlur = $('wallBlur');
  const wallA = $('wallA');
  const wallB = $('wallB');
  const pages = $('pages');
  const settingsPage = $('settings');
  const homePage = $('home');
  const startBtn = $('start');
  const tailBadge = $('tailBadge');
  const navHome = $('navHome');
  const navSettings = $('navSettings');
  const sheet = $('sheet');
  const sheetBackdrop = $('sheetBackdrop');
  const wallGrid = $('wallGrid');
  const modeButtons = $$('.mode');
  const dialog = $('a11yDialog');
  const dialogBackdrop = $('dialogBackdrop');
  const goBtn = $('go');
  const leaveBtn = $('leave');
  const toastEl = $('toast');

  const state = {
    page: 'home',
    sheet: false,
    dialog: false,
    loading: false,
    slot: 0,
    systemDark: false
  };

  let prefs = loadPrefs();
  let drag = null;
  let wallToken = 0;
  let paletteToken = 0;
  let toastTimer = 0;
  let syncing = false;
  let lastSyncTarget = 1;
  let syncTimer = 0;

  /* ---------- prefs ---------- */

  function loadPrefs() {
    let raw = {};
    const stored = callNative('getPrefs', () => {
      try { return localStorage.getItem(PREF_KEY) || ''; } catch (e) { return ''; }
    });
    try { raw = JSON.parse(stored || '{}') || {}; } catch (e) { raw = {}; }
    const wallpaper = WALL_BY_ID.has(raw.wallpaper) ? raw.wallpaper : '00';
    const bg = MODES.indexOf(raw.bg) >= 0 ? raw.bg : 'default';
    return { wallpaper, bg };
  }

  function savePrefs() {
    const raw = JSON.stringify(prefs);
    callNative('savePrefs', (text) => {
      try { localStorage.setItem(PREF_KEY, text); } catch (e) { /* ignore */ }
    }, raw);
  }

  function currentWallpaper() {
    return WALL_BY_ID.get(prefs.wallpaper) || WALL_BY_ID.get('00') || FALLBACK_WALL;
  }

  /* ---------- toast ---------- */

  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), 2100);
  }

  /* ---------- theme ---------- */

  function isDark() {
    return prefs.bg === 'black' || (prefs.bg === 'system' && state.systemDark);
  }

  function applyTheme() {
    const dark = isDark();
    document.body.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    document.body.dataset.bg = prefs.bg;
    callNative('setBarsDark', null, dark);
  }

  function syncModeButtons() {
    modeButtons.forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.mode === prefs.bg));
    });
  }

  function setBg(mode) {
    prefs.bg = MODES.indexOf(mode) >= 0 ? mode : 'default';
    applyTheme();
    syncModeButtons();
    samplePalette();
    savePrefs();
  }

  /* ---------- wallpaper ---------- */

  function applyWallMeta(wp) {
    document.body.dataset.wall = wp && wp.id ? wp.id : '00';
    if (wallBlur) {
      wallBlur.src = assetUrl(wp.src);
      wallBlur.classList.toggle('is-on', wp.id === '00');
    }
  }

  function initWallpaper() {
    const wp = currentWallpaper();
    applyWallMeta(wp);
    wallA.onload = null;
    wallB.onload = null;
    wallA.onerror = () => {
      noteImageError(wallA.getAttribute('src'));
      if (wallA.dataset.retried) return;
      wallA.dataset.retried = '1';
      wallA.src = assetUrl(wp.src, '1');
    };
    wallA.dataset.base = wp.src;
    wallA.src = assetUrl(wp.src);
    wallA.classList.add('is-on');
    wallB.classList.remove('is-on');
    wallB.removeAttribute('src');
    state.slot = 0;
  }

  function showWallpaper(id, animate) {
    const wp = WALL_BY_ID.get(id) || WALL_BY_ID.get('00');
    if (!wp) return;
    prefs.wallpaper = wp.id;
    applyWallMeta(wp);

    const activeIsA = state.slot === 0;
    const incoming = activeIsA ? wallB : wallA;
    const outgoing = activeIsA ? wallA : wallB;

    if (!animate) {
      outgoing.classList.remove('is-on');
      incoming.classList.remove('is-on');
      incoming.src = assetUrl(wp.src);
      incoming.classList.add('is-on');
      state.slot = activeIsA ? 1 : 0;
      return;
    }

    const token = ++wallToken;
    const finish = () => {
      if (token !== wallToken) return;
      incoming.classList.add('is-on');
      outgoing.classList.remove('is-on');
      state.slot = activeIsA ? 1 : 0;
      setTimeout(samplePalette, 520);
    };

    incoming.onload = finish;
    incoming.onerror = () => {
      if (token !== wallToken) return;
      noteImageError(incoming.getAttribute('src'));
      if (!incoming.dataset.retried) {
        incoming.dataset.retried = '1';
        incoming.src = assetUrl(wp.src, '1');
        return;
      }
      incoming.classList.remove('is-on');
    };
    incoming.dataset.retried = '';

    if (incoming.dataset.base === wp.src && incoming.complete && incoming.naturalWidth) {
      requestAnimationFrame(finish);
      return;
    }
    incoming.dataset.base = wp.src;
    incoming.classList.remove('is-on');
    incoming.src = assetUrl(wp.src);
    if (incoming.complete && incoming.naturalWidth) requestAnimationFrame(finish);
  }

  function chooseWallpaper(id) {
    if (!WALL_BY_ID.has(id)) return;
    showWallpaper(id, true);
    updateCells();
    savePrefs();
  }

  function updateCells() {
    const cells = wallGrid.querySelectorAll('.wall');
    Array.prototype.forEach.call(cells, (cell) => {
      cell.setAttribute('aria-pressed', String(cell.dataset.id === prefs.wallpaper));
    });
  }

  function renderWallGrid() {
    const frag = document.createDocumentFragment();
    WALLS.forEach((wp, index) => {
      if (!wp || !wp.id) return;
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'wall';
      cell.dataset.id = wp.id;
      cell.setAttribute('aria-pressed', String(wp.id === prefs.wallpaper));
      cell.setAttribute('aria-label', '壁纸 ' + (index + 1));
      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.loading = 'lazy';
      img.draggable = false;
      const base = wp.thumb || wp.src;
      img.onerror = () => {
        noteImageError(img.getAttribute('src'));
        if (img.dataset.retried) return;
        img.dataset.retried = '1';
        img.src = assetUrl(base, '1');
      };
      img.src = assetUrl(base);
      cell.appendChild(img);
      frag.appendChild(cell);
    });
    while (wallGrid.firstChild) wallGrid.removeChild(wallGrid.firstChild);
    wallGrid.appendChild(frag);
  }

  /* ---------- adaptive palette ---------- */

  function luminance(rgb) {
    const channel = rgb.map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * channel[0] + 0.7152 * channel[1] + 0.0722 * channel[2];
  }

  function veilColor() {
    if (prefs.bg === 'off') return [0, 0, 0, 0];
    if (prefs.bg === 'black') return [10, 13, 18, 0.34];
    if (prefs.bg === 'white') return [255, 255, 255, 0.3];
    if (prefs.bg === 'system') {
      return isDark() ? [10, 13, 18, 0.34] : [255, 255, 255, 0.3];
    }
    return [232, 240, 255, 0.13];
  }

  function blend(rgb, veil) {
    const a = veil[3];
    return rgb.map((v, i) => Math.round(v * (1 - a) + veil[i] * a));
  }

  const CLEAR_PROPS = ['--btn-bg', '--btn-fg', '--nav-ink', '--label-ink', '--author-ink',
    '--bar-bg', '--bar-fill', '--wall-top', '--wall-bottom'];

  function toHex(rgb) {
    return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v)))
      .toString(16).padStart(2, '0')).join('');
  }

  function clearPalette() {
    CLEAR_PROPS.forEach((prop) => document.body.style.removeProperty(prop));
  }

  function paintPalette(img) {
    const W = 64;
    const H = 140;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;

    const scale = Math.max(W / iw, H / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);

    const veil = veilColor();
    const rawSample = (fx, fy) => {
      const x = Math.min(W - 1, Math.max(0, Math.round(fx * (W - 1))));
      const y = Math.min(H - 1, Math.max(0, Math.round(fy * (H - 1))));
      const d = ctx.getImageData(x, y, 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    const sample = (fx, fy) => blend(rawSample(fx, fy), veil);

    const button = sample(0.87, 0.86);
    const navLeft = sample(0.42, 0.966);
    const navRight = sample(0.58, 0.966);
    const nav = [
      (navLeft[0] + navRight[0]) / 2,
      (navLeft[1] + navRight[1]) / 2,
      (navLeft[2] + navRight[2]) / 2
    ];
    const study = sample(0.10, 0.972);
    const author = sample(0.5, 0.946);
    const bar = sample(0.5, 0.995);

    const buttonL = luminance(button);
    let btnBg = '#FFFFFF';
    let btnFg = '#4D6BFE';
    if (buttonL > 0.82) {
      btnBg = '#0A0D12';
      btnFg = '#FFFFFF';
    } else if (buttonL > 0.6) {
      btnBg = '#4D6BFE';
      btnFg = '#FFFFFF';
    } else if (buttonL <= 0.28) {
      btnBg = '#FFFFFF';
      btnFg = '#15243B';
    }

    const navInk = luminance(nav) > 0.55 ? 'rgba(21, 36, 59, .68)' : 'rgba(255, 255, 255, .74)';
    const labelInk = luminance(study) > 0.55 ? 'rgba(21, 36, 59, .72)' : 'rgba(255, 255, 255, .76)';
    const authorInk = luminance(author) > 0.55 ? 'rgba(21, 36, 59, .72)' : 'rgba(255, 255, 255, .80)';
    const barLight = luminance(bar) > 0.58;

    document.body.style.setProperty('--btn-bg', btnBg);
    document.body.style.setProperty('--btn-fg', btnFg);
    document.body.style.setProperty('--nav-ink', navInk);
    document.body.style.setProperty('--label-ink', labelInk);
    document.body.style.setProperty('--author-ink', authorInk);
    document.body.style.setProperty('--bar-bg', barLight ? 'rgba(21, 36, 59, .16)' : 'rgba(255, 255, 255, .24)');
    document.body.style.setProperty('--bar-fill', barLight ? '#4D6BFE' : '#F5F8FF');
    // 默认壁纸用 contain 完整显示，上下留白用原图上下边缘的颜色填充
    document.body.style.setProperty('--wall-top', toHex(rawSample(0.5, 0.004)));
    document.body.style.setProperty('--wall-bottom', toHex(rawSample(0.5, 0.996)));
  }

  function samplePalette() {
    const wp = currentWallpaper();
    if (!wp) return;
    const token = ++paletteToken;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (token !== paletteToken) return;
      try {
        paintPalette(img);
      } catch (e) {
        clearPalette();
      }
    };
    img.onerror = () => { if (token === paletteToken) clearPalette(); };
    img.src = assetUrl(wp.src);
  }

  /* ---------- page track ---------- */

  function pageOffset(name) {
    return name === 'settings' ? 0 : -window.innerWidth;
  }

  function applyPage(name, animate) {
    const target = name === 'settings' ? 'settings' : 'home';
    state.page = target;
    document.body.dataset.page = target;
    settingsPage.setAttribute('aria-hidden', target === 'settings' ? 'false' : 'true');
    homePage.setAttribute('aria-hidden', target === 'home' ? 'false' : 'true');
    navHome.setAttribute('aria-current', target === 'home' ? 'page' : 'false');
    navSettings.setAttribute('aria-current', target === 'settings' ? 'page' : 'false');

    if (!animate) pages.classList.add('no-anim');
    pages.style.transform = 'translate3d(' + pageOffset(target) + 'px, 0, 0)';
    if (!animate) {
      void pages.offsetWidth;
      pages.classList.remove('no-anim');
    }
  }

  function goPage(name) {
    if (state.page === name && !drag) return;
    pages.classList.remove('dragging');
    void pages.offsetWidth;
    applyPage(name, true);
  }

  function resetTrack() {
    pages.classList.remove('dragging');
    pages.style.transform = 'translate3d(' + pageOffset(state.page) + 'px, 0, 0)';
  }

  function onPointerDown(e) {
    if (state.sheet || state.dialog || state.loading) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('button, #sheet, #a11yDialog, #wallGrid, #nav')) return;
    drag = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      dx: 0,
      axis: null,
      t: performance.now()
    };
    pages.classList.add('dragging');
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;

    if (!drag.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dy) >= Math.abs(dx)) {
        drag = null;
        resetTrack();
        return;
      }
      drag.axis = 'x';
    }

    let move = dx;
    if (state.page === 'home' && move < 0) move *= 0.22;
    if (state.page === 'settings' && move > 0) move *= 0.22;
    drag.dx = move;
    pages.style.transform = 'translate3d(' + (pageOffset(state.page) + move) + 'px, 0, 0)';
  }

  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;

    if (d.axis !== 'x') {
      resetTrack();
      return;
    }

    const dt = Math.max(1, performance.now() - d.t);
    const velocity = d.dx / dt;
    const threshold = window.innerWidth * 0.22;
    let target = state.page;
    if (state.page === 'home' && (d.dx > threshold || velocity > 0.4)) target = 'settings';
    if (state.page === 'settings' && (d.dx < -threshold || velocity < -0.4)) target = 'home';

    if (target === state.page) resetTrack();
    else goPage(target);
  }

  function onPointerCancel() {
    if (!drag) return;
    drag = null;
    resetTrack();
  }

  /* ---------- loading ---------- */

  function playLoading() {
    if (state.loading || state.dialog) return;
    state.loading = true;
    startBtn.classList.add('is-out');
    startBtn.setAttribute('aria-disabled', 'true');

    setTimeout(() => {
      if (!state.loading) return;
      tailBadge.classList.add('is-on');
      document.body.classList.add('is-loading');
    }, 170);

    setTimeout(() => { document.body.classList.add('is-collapsing'); }, 1010);
    setTimeout(() => { tailBadge.classList.remove('is-on'); }, 1080);

    setTimeout(() => {
      document.body.classList.remove('is-loading');
      document.body.classList.remove('is-collapsing');
      startBtn.classList.remove('is-out');
      startBtn.removeAttribute('aria-disabled');
      state.loading = false;
    }, 1320);
  }

  /* ---------- sheet ---------- */

  function openSheet() {
    if (state.sheet || state.dialog) return;
    state.sheet = true;
    syncModeButtons();
    updateCells();
    sheet.classList.add('is-on');
    sheetBackdrop.classList.add('is-on');
    sheet.setAttribute('aria-hidden', 'false');
  }

  function closeSheet() {
    if (!state.sheet) return;
    state.sheet = false;
    sheet.classList.remove('is-on');
    sheetBackdrop.classList.remove('is-on');
    sheet.setAttribute('aria-hidden', 'true');
  }

  /* ---------- accessibility dialog ---------- */

  function showDialog() {
    if (state.dialog) return;
    state.dialog = true;
    dialog.classList.add('is-on');
    dialogBackdrop.classList.add('is-on');
    dialog.setAttribute('aria-hidden', 'false');
  }

  function hideDialog() {
    if (!state.dialog) return;
    state.dialog = false;
    dialog.classList.remove('is-on');
    dialogBackdrop.classList.remove('is-on');
    dialog.setAttribute('aria-hidden', 'true');
  }

  function accessibilityEnabled() {
    return callNative('isAccessibilityEnabled', () => !PREVIEW_A11Y_OFF);
  }

  function checkAccessibility() {
    if (!accessibilityEnabled()) showDialog();
  }

  /* ---------- sync ---------- */

  function syncWallpaper(target) {
    if (syncing) {
      showToast('正在设置，稍等一下');
      return;
    }
    const wp = currentWallpaper();
    syncing = true;
    lastSyncTarget = target;
    clearTimeout(syncTimer);
    showToast(target === 2 ? '正在设置锁屏…' : '正在设置桌面…');
    syncTimer = setTimeout(() => {
      if (!syncing) return;
      syncing = false;
      showToast('没换成，再试一次');
    }, 9000);
    callNative('setWallpaper', () => {
      clearTimeout(syncTimer);
      if (!syncing) return;
      syncing = false;
      showToast('浏览器预览不支持设置壁纸');
    }, wp.src, target);
  }

  /* ---------- splash ---------- */

  function finishSplash() {
    splash.classList.add('is-out');
    setTimeout(() => {
      splash.style.display = 'none';
      checkAccessibility();
    }, 560);
  }

  function bootSplash() {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const skip = /[?&]splash=0(?:&|$)/.test(location.search);
    if (skip) {
      splash.style.display = 'none';
      checkAccessibility();
      return;
    }
    setTimeout(finishSplash, reduce ? 600 : 1500);
  }

  /* ---------- native callbacks ---------- */

  window.whaleResume = function () {
    if (state.dialog && accessibilityEnabled()) hideDialog();
    if (prefs.bg === 'system') refreshSystemDark();
  };

  window.whaleBack = function () {
    if (state.sheet) {
      closeSheet();
      return true;
    }
    if (state.dialog) return true;
    if (state.loading) return true;
    if (state.page === 'settings') {
      goPage('home');
      return true;
    }
    return false;
  };

  window.whaleInsetsChanged = function (px) {
    // 原生给的是物理像素，CSS 变量要的是 CSS 像素
    const value = (Number(px) || 0) / (window.devicePixelRatio || 1);
    document.body.style.setProperty('--safe-bottom', Math.max(0, value) + 'px');
  };

  window.whaleSystemDarkChanged = function (dark) {
    state.systemDark = dark === true || dark === 'true' || dark === 1 || dark === '1';
    if (prefs.bg === 'system') {
      applyTheme();
      samplePalette();
    }
  };

  window.whaleSyncResult = function (ok, message) {
    clearTimeout(syncTimer);
    syncing = false;
    const success = ok === true || ok === 'true' || ok === 1 || ok === '1';
    if (!success) {
      showToast('没换成，再试一次');
      return;
    }
    if (typeof message === 'string' && /fail|error/i.test(message)) {
      showToast('没换成，再试一次');
      return;
    }
    showToast(lastSyncTarget === 2 ? '已设为锁屏壁纸' : '已设为桌面壁纸');
  };

  /* ---------- events ---------- */

  function bindEvents() {
    startBtn.addEventListener('click', playLoading);

    $('openLibrary').addEventListener('click', openSheet);
    $('syncHome').addEventListener('click', () => syncWallpaper(1));
    $('syncLock').addEventListener('click', () => syncWallpaper(2));
    $('openGithub').addEventListener('click', () => {
      callNative('openGithub', () => {
        window.open('https://github.com/JumpTea/whalego', '_blank');
      });
    });

    navHome.addEventListener('click', () => goPage('home'));
    navSettings.addEventListener('click', () => goPage('settings'));

    sheetBackdrop.addEventListener('click', closeSheet);

    modeButtons.forEach((btn) => {
      btn.addEventListener('click', () => setBg(btn.dataset.mode));
    });

    wallGrid.addEventListener('click', (e) => {
      const cell = e.target.closest('.wall');
      if (!cell || !WALL_BY_ID.has(cell.dataset.id)) return;
      chooseWallpaper(cell.dataset.id);
      setTimeout(closeSheet, 160);
    });

    goBtn.addEventListener('click', () => {
      callNative('openAccessibilitySettings', null);
    });
    leaveBtn.addEventListener('click', () => {
      callNative('exitApp', () => window.close());
    });

    document.addEventListener('pointerdown', onPointerDown, { passive: true });
    document.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerup', onPointerUp, { passive: true });
    document.addEventListener('pointercancel', onPointerCancel, { passive: true });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.sheet) closeSheet();
    });

    window.addEventListener('resize', () => {
      if (drag) return;
      pages.style.transform = 'translate3d(' + pageOffset(state.page) + 'px, 0, 0)';
    });

    window.addEventListener('orientationchange', () => {
      setTimeout(() => {
        if (drag) return;
        pages.style.transform = 'translate3d(' + pageOffset(state.page) + 'px, 0, 0)';
      }, 120);
    });
  }

  /* ---------- system dark ---------- */

  function refreshSystemDark() {
    const dark = callNative('getSystemDark', () => {
      return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    });
    state.systemDark = dark === true || dark === 'true' || dark === 1 || dark === '1';
    if (prefs.bg === 'system') {
      applyTheme();
      samplePalette();
    }
  }

  function watchBrowserTheme() {
    if (bridge || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    state.systemDark = mq.matches;
    const onChange = (e) => {
      state.systemDark = e.matches;
      if (prefs.bg === 'system') {
        applyTheme();
        samplePalette();
      }
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  /* ---------- browser preview hook ---------- */

  function exposePreviewHook() {
    if (bridge && !/[?&]qa(?:=|&|$)/.test(location.search)) return;
    window.__whale = {
      state: () => ({
        page: state.page,
        sheet: state.sheet,
        dialog: state.dialog,
        loading: state.loading,
        prefs: { wallpaper: prefs.wallpaper, bg: prefs.bg },
        wallpapers: WALLS.length
      }),
      goPage,
      openSheet,
      closeSheet,
      showDialog,
      hideDialog,
      chooseWallpaper,
      setMode: setBg,
      trigger: playLoading,
      finishSplash
    };
  }

  /* ---------- hidden diagnostics (5 taps on the corner note) ---------- */

  function noteImageError(src) {
    if (!window.__imgErrors) window.__imgErrors = [];
    if (window.__imgErrors.length < 20 && window.__imgErrors.indexOf(src) < 0) {
      window.__imgErrors.push(src);
    }
  }

  function showDiagnostics() {
    let box = document.getElementById('diagBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'diagBox';
      box.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(10,13,18,.94);'
        + 'color:#fff;font:12px/1.55 monospace;padding:18px;overflow:auto;white-space:pre-wrap';
      document.body.appendChild(box);
    }
    const wp = currentWallpaper();
    const failed = (window.__imgErrors || []).join('\n  ');
    const a11y = callNative('accessibilityDebug', '');
    const lines = [
      'UA: ' + navigator.userAgent,
      'URL: ' + location.href,
      'WALLS: ' + WALLS.length,
      'wall: ' + wp.id + ' / body=' + document.body.dataset.wall,
      'a11y: ' + (a11y || '-'),
      'current: ' + wp.src + ' / ' + wp.thumb,
      'wallA: ' + (wallA.getAttribute('src') || '-') + ' complete=' + wallA.complete
        + ' w=' + wallA.naturalWidth,
      'wallB: ' + (wallB.getAttribute('src') || '-') + ' complete=' + wallB.complete
        + ' w=' + wallB.naturalWidth,
      'grid imgs: ' + document.querySelectorAll('#wallGrid img').length,
      'failed images:\n  ' + (failed || 'none')
    ];
    box.textContent = lines.join('\n') + '\n\nfetch: …';
    fetch(assetUrl(wp.src)).then((r) => r.arrayBuffer().then((buf) => {
      box.textContent = lines.join('\n') + '\n\nfetch: ' + r.status + ' '
        + (r.headers.get('content-type') || '-') + ' ' + buf.byteLength + ' B';
    })).catch((e) => {
      box.textContent = lines.join('\n') + '\n\nfetch error: ' + (e && e.message);
    });
    box.addEventListener('click', () => box.remove(), { once: true });
  }

  function installDiagnostics() {
    const note = document.getElementById('study');
    if (!note) return;
    let taps = 0;
    let timer = 0;
    note.addEventListener('click', () => {
      taps++;
      clearTimeout(timer);
      timer = setTimeout(() => { taps = 0; }, 1200);
      if (taps >= 5) {
        taps = 0;
        showDiagnostics();
      }
    });
  }

  /* ---------- boot ---------- */

  function init() {
    refreshSystemDark();
    watchBrowserTheme();
    initWallpaper();
    applyTheme();
    syncModeButtons();
    renderWallGrid();
    bindEvents();
    installDiagnostics();
    samplePalette();

    const inset = callNative('getBottomInset', () => 0);
    const bottom = (Number(inset) || 0) / (window.devicePixelRatio || 1);
    if (bottom > 0) document.body.style.setProperty('--safe-bottom', bottom + 'px');

    exposePreviewHook();
    bootSplash();
  }

  init();
})();
