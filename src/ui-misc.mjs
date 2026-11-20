function Toggle({ label, checked, onChange }) {
  return h('button', {
    type: 'button',
    className: 'ws-toggle',
    role: 'switch',
    'aria-checked': checked ? 'true' : 'false',
    onClick: () => onChange(!checked),
  },
  h('span', { className: 'ws-toggle-track' + (checked ? ' on' : '') }, h('span', { className: 'ws-toggle-knob' })),
  h('span', { className: 'ws-toggle-label' }, label),
  )
}

function ToastStack({ toasts }) {
  return h('div', { className: 'ws-toasts', role: 'status', 'aria-live': 'polite' },
    toasts.map(entry => h('div', { key: entry.id, className: 'ws-toast ' + entry.kind }, entry.message)),
  )
}

const ICON_PATHS = {
  pen: 'M4 20l4.5-1 9-9a2 2 0 0 0 0-2.8l-.7-.7a2 2 0 0 0-2.8 0l-9 9L4 20z M13 6l5 5',
  sparkles: 'M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z',
  shuffle: 'M4 7h3.5l9 10H20 M4 17h3.5l3-3.4 M14.5 9.5L16.5 7H20 M18 5l2 2-2 2 M18 15l2 2-2 2',
  copy: 'M9 9h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z M15 5H6a2 2 0 0 0-2 2v9',
  send: 'M21 3L10 14 M21 3l-7 18-4-7-7-4 18-7z',
  save: 'M5 3h11l3 3v15H5V3z M8 3v6h8V3 M8 21v-7h8v7',
  download: 'M12 3v12 M7 10l5 5 5-5 M4 21h16',
  upload: 'M12 21V9 M7 14l5-5 5 5 M4 3h16',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 14h10l1-14 M10 11v6 M14 11v6',
  plus: 'M12 5v14 M5 12h14',
  arrowUp: 'M12 19V5 M6 11l6-6 6 6',
  arrowDown: 'M12 5v14 M18 13l-6 6-6-6',
  check: 'M5 12l5 5L20 7',
  close: 'M6 6l12 12 M18 6L6 18',
  undo: 'M9 7L4 12l5 5 M4 12h10a5 5 0 0 1 0 10h-3',
  redo: 'M15 7l5 5-5 5 M20 12H10a5 5 0 0 0 0 10h3',
  panel: 'M4 4h16v16H4z M15 4v16',
  more: 'M6 12h.01 M12 12h.01 M18 12h.01',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z M15.5 15.5L21 21',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M9.5 9a2.5 2.5 0 1 1 3.6 2.3c-.7.4-1.1 1-1.1 1.8 M12 17h.01',
  lock: 'M7 10V7a5 5 0 0 1 10 0v3 M6 10h12v10H6z M12 14v3',
  unlock: 'M7 10V7a5 5 0 0 1 9.4-1.8 M6 10h12v10H6z M12 14v3',
  chevron: 'M6 9l6 6 6-6',
  doc: 'M6 3h8l4 4v14H6z M14 3v4h4',
  key: 'M14 7a4 4 0 1 0-3.5 4L4 17v3h3v-2h2v-2h2l2-2a4 4 0 0 0 4-4z',
  image: 'M4 5h16v14H4z M4 15l4-4 4 4 3-3 5 5',
  wand: 'M5 19L17 7 M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z',
  chat: 'M4 5h16v11H9l-5 4V5z M8 9h8 M8 12.5h5',
  palette: 'M12 3a9 9 0 1 0 0 18c1.4 0 2-.9 2-1.7 0-.6-.3-1-.3-1.7 0-1 .8-1.6 1.8-1.6H18a3 3 0 0 0 3-3c0-4.4-4-9-9-9z M7.5 9.5h.01 M10.5 7h.01 M14 7h.01 M16.8 9.7h.01',
}

function Icon({ name, size = 16 }) {
  const path = ICON_PATHS[name] ?? ICON_PATHS.doc
  return h('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
  }, h('path', { d: path }))
}

/* ------------------------------------------------------------------ *
 * Sidebar icon and stylesheet
 * ------------------------------------------------------------------ */

function StudioSidebarIcon({ size = 24, active }) {
  return h('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    'aria-hidden': 'true',
  },
  h('path', {
    d: 'M7 3h10a3.7 3.7 0 0 1 3.7 3.7v9.4a3.7 3.7 0 0 1-3.7 3.7h-6.1l-5 3.1c-.6.4-1.1-.1-.8-.7l1.4-2.4H7a3.7 3.7 0 0 1-3.7-3.7V6.7A3.7 3.7 0 0 1 7 3z',
    fill: 'currentColor',
    fillOpacity: active ? 0.16 : 0.07,
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeOpacity: 0.9,
    strokeLinejoin: 'round',
  }),
  h('rect', { x: 6.7, y: 6.4, width: 3.6, height: 1.3, rx: 0.65, fill: 'currentColor' }),
  h('rect', { x: 6.7, y: 9.0, width: 9.4, height: 1.6, rx: 0.8, fill: 'currentColor', fillOpacity: 0.8 }),
  h('rect', { x: 6.7, y: 12.0, width: 6.6, height: 1.6, rx: 0.8, fill: 'currentColor', fillOpacity: 0.4 }),
  h('rect', { x: 6.7, y: 15.0, width: 8.8, height: 1.8, rx: 0.9, fill: 'currentColor' }),
  )
}

const STUDIO_CSS = `
.ws-root{--ws-bg:var(--dsw-alias-bg-base);--ws-surface:var(--dsw-alias-bg-layer-1);--ws-surface2:var(--dsw-alias-bg-layer-2);--ws-border:var(--dsw-alias-border-l1);--ws-border2:var(--dsw-alias-border-l2);--ws-text:var(--dsw-alias-label-primary);--ws-muted:var(--dsw-alias-label-secondary);--ws-brand:var(--dsw-alias-brand-primary);--ws-danger:var(--dsw-alias-state-error-primary);--ws-success:var(--dsw-alias-state-success-primary);height:100%;min-height:0;display:flex;flex-direction:column;background:var(--ws-bg);color:var(--ws-text);font-size:13px;line-height:1.5;-webkit-font-smoothing:antialiased}
.ws-root *{box-sizing:border-box}
.ws-top{flex:none;display:flex;align-items:center;gap:8px;height:52px;padding:0 14px;border-bottom:1px solid var(--ws-border);background:var(--ws-surface);-webkit-app-region:no-drag;app-region:no-drag;padding-left:max(14px, calc(var(--dsh-frame-leading-clearance, 0px) - 60px))}
.ws-brand{display:flex;align-items:center;gap:8px;font-weight:600;font-size:14px;white-space:nowrap;color:var(--ws-text)}
.ws-badge{font-size:11px;font-weight:400;color:var(--ws-muted);border:1px solid var(--ws-border);border-radius:99px;padding:1px 8px;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis}
.ws-badge.ok{color:var(--ws-success);border-color:var(--ws-success)}
.ws-top-spacer{flex:1}
.ws-top-group{display:flex;align-items:center;gap:2px;padding-right:4px;margin-right:2px;border-right:1px solid var(--ws-border)}
.ws-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 11px;border-radius:8px;border:1px solid var(--ws-border);background:var(--ws-surface);color:var(--ws-text);font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap;transition:background .12s,border-color .12s,transform .06s}
.ws-btn:hover:not(:disabled){background:var(--ws-surface2);border-color:var(--ws-border2)}
.ws-btn:active:not(:disabled){transform:translateY(1px)}
.ws-btn:disabled{opacity:.45;cursor:default}
.ws-btn.primary{background:var(--ws-brand);border-color:transparent;color:var(--ws-bg);font-weight:600}
.ws-btn.primary:hover:not(:disabled){filter:brightness(1.05);background:var(--ws-brand)}
.ws-btn.solid{background:var(--ws-text);border-color:transparent;color:var(--ws-bg);font-weight:600}
.ws-btn.solid:hover:not(:disabled){background:var(--ws-text);filter:brightness(1.1)}
.ws-btn.danger{background:var(--ws-danger);border-color:transparent;color:#fff;font-weight:600}
.ws-btn.ghost{background:transparent}
.ws-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:7px;border:0;background:transparent;color:var(--ws-muted);cursor:pointer;padding:0}
.ws-icon-btn:hover:not(:disabled){background:var(--ws-surface2);color:var(--ws-text)}
.ws-icon-btn:disabled{opacity:.35;cursor:default}
.ws-body{flex:1;min-height:0;display:flex;position:relative}
.ws-dragging{outline:2px dashed var(--ws-brand);outline-offset:-8px;background:color-mix(in srgb,var(--ws-brand) 6%,transparent)}
.ws-badge.busy{color:var(--ws-brand);border-color:var(--ws-brand);animation:ws-pulse 1.1s ease-in-out infinite}
.ws-left{flex:0 0 38%;min-width:300px;max-width:540px;display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--ws-border);background:var(--ws-bg)}
.ws-left-head{flex:none;display:flex;align-items:center;gap:6px;padding:10px 12px 6px}
.ws-doc-switch{position:relative;flex:1;min-width:0}
.ws-doc-current{display:flex;align-items:center;gap:7px;width:100%;height:30px;padding:0 9px;border-radius:7px;border:1px solid var(--ws-border);background:var(--ws-surface);color:var(--ws-text);font:inherit;font-size:12.5px;cursor:pointer;text-align:left}
.ws-doc-current span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ws-doc-menu{position:absolute;z-index:30;top:34px;left:0;width:260px;max-height:280px;overflow:auto;background:var(--dsw-alias-bg-overlay);border:1px solid var(--ws-border);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.16);padding:4px}
.ws-doc-menu button{display:flex;align-items:center;gap:8px;width:100%;height:32px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--ws-text);font:inherit;font-size:12.5px;cursor:pointer;text-align:left}
.ws-doc-menu button:hover{background:var(--ws-surface2)}
.ws-doc-menu button.on{background:var(--ws-surface2);font-weight:600}
.ws-doc-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ws-doc-date{color:var(--ws-muted);font-size:11px}
.ws-left-actions{display:flex;gap:2px}
.ws-title-hint{margin:0 14px 6px;padding:5px 9px;border-radius:6px;background:var(--ws-accent-soft,#FFF4D6);background:var(--ws-surface2);color:var(--ws-muted);font-size:11px;line-height:1.6}
.ws-empty{display:flex;align-items:center;justify-content:center;min-height:420px;padding:40px 30px;color:#9a9a9a;font-size:13px;line-height:1.9;text-align:center}
.ws-title-input{flex:none;margin:0 12px 6px;height:34px;padding:0 10px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--ws-text);font:inherit;font-size:15px;font-weight:600;outline:none}
.ws-title-input::placeholder{color:var(--ws-muted);font-weight:400}
.ws-title-input:focus{border-color:var(--ws-border);background:var(--ws-surface)}
.ws-caption-editor{position:relative;display:flex;align-items:center;gap:6px;margin:4px 0 6px;padding:6px;border:1px solid var(--ws-border);border-radius:8px;background:var(--ws-surface);z-index:5}
.ws-caption-editor .ws-input{height:28px;font-size:12px;flex:1}
.ws-caption-editor .ws-link{white-space:nowrap;font-size:11px}
.ws-searchbar{display:flex;align-items:center;gap:5px;margin:6px 14px 0;padding:5px;border:1px solid var(--ws-border);border-radius:8px;background:var(--ws-surface)}
.ws-searchbar .ws-input{height:26px;font-size:12px;flex:1;min-width:0}
.ws-searchbar .ws-link{white-space:nowrap}
.ws-outline{display:flex;align-items:center;gap:6px;padding:6px 14px 0;overflow:hidden}
.ws-outline-label{font-size:10px;color:var(--ws-muted);letter-spacing:.08em;flex:none}
.ws-outline-list{display:flex;gap:5px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px}
.ws-outline-list::-webkit-scrollbar{display:none}
.ws-outline-item{flex:none;border:0;background:transparent;color:var(--ws-muted);font:inherit;font-size:11px;padding:2px 5px;border-radius:5px;cursor:pointer;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ws-outline-item:hover{background:var(--ws-surface2);color:var(--ws-text)}
.ws-outline-item.on{background:var(--ws-surface2);color:var(--ws-text);font-weight:600}
.ws-outline-item[data-level="2"]{padding-left:4px}
.ws-outline-item[data-level="3"]{padding-left:10px}
.ws-toolbar{flex:none;display:flex;flex-wrap:wrap;gap:2px;padding:4px 12px 8px;border-bottom:1px solid var(--ws-border)}
.ws-tool.on{background:var(--ws-surface2);border-color:var(--ws-border2);color:var(--ws-text);font-weight:600}
.ws-tool{min-width:26px;height:26px;padding:0 6px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--ws-muted);font:inherit;font-size:12px;cursor:pointer}
.ws-tool:hover{background:var(--ws-surface2);color:var(--ws-text);border-color:var(--ws-border)}
.ws-editor{flex:1;min-height:0;width:100%;padding:14px 16px 24px;border:0;outline:none;resize:none;background:transparent;color:var(--ws-text);font:inherit;font-size:13.5px;line-height:1.9;tab-size:2}
.ws-editor::placeholder{color:var(--ws-muted)}
.ws-left-foot{flex:none;display:flex;align-items:center;gap:10px;height:34px;padding:0 14px;border-top:1px solid var(--ws-border);color:var(--ws-muted);font-size:11.5px}
.ws-foot-hint{color:var(--ws-brand)}
.ws-saved{display:inline-flex;align-items:center;gap:4px;color:var(--ws-muted)}
.ws-mid{flex:1;min-width:0;display:flex;flex-direction:column;background:var(--ws-surface2);position:relative}
.ws-stage{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;align-items:center;gap:14px;padding:20px 18px 26px}
.ws-phone{position:relative;width:410px;max-width:100%;flex:none;display:flex;flex-direction:column;max-height:calc(100% - 40px);padding:4px;border-radius:62px;background:linear-gradient(150deg,#55565b 0%,#26272b 26%,#1a1b1e 52%,#2f3035 74%,#5c5d63 100%);box-shadow:0 34px 78px rgba(0,0,0,.30),0 3px 10px rgba(0,0,0,.22),inset 0 0 0 1px rgba(255,255,255,.18)}
.ws-screen{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;background:#fff;border-radius:58px;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(0,0,0,.06)}
.ws-lang-switch{margin-top:8px;align-self:flex-start}
.ws-device-switch{display:flex;gap:2px;border:1px solid var(--ws-border);border-radius:8px;padding:2px;background:var(--ws-surface2)}
.ws-device-btn{border:0;background:transparent;color:var(--ws-muted);font:inherit;font-size:11px;line-height:1.4;padding:2px 8px;border-radius:6px;cursor:pointer}
.ws-device-btn.on{background:var(--ws-glass-strong);color:var(--ws-text);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.ws-phone-android{padding:3px;border-radius:44px;background:linear-gradient(160deg,#2c2d31,#141519 55%,#34353b);box-shadow:0 24px 60px rgba(0,0,0,.28),0 2px 8px rgba(0,0,0,.2),inset 0 0 0 1px rgba(255,255,255,.14)}
.ws-phone-android .ws-screen{border-radius:41px}
.ws-phone-android .ws-side-btn{display:none}
.ws-phone-android .ws-statusbar{height:48px;padding:13px 22px 0}
.ws-phone-android .ws-status-time{font-size:14px}
.ws-punch{position:absolute;top:13px;left:50%;transform:translateX(-50%);width:12px;height:12px;border-radius:50%;background:#000;z-index:3;box-shadow:inset 0 0 0 1px rgba(90,120,150,.4)}
.ws-phone-android .ws-island{display:none}
.ws-phone-android .ws-home-indicator i{width:108px;height:4px;background:#222}
.ws-side-btn{position:absolute;display:block;width:3px;border-radius:2px;background:linear-gradient(180deg,#3b3c40,#202125)}
.ws-side-btn-mute{left:-2px;top:150px;height:26px}
.ws-side-btn-volup{left:-2px;top:196px;height:52px}
.ws-side-btn-voldown{left:-2px;top:258px;height:52px}
.ws-side-btn-power{right:-2px;top:216px;height:78px}
.ws-statusbar{flex:none;height:56px;padding:17px 26px 0;display:flex;align-items:flex-start;justify-content:space-between;background:#fff;color:#111;position:relative;z-index:2}
.ws-status-time{font-size:15px;font-weight:600;letter-spacing:-.01em;padding-left:2px}
.ws-status-glyphs{display:flex;align-items:center;gap:5px;color:#111;padding-top:1px}
.ws-island{position:absolute;top:11px;left:50%;transform:translateX(-50%);width:118px;height:35px;border-radius:18px;background:#000;z-index:3;display:flex;align-items:center;justify-content:flex-end;padding-right:13px;box-shadow:0 1px 2px rgba(0,0,0,.4)}
.ws-island::after{content:'';width:7px;height:7px;border-radius:50%;background:#141f26;box-shadow:inset 0 0 0 1px rgba(90,130,150,.45)}
.ws-wechat-nav{flex:none;height:44px;padding:0 14px;display:flex;align-items:center;gap:8px;background:#fff;color:#111;position:relative;z-index:2;border-bottom:1px solid rgba(0,0,0,.04)}
.ws-nav-back,.ws-nav-more{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;color:#111}
.ws-nav-brand{flex:1;text-align:center;font-size:14px;font-weight:600;color:#1a1a1a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 4px}
.ws-phone-scroll{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;background:#fff;padding-top:12px;scrollbar-width:none;-ms-overflow-style:none}
.ws-phone-scroll::-webkit-scrollbar{width:0;height:0;display:none}
.ws-phone-scroll .ws-article{padding-top:6px}
.ws-read-original{display:flex;align-items:center;gap:1px;padding:2px 18px 30px;color:#576B95;font-size:14px;line-height:1.6}
.ws-wechat-actions{flex:none;height:58px;padding:0 12px;display:flex;align-items:center;gap:12px;border-top:1px solid #ededed;background:#fff}
.ws-comment-pill{flex:1;height:34px;border-radius:17px;background:#F4F4F4;color:#9b9b9b;font-size:13px;display:flex;align-items:center;padding:0 14px}
.ws-action-icon{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;color:#4a4a4a}
.ws-home-indicator{flex:none;height:22px;display:flex;align-items:center;justify-content:center;background:#fff}
.ws-home-indicator i{display:block;width:136px;height:5px;border-radius:3px;background:#111}
.ws-article{width:100%;min-height:120px}
.ws-block{position:relative;border-radius:4px}
.ws-block:hover{outline:1px dashed rgba(0,0,0,.14);outline-offset:2px}
.ws-block.ai{box-shadow:inset 2px 0 0 color-mix(in srgb,var(--ws-accent) 55%,transparent)}
.ws-block.locked{box-shadow:inset 3px 0 0 color-mix(in srgb,var(--ws-warn,#b47a00) 70%,transparent)}
.ws-block.ai.locked{box-shadow:inset 2px 0 0 var(--ws-accent),inset 5px 0 0 color-mix(in srgb,var(--ws-warn,#b47a00) 55%,transparent)}
.ws-block-origin{position:absolute;top:3px;right:4px;font-size:9px;padding:1px 4px;border-radius:4px;background:var(--ws-surface2);color:var(--ws-muted);opacity:0;transition:opacity .15s}
.ws-block:hover .ws-block-origin,.ws-block.selected .ws-block-origin{opacity:1}
.ws-block.dragging{opacity:.45;outline:1px dashed var(--ws-brand)}
.ws-block.selected{outline:2px solid var(--ws-brand);outline-offset:2px}
.ws-block-tools{position:absolute;top:-13px;right:2px;display:none;align-items:center;gap:1px;padding:2px;border-radius:7px;background:#212226;box-shadow:0 6px 18px rgba(0,0,0,.28);z-index:4}
.ws-block:hover .ws-block-tools{display:flex}
.ws-block-tools button{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border:0;border-radius:5px;background:transparent;color:#e6e6e6;cursor:pointer}
.ws-block-tools button:hover{background:#3a3b40}
.ws-block-tag{position:absolute;left:-2px;top:-18px;font-size:10px;line-height:16px;padding:0 6px;border-radius:4px;background:var(--ws-brand);color:var(--ws-bg);z-index:3}
.ws-mini-btn{height:24px;padding:0 10px;border-radius:8px;border:1px solid var(--ws-border);background:var(--ws-glass-strong);color:var(--ws-text);font:inherit;font-size:11.5px;cursor:pointer}
.ws-mini-btn:hover{border-color:var(--ws-border2)}
.ws-stage-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:0 4px 4px;color:var(--ws-muted);font-size:11.5px}
.ws-stage-chip{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:99px;background:var(--ws-surface);border:1px solid var(--ws-border)}
.ws-stage-chip i{width:8px;height:8px;border-radius:50%;display:block}
.ws-stage-note{opacity:.75}
.ws-right{flex:0 0 320px;display:flex;flex-direction:column;min-height:0;border-left:1px solid var(--ws-border);background:var(--ws-surface)}
.ws-wide.ws-right-closed .ws-right{display:none}
.ws-compact .ws-left{flex:0 0 360px;min-width:300px;max-width:none}
.ws-compact .ws-right{position:absolute;right:0;top:0;bottom:0;width:min(360px,92%);flex:none;box-shadow:-14px 0 34px rgba(0,0,0,.18);z-index:26}
.ws-compact.ws-right-closed .ws-right{display:none}
.ws-scrim{position:absolute;inset:0;background:rgba(0,0,0,.16);z-index:24}
.ws-tabs{flex:none;display:flex;gap:2px;padding:10px 12px 8px;border-bottom:1px solid var(--ws-border)}
.ws-tab{flex:1;height:28px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--ws-muted);font:inherit;font-size:12.5px;cursor:pointer}
.ws-tab:hover{color:var(--ws-text);background:var(--ws-surface2)}
.ws-tab.on{background:var(--ws-surface2);border-color:var(--ws-border);color:var(--ws-text);font-weight:600}
.ws-tab-close{flex:none;width:28px;height:28px;border:0;border-radius:7px;background:transparent;color:var(--ws-muted);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.ws-tab-close:hover{background:var(--ws-surface2);color:var(--ws-text)}
.ws-panel{flex:1;min-height:0;overflow-y:auto;padding:12px}
.ws-pane-hidden{display:none}
.ws-sections{display:flex;flex-direction:column;gap:14px}
.ws-card{border:1px solid var(--ws-border);border-radius:10px;padding:12px;background:var(--ws-bg)}
.ws-card-head{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:var(--ws-text);margin-bottom:8px}
.ws-card-head .ws-badge{margin-left:auto}
.ws-reasons{margin:0;padding-left:16px;display:flex;flex-direction:column;gap:4px;color:var(--ws-muted);font-size:11.5px;line-height:1.6}
.ws-group{display:flex;flex-direction:column;gap:8px}
.ws-group-head{display:flex;align-items:center;justify-content:space-between;font-size:12px;font-weight:600;color:var(--ws-muted);text-transform:uppercase;letter-spacing:.06em}
.ws-group-note{font-weight:400;text-transform:none;letter-spacing:0;color:var(--ws-muted)}
.ws-themes{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.ws-theme{display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid var(--ws-border);border-radius:9px;background:var(--ws-bg);cursor:pointer;text-align:left;font:inherit}
.ws-theme:hover{border-color:var(--ws-border2)}
.ws-theme.on{border-color:var(--ws-brand);box-shadow:0 0 0 1px var(--ws-brand) inset}
.ws-theme-mini{position:relative;display:flex;flex-direction:column;gap:4px;height:82px;padding:9px 9px 8px;border:1px solid;border-radius:7px;overflow:hidden}
.ws-theme-mini-title{font-size:13px;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:20px}
.ws-theme-mini-tag{position:absolute;top:8px;right:8px;font-size:8px;line-height:1;padding:2px 4px;border:1px solid;border-radius:99px;opacity:.9}
.ws-theme-mini-rule{width:26px;height:2px;border-radius:2px;margin-top:2px}
.ws-theme-mini-line{height:3px;border-radius:2px;opacity:.36;width:88%}
.ws-theme-mini-line.short{width:62%;opacity:.24}
.ws-theme-mini-quote{margin-top:auto;font-size:8.5px;line-height:1.4;padding-left:6px;border-left:2px solid;opacity:.78;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ws-theme-name-row{display:flex;align-items:center;gap:4px}
.ws-theme-fidelity{font-size:9.5px;letter-spacing:.02em;color:var(--ws-accent);background:color-mix(in srgb,var(--ws-accent) 9%,transparent);border-radius:4px;padding:1px 4px;width:max-content}
.ws-theme-fav{border:0;background:transparent;color:var(--ws-muted);font-size:13px;line-height:1;padding:1px 2px;margin-left:auto;cursor:pointer;border-radius:4px}
.ws-theme-fav.on{color:var(--ws-brand)}
.ws-theme-fav:hover{background:var(--ws-surface2)}
.ws-theme-filter{margin-bottom:6px}
.ws-variant-row{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.ws-variant-card{display:flex;flex-direction:column;gap:4px;padding:0;border:1px solid var(--ws-border);border-radius:8px;background:var(--ws-bg);cursor:pointer;font:inherit;text-align:left;overflow:hidden}
.ws-variant-card.on{border-color:var(--ws-brand);box-shadow:0 0 0 1px var(--ws-brand) inset}
.ws-variant-mini{display:flex;flex-direction:column;gap:3px;padding:7px 8px;height:56px;border-bottom:1px solid;overflow:hidden}
.ws-variant-title{font-size:11px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ws-variant-mini[data-title-style="ribbon"] .ws-variant-title{background:rgba(0,0,0,.06);padding:2px 4px;width:max-content;max-width:90%}
.ws-variant-mini[data-title-style="boxed"] .ws-variant-title{border:1px solid currentColor;padding:1px 3px;width:max-content;max-width:90%}
.ws-variant-mini[data-title-style="centered"] .ws-variant-title{text-align:center}
.ws-variant-mini[data-title-style="vertical"] .ws-variant-title{border-left:2px solid;padding-left:4px}
.ws-variant-mini[data-title-style="underline"] .ws-variant-title{text-decoration:underline;text-underline-offset:2px}
.ws-variant-rule{height:2px;width:22px;border-radius:2px}
.ws-variant-line{height:2px;width:82%;border-radius:2px;opacity:.35}
.ws-variant-line.short{width:55%;opacity:.22}
.ws-variant-name{font-size:11px;color:var(--ws-text);padding:0 8px 6px}
.ws-theme-meta{display:flex;flex-direction:column;gap:1px;min-width:0}
.ws-theme-name{font-size:12.5px;font-weight:600;color:var(--ws-text)}
.ws-theme-tag{font-size:10.5px;color:var(--ws-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ws-chips{display:flex;flex-wrap:wrap;gap:6px}
.ws-scope-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.ws-scope-row .ws-hint{flex:1;min-width:120px;margin:0}
.ws-preset-row{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px}
.ws-chip{height:28px;padding:0 11px;border:1px solid var(--ws-border);border-radius:99px;background:var(--ws-bg);color:var(--ws-text);font:inherit;font-size:12px;cursor:pointer}
.ws-chip:hover{border-color:var(--ws-border2)}
.ws-chip.on{background:var(--ws-text);color:var(--ws-bg);border-color:transparent;font-weight:600}
.ws-hint{margin:0;font-size:11.5px;line-height:1.65;color:var(--ws-muted)}
.ws-hint.danger{color:var(--ws-danger)}
.ws-swatches{display:flex;flex-wrap:wrap;gap:6px}
.ws-swatch{position:relative;width:22px;height:22px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0;box-shadow:0 0 0 1px var(--ws-border) inset}
.ws-swatch.on{border-color:var(--ws-text)}
.ws-swatch-custom{display:inline-flex;align-items:center;justify-content:center;background:var(--ws-surface2);color:var(--ws-muted);overflow:hidden}
.ws-swatch-custom input{position:absolute;inset:0;opacity:0;cursor:pointer}
.ws-input{width:100%;height:30px;padding:0 9px;border:1px solid var(--ws-border);border-radius:7px;background:var(--ws-bg);color:var(--ws-text);font:inherit;font-size:12.5px;outline:none}
.ws-input:focus{border-color:var(--ws-brand)}
.ws-textarea{height:auto;padding:7px 9px;resize:vertical;line-height:1.7}
.ws-field{display:flex;flex-direction:column;gap:4px}
.ws-field-label{font-size:11.5px;color:var(--ws-muted)}
.ws-slider-row{display:grid;grid-template-columns:52px 1fr 52px;align-items:center;gap:8px}
.ws-slider-label{font-size:11.5px;color:var(--ws-muted)}
.ws-slider-value{font-size:11.5px;color:var(--ws-text);text-align:right;font-variant-numeric:tabular-nums}
.ws-slider-row input[type=range]{width:100%;accent-color:var(--ws-brand);height:18px}
.ws-checklist{margin:0;padding-left:16px;display:flex;flex-direction:column;gap:4px;color:var(--ws-muted);font-size:11.5px;line-height:1.6}
.ws-toggle{display:flex;align-items:center;gap:8px;padding:2px 0;border:0;background:transparent;color:var(--ws-text);font:inherit;font-size:12.5px;cursor:pointer;text-align:left}
.ws-toggle-track{position:relative;width:30px;height:17px;border-radius:99px;background:var(--ws-border2);transition:background .15s;flex:none}
.ws-toggle-track.on{background:var(--ws-brand)}
.ws-toggle-knob{position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;background:#fff;transition:transform .15s;box-shadow:0 1px 3px rgba(0,0,0,.25)}
.ws-toggle-track.on .ws-toggle-knob{transform:translateX(13px)}
.ws-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.ws-config{display:flex;flex-direction:column;gap:8px;margin:8px 0 4px;padding:10px;border:1px dashed var(--ws-border2);border-radius:8px}
.ws-bundle-row{display:flex;align-items:center;gap:8px;width:100%;padding:7px 8px;border:1px solid var(--ws-border);border-radius:8px;background:transparent;color:var(--ws-text);font:inherit;font-size:12px;text-align:left;cursor:pointer;margin-bottom:6px}
.ws-bundle-row.on{border-color:var(--ws-accent);background:color-mix(in srgb,var(--ws-accent) 8%,transparent)}
.ws-bundle-check{width:16px;height:16px;border:1px solid var(--ws-border2);border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;flex:none}
.ws-bundle-row.on .ws-bundle-check{border-color:var(--ws-accent);color:var(--ws-accent)}
.ws-bundle-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ws-draft-actions{display:flex;gap:10px;align-items:center}
.ws-draft-row{display:flex;align-items:center;gap:10px;padding:7px 0;border-top:1px solid var(--ws-border)}
.ws-draft-row:first-of-type{border-top:0}
.ws-draft-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.ws-draft-title{font-size:12.5px;color:var(--ws-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ws-draft-meta{font-size:11px;color:var(--ws-muted)}
.ws-error-text{color:var(--ws-danger)}
.ws-cover{width:100%;aspect-ratio:900/383;border-radius:8px;object-fit:cover;display:block;border:1px solid var(--ws-border)}
.ws-cover-empty{display:flex;align-items:center;justify-content:center;background:var(--ws-surface2);color:var(--ws-muted);font-size:11.5px}
.ws-diff-card{display:flex;flex-direction:column;gap:6px;padding:9px;border:1px solid var(--ws-border);border-radius:10px;background:var(--ws-surface2)}
.ws-diff-head{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600}
.ws-diff-head .ws-badge{margin-left:auto}
.ws-diff-lines{display:flex;flex-direction:column;gap:2px;max-height:190px;overflow:auto;background:var(--ws-bg);border:1px solid var(--ws-border);border-radius:7px;padding:5px}
.ws-diff-line{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.55;padding:1px 4px;border-radius:3px;white-space:pre-wrap;word-break:break-word;color:var(--ws-muted)}
.ws-diff-line.add{background:color-mix(in srgb,var(--ws-success) 12%,transparent);color:var(--ws-success)}
.ws-diff-line.remove{background:color-mix(in srgb,var(--ws-danger) 10%,transparent);color:var(--ws-danger)}
.ws-diff-more{font-size:11px;color:var(--ws-muted);padding:2px 4px}
.ws-audit-list{display:flex;flex-direction:column;gap:4px}
.ws-audit-row{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ws-muted);min-height:22px}
.ws-audit-row.warn{color:var(--ws-text)}
.ws-audit-count{min-width:22px;text-align:right;font-variant-numeric:tabular-nums;color:var(--ws-muted)}
.ws-audit-row.warn .ws-audit-count{color:var(--ws-danger)}
.ws-audit-row .ws-link{margin-left:auto}
.ws-draft-search{height:28px;font-size:12px;margin:0 0 6px}
.ws-draft-pager{display:flex;align-items:center;gap:8px;justify-content:space-between;padding-top:4px}
.ws-draft-pager .ws-hint{flex:1;text-align:center;margin:0}
.ws-dna-candidates{display:flex;flex-direction:column;gap:5px;margin:6px 0}
.ws-dna-card{display:flex;align-items:center;gap:8px;padding:6px;border:1px solid var(--ws-border);border-radius:8px;background:var(--ws-bg);cursor:pointer;font:inherit;text-align:left}
.ws-dna-card:hover{border-color:var(--ws-border2);background:var(--ws-surface2)}
.ws-dna-swatch{width:42px;height:30px;border-radius:6px;border:1px solid;position:relative;flex:none}
.ws-dna-swatch i{position:absolute;right:5px;bottom:5px;width:12px;height:3px;border-radius:2px;display:block}
.ws-dna-name{font-size:11.5px;color:var(--ws-text);flex:1}
.ws-dna-actions .ws-link{font-size:10.5px}
.ws-dna-name-input{height:28px;font-size:12px;margin-top:2px}
.ws-dna-presets{display:flex;flex-direction:column;gap:2px;margin-top:6px;border-top:1px solid var(--ws-border);padding-top:6px}
.ws-dna-preset{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--ws-muted)}
.ws-dna-preset-name{flex:1;color:var(--ws-text)}
.ws-ledger{display:flex;flex-direction:column;gap:2px}
.ws-ledger-summary{display:flex;flex-direction:column;gap:2px;padding:7px 8px;border:1px solid var(--ws-border);border-radius:8px;background:var(--ws-surface2);font-size:11px;color:var(--ws-muted);margin-bottom:3px}
.ws-ledger-summary strong{font-size:11.5px;color:var(--ws-text)}
.ws-ledger-row{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--ws-muted);min-height:24px}
.ws-ledger-time{font-variant-numeric:tabular-nums;flex:none}
.ws-ledger-type{color:var(--ws-text)}
.ws-ledger-media{font-family:ui-monospace,Menlo,monospace;margin-left:auto;color:var(--ws-muted)}
.ws-snapshot-diff{padding:4px 0 7px;border-bottom:1px solid var(--ws-border)}
.ws-snapshot-diff .ws-hint{margin:0 0 4px}
.ws-snapshot-list{display:flex;flex-direction:column;gap:3px}
.ws-snapshot-row{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--ws-muted);min-height:24px}
.ws-snapshot-time{font-variant-numeric:tabular-nums}
.ws-snapshot-reason{color:var(--ws-text)}
.ws-snapshot-chars{flex:1;text-align:right}
.ws-preflight-list{display:flex;flex-direction:column;gap:5px}
.ws-preflight-row{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--ws-muted)}
.ws-preflight-dot{width:6px;height:6px;border-radius:50%;background:var(--ws-success);flex:none}
.ws-preflight-row.warn .ws-preflight-dot{background:var(--ws-warning,#D97706)}
.ws-preflight-row.error .ws-preflight-dot{background:var(--ws-danger)}
.ws-preflight-row.error{color:var(--ws-danger)}
.ws-preflight-label{color:var(--ws-text);font-size:12px}
.ws-preflight-detail{margin-left:auto;color:var(--ws-muted);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ws-badge.danger{color:var(--ws-danger);border-color:var(--ws-danger)}
.ws-publish-actions{display:flex;flex-direction:column;gap:8px}
.ws-publish-actions .ws-btn{width:100%}
.ws-confirm{display:flex;flex-direction:column;gap:6px;padding:10px;border:1px solid var(--ws-danger);border-radius:8px;font-size:11.5px;color:var(--ws-text)}
.ws-confirm .ws-btn{width:100%}
.ws-steps{display:flex;flex-direction:column;gap:6px;padding:10px;border:1px solid var(--ws-border);border-radius:8px;background:var(--ws-bg)}
.ws-step{display:grid;grid-template-columns:14px 1fr;gap:2px 6px;align-items:center;font-size:11.5px;color:var(--ws-muted)}
.ws-step-dot{width:7px;height:7px;border-radius:50%;background:var(--ws-border2);margin-left:3px}
.ws-step.done .ws-step-dot{background:var(--ws-success)}
.ws-step.running .ws-step-dot{background:var(--ws-brand);animation:ws-pulse 1s ease-in-out infinite}
.ws-step.error .ws-step-dot{background:var(--ws-danger)}
.ws-step.done .ws-step-label{color:var(--ws-text)}
.ws-step-detail{grid-column:2;color:var(--ws-muted);word-break:break-all}
.ws-error{display:flex;flex-direction:column;gap:4px;padding:10px;border:1px solid var(--ws-danger);border-radius:8px;background:color-mix(in srgb,var(--ws-danger) 8%,transparent);font-size:11.5px;line-height:1.6}
.ws-error strong{color:var(--ws-danger);font-size:12px;word-break:break-word}
.ws-toast{word-break:break-word}
.ws-msg-body{word-break:break-word}
.ws-hint{word-break:break-word}
.ws-error p{margin:0;color:var(--ws-text)}
.ws-result{display:flex;flex-direction:column;gap:4px;padding:10px;border:1px solid var(--ws-success);border-radius:8px;background:color-mix(in srgb,var(--ws-success) 8%,transparent);font-size:11.5px;line-height:1.6}
.ws-result strong{color:var(--ws-success);font-size:12px}
.ws-result p{margin:0;color:var(--ws-text)}
.ws-link{border:0;background:transparent;padding:0;color:var(--ws-brand);font:inherit;font-size:11.5px;cursor:pointer;text-align:left;text-decoration:none}
.ws-link:hover{text-decoration:underline}
.ws-menu-anchor{position:relative}
.ws-menu{position:absolute;right:0;top:34px;z-index:40;width:190px;padding:4px;border:1px solid var(--ws-border);border-radius:10px;background:var(--dsw-alias-bg-overlay);box-shadow:0 14px 36px rgba(0,0,0,.18)}
.ws-menu button{display:flex;align-items:center;gap:8px;width:100%;height:30px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--ws-text);font:inherit;font-size:12.5px;cursor:pointer;text-align:left}
.ws-menu button:hover{background:var(--ws-surface2)}
.ws-menu button.danger{color:var(--ws-danger)}
.ws-menu-sep{height:1px;margin:4px 6px;background:var(--ws-border)}
.ws-chat{display:flex;flex-direction:column;gap:10px}
.ws-chat-empty{display:flex;flex-direction:column;gap:10px;padding:12px;border:1px dashed var(--ws-border2);border-radius:10px}
.ws-chat-empty p{margin:0;font-size:12px;line-height:1.7;color:var(--ws-muted)}
.ws-chat-list{display:flex;flex-direction:column;gap:8px;max-height:42vh;overflow-y:auto;padding-right:2px}
.ws-msg{display:flex;flex-direction:column;gap:4px;padding:9px 11px;border-radius:10px;font-size:12.5px;line-height:1.7}
.ws-msg.user{align-self:flex-end;max-width:92%;background:var(--ws-surface2);border:1px solid var(--ws-border);color:var(--ws-text)}
.ws-msg.assistant{align-self:flex-start;max-width:96%;background:var(--ws-bg);border:1px solid var(--ws-border);color:var(--ws-text)}
.ws-msg.error{align-self:stretch;background:color-mix(in srgb,var(--ws-danger) 10%,transparent);border:1px solid var(--ws-danger);color:var(--ws-text)}
.ws-msg-body{white-space:pre-wrap;word-break:break-word}
.ws-msg-tags{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:2px}
.ws-msg-tag{font-size:10.5px;padding:1px 7px;border-radius:99px;background:var(--ws-surface2);color:var(--ws-muted);border:1px solid var(--ws-border)}
.ws-msg-model{font-size:10.5px;color:var(--ws-muted)}
.ws-msg.typing{flex-direction:row;align-items:center;gap:6px;color:var(--ws-muted)}
.ws-typing-dot{width:5px;height:5px;border-radius:50%;background:var(--ws-brand);animation:ws-pulse 1s ease-in-out infinite}
.ws-typing-dot:nth-child(2){animation-delay:.15s}
.ws-typing-dot:nth-child(3){animation-delay:.3s}
.ws-chat-compose-option{padding:8px 0 0;display:flex;flex-direction:column;gap:4px}
.ws-chat-compose{display:flex;flex-direction:column;gap:6px}
.ws-refining{position:absolute;left:16px;bottom:16px;z-index:55;display:flex;align-items:center;gap:6px;padding:7px 12px;border-radius:99px;border:1px solid var(--ws-border);background:var(--dsw-alias-bg-overlay);color:var(--ws-muted);font-size:11.5px;box-shadow:0 8px 22px rgba(0,0,0,.14)}
.ws-toasts{position:absolute;right:16px;top:64px;z-index:60;display:flex;flex-direction:column;gap:8px;pointer-events:none;max-width:min(420px,80%)}
.ws-toast{padding:9px 13px;border-radius:9px;background:#212226;color:#f0f0f0;font-size:12.5px;line-height:1.5;box-shadow:0 12px 30px rgba(0,0,0,.3);animation:ws-in .18s ease-out}
.ws-toast.success{background:#173d2b;color:#d8f5e5}
.ws-toast.error{background:#3d1a1a;color:#ffdede}
.ws-seg{display:inline-flex;padding:2px;border-radius:8px;background:var(--ws-surface2);border:1px solid var(--ws-border)}
.ws-seg button{height:24px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:var(--ws-muted);font:inherit;font-size:12px;cursor:pointer}
.ws-seg button.on{background:var(--ws-bg);color:var(--ws-text);box-shadow:0 1px 3px rgba(0,0,0,.12);font-weight:600}
.ws-narrow .ws-left{flex:1;max-width:none;border-right:0}
.ws-narrow.ws-view-preview .ws-right{display:none}
.ws-narrow .ws-right{position:absolute;right:0;top:0;bottom:0;width:min(360px,92%);flex:none;box-shadow:-12px 0 30px rgba(0,0,0,.18);z-index:25}
.ws-narrow.ws-view-write .ws-mid,.ws-narrow.ws-view-write .ws-right{display:none}
.ws-narrow.ws-view-preview .ws-left,.ws-narrow.ws-view-preview .ws-right{display:none}
.ws-narrow.ws-view-design .ws-left,.ws-narrow.ws-view-design .ws-mid{display:none}
.ws-narrow.ws-view-design .ws-right{position:static;flex:1;max-width:none;border-left:0}
.ws-narrow .ws-stage{padding:14px 10px}
.ws-narrow .ws-phone{width:min(410px,100%)}
.ws-narrow .ws-phone{max-height:calc(100% - 24px)}
.ws-narrow .ws-top{gap:6px;padding:0 10px;overflow-x:auto}
.ws-narrow .ws-brand span.ws-badge{display:none}
.ws-narrow .ws-title-input{font-size:14px}
@keyframes ws-pulse{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes ws-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}

/* ===== macOS 27 liquid-glass workbench ===== */
.ws-root{
  --ws-accent:#0A84FF;--ws-accent-ink:#FFFFFF;
  --ws-text:var(--dsw-alias-label-primary);
  --ws-muted:var(--dsw-alias-label-secondary);
  --ws-border:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);
  --ws-border2:color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent);
  --ws-hover:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent);
  --ws-glass:rgba(255,255,255,.96);
  --ws-glass-strong:#FFFFFF;
  --ws-bg:#FAFAFA;
  --ws-art:#8E8E93;
  --ws-surface:var(--ws-glass);--ws-surface2:var(--ws-glass-strong);
  --ws-brand:var(--ws-accent);
  --ws-engrave:var(--ws-border);
  --ws-shadow:0 14px 34px rgba(0,0,0,.06),0 1px 2px rgba(0,0,0,.05);
  --ws-inner:inset 0 1px 0 rgba(255,255,255,.34);
  position:relative;box-sizing:border-box;padding:10px;gap:10px;
  background:var(--ws-bg);color:var(--ws-text);
  font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','PingFang SC','Helvetica Neue',sans-serif;
}
.ws-root[data-skin="auto"][data-dark="true"]{
  --ws-text:#F5F5F7;--ws-muted:#A1A1A8;
  --ws-border:rgba(255,255,255,.12);--ws-border2:rgba(255,255,255,.2);
  --ws-hover:rgba(255,255,255,.08);
  --ws-glass:rgba(30,30,34,.92);--ws-glass-strong:#1C1C1F;
  --ws-bg:#0C0C0E;
  --ws-inner:inset 0 1px 0 rgba(255,255,255,.12);
  --ws-shadow:0 18px 42px rgba(0,0,0,.4),0 1px 3px rgba(0,0,0,.26);
}
.ws-root[data-skin="light"]{
  --ws-text:#1d1d1f;--ws-muted:#6e6e73;
  --ws-border:rgba(20,24,35,.10);--ws-border2:rgba(20,24,35,.18);
  --ws-hover:rgba(20,24,35,.05);
  --ws-glass:rgba(255,255,255,.96);--ws-glass-strong:#FFFFFF;
  --ws-bg:#F6F6F6;--ws-art:#8E8E93;
}
.ws-root[data-skin="dark"]{
  --ws-text:#F5F5F7;--ws-muted:#A1A1A8;
  --ws-border:rgba(255,255,255,.12);--ws-border2:rgba(255,255,255,.2);
  --ws-hover:rgba(255,255,255,.08);
  --ws-glass:rgba(30,30,34,.92);--ws-glass-strong:#1C1C1F;
  --ws-bg:#0C0C0E;--ws-art:#8E8E93;
  --ws-inner:inset 0 1px 0 rgba(255,255,255,.12);
  --ws-shadow:0 18px 42px rgba(0,0,0,.4),0 1px 3px rgba(0,0,0,.26);
}
.ws-root[data-skin="sand"]{
  --ws-text:#2b2620;--ws-muted:#7b7168;
  --ws-border:rgba(70,52,30,.13);--ws-border2:rgba(70,52,30,.22);
  --ws-hover:rgba(70,52,30,.06);
  --ws-glass:rgba(255,253,249,.96);--ws-glass-strong:#FFFDF9;
  --ws-bg:#F5F0E8;--ws-art:#9A8F80;
}
.ws-root::before{content:none}
.ws-top{position:relative;z-index:20}
.ws-body{position:relative;z-index:1}
.ws-top{
  height:56px;padding:0 12px;border:1px solid var(--ws-border);border-radius:18px;
  background:var(--ws-glass);backdrop-filter:blur(30px) saturate(180%);
  -webkit-backdrop-filter:blur(30px) saturate(180%);
  box-shadow:var(--ws-shadow),var(--ws-inner);
  padding-left:max(12px,calc(var(--dsh-frame-leading-clearance,0px) - 58px));
}
.ws-body{gap:10px}
.ws-left,.ws-mid,.ws-right{
  border:1px solid var(--ws-border);border-radius:18px;
  background:var(--ws-glass);backdrop-filter:blur(34px) saturate(180%);
  -webkit-backdrop-filter:blur(34px) saturate(180%);
  box-shadow:var(--ws-shadow),var(--ws-inner);
  overflow:hidden;
}
.ws-left{border-right:1px solid var(--ws-border)}
.ws-right{border-left:1px solid var(--ws-border)}
.ws-left-head{padding:12px 12px 6px}
.ws-doc-current{background:var(--ws-glass-strong);border:1px solid var(--ws-border);border-radius:11px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.ws-left-actions .ws-icon-btn{border-radius:10px}
.ws-toolbar{border-bottom:1px solid var(--ws-border);padding:4px 12px 8px}
.ws-tool{border-radius:9px;color:var(--ws-muted)}
.ws-tool:hover{background:var(--ws-hover);border-color:var(--ws-border);color:var(--ws-text)}
.ws-editor{background:transparent;color:var(--ws-text)}
.ws-title-input{border-radius:10px}
.ws-title-input:focus{background:var(--ws-glass-strong);border-color:var(--ws-border)}
.ws-title-hint{background:color-mix(in srgb,var(--ws-accent) 10%,transparent);color:var(--ws-muted);border-radius:9px}
.ws-left-foot{border-top:1px solid var(--ws-border);color:var(--ws-muted)}
.ws-mid{background:var(--ws-glass)}
.ws-stage{background:transparent}
.ws-mini-btn{height:24px;padding:0 10px;border-radius:8px;border:1px solid var(--ws-border);background:var(--ws-glass-strong);color:var(--ws-text);font:inherit;font-size:11.5px;cursor:pointer}
.ws-mini-btn:hover{border-color:var(--ws-border2)}
.ws-stage-bar{color:var(--ws-muted)}
.ws-stage-chip{background:var(--ws-glass-strong);border:1px solid var(--ws-border);box-shadow:0 1px 2px rgba(0,0,0,.04)}
.ws-right{background:var(--ws-glass)}
.ws-tabs{border-bottom:1px solid var(--ws-border);padding:12px 12px 10px;gap:4px}
.ws-tab{border-radius:10px;color:var(--ws-muted);height:30px}
.ws-tab:hover{background:var(--ws-hover);color:var(--ws-text)}
.ws-tab.on{background:var(--ws-glass-strong);border-color:var(--ws-border);color:var(--ws-text);box-shadow:0 4px 14px rgba(0,0,0,.07),var(--ws-inner)}
.ws-panel{padding:12px;background:transparent}
.ws-card,.ws-group{background:transparent}
.ws-card{background:var(--ws-glass-strong);border:1px solid var(--ws-border);border-radius:14px;box-shadow:0 2px 10px rgba(0,0,0,.05),var(--ws-inner)}
.ws-card-head{color:var(--ws-text)}
.ws-btn{
  height:32px;padding:0 13px;border-radius:11px;border:1px solid var(--ws-border);
  background:var(--ws-glass-strong);color:var(--ws-text);
  box-shadow:0 1px 2px rgba(0,0,0,.05),var(--ws-inner);
  backdrop-filter:blur(18px) saturate(160%);-webkit-backdrop-filter:blur(18px) saturate(160%);
}
.ws-btn:hover:not(:disabled){background:var(--ws-hover);border-color:var(--ws-border2);filter:none}
.ws-btn.primary{
  background:var(--ws-accent);border-color:color-mix(in srgb,var(--ws-accent) 70%,transparent);
  color:var(--ws-accent-ink);
  box-shadow:0 1px 2px rgba(0,0,0,.12),inset 0 1px 0 rgba(255,255,255,.18);
}
.ws-btn.primary:hover:not(:disabled){background:color-mix(in srgb,var(--ws-accent) 88%,#000);filter:none}
.ws-btn.solid{
  background:var(--ws-text);color:var(--ws-bg);border-color:transparent;
  box-shadow:0 1px 2px rgba(0,0,0,.16),inset 0 1px 0 rgba(255,255,255,.16);
}
.ws-btn.solid:hover:not(:disabled){background:color-mix(in srgb,var(--ws-text) 86%,var(--ws-accent));filter:none}
.ws-icon-btn{border-radius:10px;color:var(--ws-muted)}
.ws-icon-btn:hover:not(:disabled){background:var(--ws-hover);color:var(--ws-text)}
.ws-seg{background:color-mix(in srgb,var(--ws-text) 6%,transparent);border:1px solid var(--ws-border);border-radius:11px}
.ws-seg button{border-radius:9px}
.ws-seg button.on{background:var(--ws-glass-strong);color:var(--ws-text)}
.ws-input{
  background:color-mix(in srgb,var(--ws-text) 4%,transparent);border:1px solid var(--ws-border);
  border-radius:10px;color:var(--ws-text);
}
.ws-input:focus{border-color:var(--ws-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--ws-accent) 22%,transparent)}
.ws-theme{background:var(--ws-glass-strong);border:1px solid var(--ws-border);border-radius:13px;box-shadow:0 2px 8px rgba(0,0,0,.05)}
.ws-theme:hover{border-color:var(--ws-border2);box-shadow:0 6px 16px rgba(0,0,0,.08)}
.ws-theme.on{border-color:var(--ws-accent);box-shadow:0 0 0 1px var(--ws-accent) inset,0 2px 8px rgba(0,0,0,.06)}
.ws-theme-swatch{border-color:var(--ws-border)}
.ws-chip{background:var(--ws-glass-strong);border:1px solid var(--ws-border);border-radius:99px}
.ws-chip:hover{border-color:var(--ws-border2);background:var(--ws-hover)}
.ws-chip.on{background:var(--ws-accent);color:var(--ws-accent-ink);border-color:transparent;box-shadow:0 1px 2px rgba(0,0,0,.12)}
.ws-toggle-track{background:color-mix(in srgb,var(--ws-text) 16%,transparent)}
.ws-toggle-track.on{background:var(--ws-accent);box-shadow:0 2px 8px color-mix(in srgb,var(--ws-accent) 40%,transparent)}
.ws-slider-row input[type=range]{accent-color:var(--ws-accent)}
.ws-link{color:var(--ws-accent)}
.ws-menu,.ws-doc-menu,.ws-appearance{
  background:var(--ws-glass-strong);backdrop-filter:blur(36px) saturate(190%);
  -webkit-backdrop-filter:blur(36px) saturate(190%);
  border:1px solid var(--ws-border);border-radius:14px;
  box-shadow:0 30px 70px rgba(0,0,0,.22),0 2px 8px rgba(0,0,0,.1),var(--ws-inner);
}
.ws-doc-menu button,.ws-menu button{border-radius:9px}
.ws-doc-menu button:hover,.ws-menu button:hover{background:var(--ws-hover)}
.ws-refining{background:var(--ws-glass-strong);backdrop-filter:blur(20px) saturate(160%);border:1px solid var(--ws-border);box-shadow:0 12px 30px rgba(0,0,0,.16)}
.ws-steps,.ws-config{border-radius:12px;border-color:var(--ws-border);background:color-mix(in srgb,var(--ws-text) 3%,transparent)}
.ws-result,.ws-error{border-radius:12px}
.ws-empty{color:var(--ws-muted)}
.ws-brand svg{opacity:.9}
.ws-appearance{position:absolute;right:0;top:36px;z-index:50;width:256px;padding:12px}
.ws-appearance-head{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--ws-text);margin-bottom:10px}
.ws-skins{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.ws-skin{display:flex;flex-direction:column;gap:6px;padding:7px;border-radius:12px;border:1px solid var(--ws-border);background:var(--ws-glass-strong);cursor:pointer;text-align:left;font:inherit}
.ws-skin:hover{border-color:var(--ws-border2)}
.ws-skin.on{border-color:var(--ws-accent);box-shadow:0 0 0 1px var(--ws-accent) inset}
.ws-skin-preview{display:block;height:36px;border-radius:8px;border:1px solid var(--ws-border);background:#f4f4f6;position:relative;overflow:hidden}
.ws-skin-auto .ws-skin-preview{background:#f4f4f6}
.ws-skin-auto .ws-skin-preview::after{content:'';position:absolute;inset:0 0 0 50%;background:#202024}
.ws-skin-light .ws-skin-preview{background:#fbfbfd}
.ws-skin-dark .ws-skin-preview{background:#1e1e22}
.ws-skin-sand .ws-skin-preview{background:#efe6d6}
.ws-skin-text{display:flex;flex-direction:column;gap:1px;min-width:0}
.ws-skin-name{font-size:11.5px;font-weight:600;color:var(--ws-text)}
.ws-skin-hint{font-size:10px;color:var(--ws-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ws-appearance-sub{font-size:11px;color:var(--ws-muted);margin:12px 0 8px}
.ws-root[data-skin="dark"] .ws-toasts .ws-toast{background:#222329;color:#f2f2f4}
.ws-root[data-skin="sand"] .ws-toasts .ws-toast{background:#3a2f24;color:#fdf6ec}
.ws-root[data-skin="dark"] .ws-btn.solid{box-shadow:0 8px 20px rgba(0,0,0,.5)}
.ws-modal-scrim{position:absolute;inset:0;background:rgba(17,17,17,.32);z-index:80;display:flex;align-items:center;justify-content:center;padding:24px;border-radius:inherit}
.ws-modal{width:min(580px,100%);max-height:calc(100% - 32px);overflow:auto;background:var(--ws-surface);border:1px solid var(--ws-border);border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.28);padding:16px;display:flex;flex-direction:column;gap:12px}
.ws-modal-head{display:flex;align-items:center;gap:8px}
.ws-modal-head strong{font-size:14px;color:var(--ws-text);flex:1}
.ws-help-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.ws-help-section{border:1px solid var(--ws-border);border-radius:9px;padding:9px;background:var(--ws-surface2)}
.ws-help-section h4{margin:0 0 6px;font-size:12px;color:var(--ws-text)}
.ws-help-row{display:flex;gap:8px;font-size:11.5px;line-height:1.55;color:var(--ws-muted)}
.ws-help-key{flex:none;min-width:62px;color:var(--ws-text);font-family:ui-monospace,Menlo,monospace;font-size:11px}
.ws-modal-actions{display:flex;justify-content:flex-end;gap:8px}
@media (max-width: 700px){.ws-help-grid{grid-template-columns:1fr}}
.ws-surface-switch{display:flex;gap:2px;padding:2px;border:1px solid var(--ws-border);border-radius:7px;background:var(--ws-bg)}
.ws-surface-switch .ws-device-btn{border:0;background:transparent}
.ws-surface-switch .ws-device-btn.on{background:var(--ws-surface2);color:var(--ws-text);font-weight:600}
.ws-phone-surface{background:#f7f7f7;padding:0}
.ws-surface{min-height:100%;padding:14px 12px;display:flex;flex-direction:column;gap:10px;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;color:#1f1f1f}
.ws-surface-top{display:flex;align-items:center;justify-content:space-between;font-size:12px;color:#8a8a8a;padding:2px 2px 0}
.ws-surface-top strong{font-size:14px;color:#1f1f1f}
.ws-surface-cover{width:100%;height:150px;object-fit:cover;display:block;border-radius:8px;background:#e9e9e9}
.ws-surface-cover.empty{display:flex;align-items:center;justify-content:center;font-size:11px;color:#999}
.ws-feed-cover{position:relative;border-radius:8px;overflow:hidden}
.ws-feed-cover .ws-surface-cover{border-radius:0}
.ws-safe-guide{position:absolute;inset:10px;border:1px dashed rgba(255,255,255,.55);border-radius:4px;pointer-events:none;box-shadow:0 0 0 999px rgba(0,0,0,.04) inset}
.ws-feed-card{background:#fff;border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
.ws-feed-text{display:flex;flex-direction:column;gap:4px}
.ws-feed-title{font-size:15px;line-height:1.45;font-weight:600;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ws-feed-digest{font-size:12px;line-height:1.55;color:#8a8a8a;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}
.ws-feed-meta{font-size:10.5px;color:#b0b0b0}
.ws-feed-row{display:flex;gap:9px;background:#fff;border-radius:8px;padding:8px;opacity:.5}
.ws-feed-thumb{width:56px;height:42px;border-radius:4px;background:#e6e6e6;flex:none}
.ws-feed-skeleton{flex:1;display:flex;flex-direction:column;gap:5px;justify-content:center}
.ws-feed-skeleton i{display:block;height:7px;border-radius:3px;background:#e6e6e6;width:80%}
.ws-feed-skeleton i+i{width:55%}
.ws-chat-stamp{text-align:center;font-size:10px;color:#aaa;padding:6px 0}
.ws-share-card{background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);width:86%;margin:0 auto;display:flex;flex-direction:column}
.ws-share-cover{height:120px;overflow:hidden}
.ws-share-cover .ws-surface-cover{height:120px;border-radius:0;object-fit:cover}
.ws-share-copy{padding:9px 10px}
.ws-share-title{font-size:14px;line-height:1.45;font-weight:600;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ws-share-digest{font-size:11.5px;color:#8a8a8a;margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ws-share-meta{font-size:10.5px;color:#b0b0b0;margin-top:6px}
.ws-chat-tip{text-align:center;font-size:10.5px;color:#aaa;margin-top:4px}
.ws-searchbar-mock{display:flex;align-items:center;gap:8px;background:#ececec;border-radius:8px;padding:8px 10px;font-size:12px;color:#999}
.ws-searchbar-mock i{width:10px;height:10px;border:1.5px solid #999;border-radius:50%;display:block;margin-left:auto}
.ws-search-hit{background:#fff;border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:4px}
.ws-search-hit.muted{opacity:.45}
.ws-search-hit-title{font-size:14px;line-height:1.5;color:#2b2b2b;font-weight:600;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ws-search-hit-digest{font-size:11.5px;line-height:1.6;color:#888;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ws-search-hit-meta{font-size:10.5px;color:#b0b0b0}
.ws-surface-hints{display:flex;flex-wrap:wrap;gap:5px;padding:0 2px}
.ws-surface-hints span{font-size:10.5px;padding:3px 6px;border-radius:5px;background:var(--ws-warn-soft,#fff3d8);color:var(--ws-warn,#8a5a00);border:1px solid rgba(180,120,0,.12)}
@media (max-width: 1000px){
  .ws-root{padding:8px;gap:8px}
  .ws-top{height:52px;border-radius:16px}
  .ws-left,.ws-mid,.ws-right{border-radius:16px}
}
`
