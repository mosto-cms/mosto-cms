/**
 * The admin's stylesheet: one scoped string, no CSS framework and no web
 * fonts. Editorial and calm: ink on cream, generous space, one wine accent.
 * Every rule is under `.mc-root`, which covers the whole viewport, so the
 * site's own layout and styles never leak into the admin.
 */
export const ADMIN_CSS = `
.mc-root{--ink:#1a1714;--ink-2:#3d3730;--muted:#665e53;--line:#e3dbcc;--line-2:#d3c9b6;--cream:#f2ece0;--paper:#faf7f1;--white:#fffdf9;--accent:#8f2437;--accent-soft:#f6e7e8;--ok:#2d6a4f;--warn-bg:#fbefdf;--warn:#6f3a09;--danger:#9b2226;--danger-bg:#fbeaea;--focus:#8f2437;
  --serif:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif;
  --sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;background:var(--paper);color:var(--ink);font:15px/1.55 var(--sans);-webkit-font-smoothing:antialiased;text-align:left;overflow:hidden}
.mc-root :where(*,*::before,*::after){box-sizing:border-box}
.mc-root :where(h1,h2,h3,p){margin:0}
.mc-root :where(button,input,textarea,select){font:inherit;color:inherit}
.mc-root :where(:focus){outline:none}
.mc-root :focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.mc-sr{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.mc-serif{font-family:var(--serif);font-weight:500;letter-spacing:-.005em}
.mc-muted{color:var(--muted)}
.mc-small{font-size:13px}

/* buttons */
.mc-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;padding:8px 16px;border-radius:6px;border:1px solid var(--line-2);background:var(--white);color:var(--ink);font-weight:500;cursor:pointer;white-space:nowrap;text-decoration:none;transition:background .15s,border-color .15s}
.mc-btn:hover{border-color:var(--ink-2)}
.mc-btn:disabled{opacity:.45;cursor:not-allowed}
.mc-btn-primary{background:var(--ink);border-color:var(--ink);color:var(--cream)}
.mc-btn-primary:hover{background:#000;border-color:#000}
.mc-btn-primary:disabled{background:var(--cream);border-color:var(--line-2);color:var(--muted);opacity:1}
.mc-btn-quiet{border-color:transparent;background:transparent;color:var(--ink-2);padding:8px 10px}
.mc-btn-quiet:hover{border-color:transparent;background:var(--cream)}
.mc-btn-danger{color:var(--danger)}
.mc-btn-small{min-height:32px;padding:4px 10px;font-size:13px}
.mc-badge{display:inline-flex;min-width:20px;height:20px;padding:0 6px;align-items:center;justify-content:center;border-radius:999px;background:var(--accent);color:#fff;font-size:12px;font-weight:600}
.mc-link{color:inherit;text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--line-2)}
.mc-link:hover{text-decoration-color:currentColor}

/* header */
.mc-header{display:flex;align-items:center;gap:24px;padding:12px 24px;border-bottom:1px solid var(--line);background:var(--paper);flex:none}
.mc-brand{display:flex;flex-direction:column;min-width:0}
.mc-brand-name{font-family:var(--serif);font-size:20px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:32vw}
.mc-brand-sub{font-size:12px;color:var(--muted);letter-spacing:.04em;text-transform:uppercase}
.mc-tabs{display:flex;gap:4px;margin:0 auto 0 8px}
.mc-tab{position:relative;border:0;background:transparent;padding:10px 12px;cursor:pointer;color:var(--muted);font-weight:500;border-radius:6px}
.mc-tab:hover{color:var(--ink);background:var(--cream)}
.mc-tab[aria-selected="true"]{color:var(--ink)}
.mc-tab[aria-selected="true"]::after{content:"";position:absolute;left:12px;right:12px;bottom:2px;height:2px;background:var(--ink);border-radius:2px}
.mc-actions{display:flex;align-items:center;gap:8px;margin-left:auto}
.mc-pending{font-size:13px;color:var(--accent);font-weight:500;white-space:nowrap}
.mc-avatar{width:40px;height:40px;border-radius:999px;border:1px solid var(--line-2);background:var(--cream);font-weight:600;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.mc-menu-wrap{position:relative}
.mc-menu{position:absolute;right:0;top:48px;width:280px;background:var(--white);border:1px solid var(--line);border-radius:10px;box-shadow:0 12px 40px rgba(26,23,20,.12);padding:16px;z-index:5;display:flex;flex-direction:column;gap:14px}
.mc-menu-section{display:flex;flex-direction:column;gap:6px}
.mc-menu-label{font-size:12px;color:var(--muted);letter-spacing:.04em;text-transform:uppercase}
.mc-seg{display:flex;border:1px solid var(--line-2);border-radius:6px;overflow:hidden}
.mc-seg button{flex:1;border:0;background:transparent;padding:8px;cursor:pointer}
.mc-seg button[aria-pressed="true"]{background:var(--ink);color:var(--cream)}

/* main areas */
.mc-main{flex:1;min-height:0;display:flex;position:relative}
.mc-visual{flex:1;display:grid;grid-template-columns:minmax(0,1fr) 400px;min-height:0}
.mc-stage{display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--cream)}
.mc-toolbar{display:flex;align-items:center;gap:8px;padding:10px 16px;flex:none;flex-wrap:wrap}
.mc-toolbar select{min-height:36px;border:1px solid var(--line-2);border-radius:6px;background:var(--white);padding:4px 8px;max-width:240px}
.mc-frame-wrap{flex:1;min-height:0;padding:0 16px 16px;display:flex;justify-content:center}
.mc-frame{width:100%;height:100%;border:1px solid var(--line);border-radius:8px;background:#fff;box-shadow:0 1px 2px rgba(26,23,20,.06),0 8px 30px rgba(26,23,20,.06);transition:max-width .25s}
.mc-frame-phone{max-width:390px}
.mc-panel{border-left:1px solid var(--line);background:var(--paper);overflow:auto;padding:28px 28px 40px;display:flex;flex-direction:column;gap:20px;min-height:0}
.mc-panel-empty{display:flex;flex-direction:column;gap:10px;margin-top:24px}
.mc-panel-empty h2{font-family:var(--serif);font-size:24px;line-height:1.25;font-weight:500}
.mc-sheet-handle{display:none}
.mc-hint{display:none}
.mc-modes{display:flex;border:1px solid var(--line-2);border-radius:999px;padding:2px;background:var(--white);gap:2px}
.mc-modes button{border:0;background:transparent;border-radius:999px;padding:6px 14px;cursor:pointer;font:inherit;font-size:14px;color:var(--ink);display:inline-flex;align-items:center;gap:6px}
.mc-modes button[aria-pressed="true"]{background:var(--ink);color:var(--cream)}
.mc-modes button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.mc-kbd{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 4px;border:1px solid var(--line-2);border-radius:4px;font-size:11px;line-height:1;color:var(--muted);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.mc-tip{margin-top:12px;font-size:13px}

/* fields */
.mc-eyebrow{font-size:12px;color:var(--muted);letter-spacing:.05em;text-transform:uppercase}
.mc-field{display:flex;flex-direction:column;gap:8px}
.mc-field-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.mc-label{font-weight:600;font-size:14px}
.mc-desc{font-size:13px;color:var(--muted)}
.mc-input,.mc-textarea{width:100%;border:1px solid var(--line-2);border-radius:6px;background:var(--white);padding:10px 12px;font-size:16px;line-height:1.45;transition:border-color .15s,box-shadow .15s}
.mc-textarea{resize:vertical;min-height:88px}
.mc-input:focus,.mc-textarea:focus{border-color:var(--ink);box-shadow:0 0 0 3px rgba(143,36,55,.18)}
.mc-input:focus-visible,.mc-textarea:focus-visible{outline:none}
.mc-input[aria-invalid="true"],.mc-textarea[aria-invalid="true"]{border-color:var(--danger)}
.mc-count{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
.mc-count-over{color:var(--danger);font-weight:600}
.mc-field-error{font-size:13px;color:var(--danger)}
.mc-dirty{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--accent);font-weight:500}
.mc-dirty::before{content:"";width:6px;height:6px;border-radius:99px;background:var(--accent)}
.mc-locale{display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:20px;padding:0 6px;border-radius:4px;background:var(--cream);border:1px solid var(--line);font-size:11px;font-weight:600;letter-spacing:.05em;color:var(--ink-2)}
.mc-media{display:flex;flex-direction:column;gap:10px}
.mc-thumb{width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:6px;border:1px solid var(--line);background:var(--cream);display:block}
.mc-thumb-empty{display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:13px}
.mc-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.mc-list{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}
.mc-list-item{display:flex;gap:6px;align-items:center}
.mc-list-item .mc-input{flex:1}
.mc-icon-btn{width:36px;height:36px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--line-2);border-radius:6px;background:var(--white);cursor:pointer;flex:none;font-size:15px;line-height:1}
.mc-icon-btn:disabled{opacity:.35;cursor:not-allowed}
.mc-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px;margin:0;padding:0;list-style:none}
.mc-gallery-item{display:flex;flex-direction:column;gap:6px}
.mc-gallery-item .mc-thumb{aspect-ratio:1}
.mc-progress{font-size:13px;color:var(--muted)}
details.mc-details summary{cursor:pointer;font-size:13px;color:var(--muted)}
.mc-siblings{display:flex;flex-direction:column;gap:18px;padding-top:18px;border-top:1px solid var(--line)}

/* notices */
.mc-notice{display:flex;flex-direction:column;gap:10px;padding:14px 16px;border-radius:8px;background:var(--warn-bg);color:var(--warn);font-size:14px}
.mc-notice-error{background:var(--danger-bg);color:var(--danger)}
.mc-notice .mc-row{gap:8px}
.mc-toast-zone{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:10;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;width:min(560px,calc(100vw - 32px))}
.mc-toast{pointer-events:auto;background:var(--ink);color:var(--cream);border-radius:8px;padding:12px 16px;font-size:14px;box-shadow:0 8px 30px rgba(0,0,0,.18)}

/* forms mode */
.mc-forms{flex:1;display:grid;grid-template-columns:280px minmax(0,1fr);min-height:0}
.mc-nav{border-right:1px solid var(--line);overflow:auto;padding:24px 16px;display:flex;flex-direction:column;gap:20px;background:var(--paper)}
.mc-nav-group{display:flex;flex-direction:column;gap:2px}
.mc-nav-title{font-size:12px;color:var(--muted);letter-spacing:.05em;text-transform:uppercase;padding:0 10px 6px}
.mc-nav-item{display:flex;justify-content:space-between;gap:8px;text-align:left;border:0;background:transparent;padding:9px 10px;border-radius:6px;cursor:pointer;color:var(--ink-2)}
.mc-nav-item:hover{background:var(--cream)}
.mc-nav-item[aria-current="true"]{background:var(--cream);color:var(--ink);font-weight:600}
.mc-nav-sub{padding-left:12px;border-left:1px solid var(--line);margin-left:12px;display:flex;flex-direction:column;gap:2px}
.mc-content{overflow:auto;padding:40px 48px 120px}
.mc-content-inner{max-width:960px;margin:0 auto;display:flex;flex-direction:column;gap:32px}
.mc-page-title{font-family:var(--serif);font-size:32px;line-height:1.15;font-weight:500}
.mc-form-row{display:grid;gap:20px;padding-top:24px;border-top:1px solid var(--line)}
.mc-form-row:first-child{border-top:0;padding-top:0}
.mc-cols{display:grid;gap:20px;grid-template-columns:repeat(var(--cols,1),minmax(0,1fr))}

/* history */
.mc-history{flex:1;overflow:auto;padding:40px 24px 120px}
.mc-history-inner{max-width:760px;margin:0 auto;display:flex;flex-direction:column;gap:24px}
.mc-timeline{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.mc-event{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 16px;padding:18px 0;border-top:1px solid var(--line)}
.mc-event-title{font-weight:600}
.mc-event-meta{font-size:13px;color:var(--muted)}
.mc-event-actions{grid-row:span 2;align-self:center;display:flex;gap:8px}
.mc-event-confirm{grid-column:1/-1}

/* login */
.mc-login{flex:1;overflow:auto;display:flex;align-items:center;justify-content:center;padding:32px 20px;background:var(--cream)}
.mc-login-card{width:min(440px,100%);background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:40px 36px;display:flex;flex-direction:column;gap:20px;box-shadow:0 20px 60px rgba(26,23,20,.08)}
.mc-login-card h1{font-family:var(--serif);font-size:30px;line-height:1.15;font-weight:500}
.mc-password{position:relative}
.mc-password .mc-input{padding-right:84px}
.mc-password button{position:absolute;right:6px;top:50%;transform:translateY(-50%)}
.mc-footer-line{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:13px;color:var(--muted)}
.mc-powered{font-size:12px;color:var(--muted);text-decoration:none}
.mc-powered:hover{color:var(--ink);text-decoration:underline}
.mc-center{flex:1;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}
.mc-spinner{width:18px;height:18px;border-radius:99px;border:2px solid var(--line-2);border-top-color:var(--ink);animation:mc-spin .8s linear infinite;display:inline-block}
@keyframes mc-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.mc-root *{animation-duration:0s!important;transition:none!important}}

/* phones and small tablets */
@media (max-width:820px){
  .mc-header{flex-wrap:wrap;gap:10px 12px;padding:10px 14px}
  .mc-brand-name{font-size:18px;max-width:46vw}
  .mc-brand-sub{display:none}
  .mc-tabs{order:3;width:100%;margin:0;justify-content:space-between;border-top:1px solid var(--line);padding-top:6px}
  .mc-tab{flex:1;padding:10px 4px;font-size:14px}
  .mc-pending,.mc-discard{display:none}
  .mc-actions{flex-wrap:nowrap}
  .mc-visual{grid-template-columns:minmax(0,1fr)}
  .mc-toolbar{padding:8px 10px}
  .mc-toolbar .mc-device{display:none}
  .mc-frame-wrap{padding:0}
  .mc-frame{border-radius:0;border-left:0;border-right:0;box-shadow:none}
  .mc-frame-phone{max-width:none}
  .mc-panel{position:fixed;left:0;right:0;bottom:0;max-height:78vh;border-left:0;border-top:1px solid var(--line);border-radius:16px 16px 0 0;box-shadow:0 -12px 40px rgba(26,23,20,.16);padding:12px 18px calc(24px + env(safe-area-inset-bottom));transform:translateY(105%);transition:transform .25s ease;z-index:4}
  .mc-panel-open{transform:none}
  .mc-sheet-handle{display:block;width:40px;height:4px;border-radius:99px;background:var(--line-2);margin:0 auto 4px;flex:none}
  .mc-hint{display:block;pointer-events:none;position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));background:var(--ink);color:var(--cream);border-radius:10px;padding:12px 14px;font-size:14px;z-index:3;box-shadow:0 8px 30px rgba(0,0,0,.18)}
  .mc-forms{grid-template-columns:minmax(0,1fr)}
  .mc-forms .mc-nav{border-right:0;padding:16px 14px}
  .mc-forms-detail .mc-nav{display:none}
  .mc-forms-list .mc-content{display:none}
  .mc-content{padding:20px 16px 120px}
  .mc-page-title{font-size:26px}
  .mc-cols{grid-template-columns:minmax(0,1fr)}
  .mc-history{padding:20px 16px 120px}
  .mc-event{grid-template-columns:minmax(0,1fr)}
  .mc-event-actions{grid-row:auto}
  .mc-login-card{padding:28px 22px}
  .mc-toast-zone{top:calc(10px + env(safe-area-inset-top));bottom:auto}
}
`;
