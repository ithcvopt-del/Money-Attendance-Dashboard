/**
 * db.js — แทนที่ Google Apps Script (Code.gs) ด้วย SQLite ที่รันในเบราว์เซอร์ (sql.js)
 *
 * - อ่านข้อมูลจากไฟล์ data/money.sqlite ในรีโป GitHub
 * - บันทึก/แก้ไขข้อมูล = แก้ไฟล์ SQLite แล้ว commit กลับเข้า GitHub ผ่าน GitHub API (ต้องตั้งค่า Token)
 * - รันบนเครื่อง (localhost ผ่าน tools/serve.py) จะบันทึกลงไฟล์ในเครื่องโดยตรง ไม่ต้องใช้ Token
 *
 * มี shim `google.script.run` ให้โค้ดหน้าเว็บเดิมทำงานได้โดยแทบไม่ต้องแก้
 */
(function () {
  'use strict';

  const SQLJS_BASE = 'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/';
  const DB_PATH = 'data/money.sqlite';
  const PICTURE_DIR = 'pictures';
  const CFG_KEY = 'money_github_config';

  const LEAVE_TYPES = [
    'Normal Working Day', 'Day off', 'Annual Leave', 'Sick Leave',
    'Missing Work', 'Holiday', 'Vacation Leave', 'Working on holidays'
  ];
  const SHIFTS = ['Day', 'Night', 'off'];
  const THAI_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

  const IS_LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  /* ---------------- config ---------------- */
  function detectRepo() {
    // https://<owner>.github.io/<repo>/...
    const m = location.hostname.match(/^([\w-]+)\.github\.io$/i);
    if (!m) return { owner: '', repo: '' };
    const seg = location.pathname.split('/').filter(Boolean)[0] || '';
    const isFile = /\.html?$/i.test(seg);
    return { owner: m[1], repo: (seg && !isFile) ? seg : (m[1] + '.github.io') };
  }

  function getConfig() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(CFG_KEY) || '{}') || {}; } catch (e) {}
    const auto = detectRepo();
    return {
      owner: saved.owner || auto.owner,
      repo: saved.repo || auto.repo,
      branch: saved.branch || 'main',
      token: saved.token || ''
    };
  }

  function saveConfig(cfg) {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {}
  }

  function hasGithubWrite(cfg) { return !!(cfg.owner && cfg.repo && cfg.token); }

  /* ---------------- helpers ---------------- */
  function bytesToBase64(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }
  function base64ToBytes(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve;
      s.onerror = function () { reject(new Error('โหลดไลบรารีไม่สำเร็จ: ' + src)); };
      document.head.appendChild(s);
    });
  }

  let sqlPromise = null;
  function getSQL() {
    if (!sqlPromise) {
      sqlPromise = loadScript(SQLJS_BASE + 'sql-wasm.js').then(function () {
        return window.initSqlJs({ locateFile: function (f) { return SQLJS_BASE + f; } });
      });
    }
    return sqlPromise;
  }

  /* ---------------- storage backends ---------------- */
  function ghHeaders(cfg, accept) {
    const h = { 'Accept': accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (cfg.token) h['Authorization'] = 'Bearer ' + cfg.token;
    return h;
  }
  function ghUrl(cfg, path) {
    return 'https://api.github.com/repos/' + encodeURIComponent(cfg.owner) + '/' +
      encodeURIComponent(cfg.repo) + '/contents/' + path.split('/').map(encodeURIComponent).join('/');
  }
  async function ghError(res) {
    let msg = '';
    try { msg = (await res.json()).message || ''; } catch (e) {}
    const err = new Error('GitHub API ' + res.status + (msg ? ': ' + msg : ''));
    err.status = res.status;
    return err;
  }

  /** อ่านไฟล์ฐานข้อมูล -> { bytes, sha } */
  async function readDb() {
    const cfg = getConfig();
    if (!IS_LOCAL && hasGithubWrite(cfg)) {
      // อ่านผ่าน API เพื่อให้ได้ข้อมูลล่าสุดทันที (GitHub Pages อาจ deploy ช้ากว่า ~1 นาที)
      const res = await fetch(ghUrl(cfg, DB_PATH) + '?ref=' + encodeURIComponent(cfg.branch) + '&t=' + Date.now(),
        { headers: ghHeaders(cfg, 'application/vnd.github.object'), cache: 'no-store' });
      if (!res.ok) throw await ghError(res);
      const meta = await res.json();
      let bytes;
      if (meta.content) {
        bytes = base64ToBytes(meta.content);
      } else { // ไฟล์ > 1MB
        const raw = await fetch(ghUrl(cfg, DB_PATH) + '?ref=' + encodeURIComponent(cfg.branch) + '&t=' + Date.now(),
          { headers: ghHeaders(cfg, 'application/vnd.github.raw'), cache: 'no-store' });
        if (!raw.ok) throw await ghError(raw);
        bytes = new Uint8Array(await raw.arrayBuffer());
      }
      return { bytes: bytes, sha: meta.sha };
    }
    const res = await fetch(DB_PATH + '?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('โหลดไฟล์ฐานข้อมูลไม่สำเร็จ (' + res.status + ')');
    return { bytes: new Uint8Array(await res.arrayBuffer()), sha: null };
  }

  async function writeFile(path, bytes, sha, message) {
    const cfg = getConfig();
    if (IS_LOCAL) {
      const res = await fetch(path, { method: 'PUT', body: bytes });
      if (!res.ok) throw new Error('บันทึกไฟล์ในเครื่องไม่สำเร็จ (' + res.status + ') — เปิดเว็บด้วย python tools/serve.py');
      return;
    }
    if (!hasGithubWrite(cfg)) {
      const err = new Error('ยังไม่ได้ตั้งค่า GitHub Token สำหรับบันทึกข้อมูล');
      err.needsConfig = true;
      throw err;
    }
    const body = { message: message, content: bytesToBase64(bytes), branch: cfg.branch };
    if (sha) body.sha = sha;
    const res = await fetch(ghUrl(cfg, path), {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders(cfg)),
      body: JSON.stringify(body)
    });
    if (!res.ok) throw await ghError(res);
  }

  /** เปิดฐานข้อมูลล่าสุด -> แก้ไขด้วย fn(db) -> เขียนกลับ (ลองใหม่อัตโนมัติถ้ามีคนอื่นบันทึกแทรก) */
  async function mutate(fn, message) {
    const SQL = await getSQL();
    for (let attempt = 0; attempt < 3; attempt++) {
      const cur = await readDb();
      const db = new SQL.Database(cur.bytes);
      let result;
      try {
        result = fn(db);
        const out = db.export();
        await writeFile(DB_PATH, out, cur.sha, message);
        return result;
      } catch (err) {
        if ((err.status === 409 || err.status === 422) && attempt < 2) continue;
        throw err;
      } finally {
        db.close();
      }
    }
  }

  async function query(sql, params) {
    const SQL = await getSQL();
    const cur = await readDb();
    const db = new SQL.Database(cur.bytes);
    try {
      const stmt = db.prepare(sql);
      if (params) stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    } finally {
      db.close();
    }
  }

  /* ---------------- date helpers (เหมือน parseRowDate ใน Code.gs) ---------------- */
  function parseIso(iso) {
    const p = String(iso || '').split('-');
    if (p.length !== 3) return null;
    const y = parseInt(p[0], 10), m = parseInt(p[1], 10), d = parseInt(p[2], 10);
    if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dd = ('0' + d).slice(-2), mm = ('0' + m).slice(-2);
    return {
      dateKey: y * 10000 + m * 100 + d,
      display: dd + '/' + mm + '/' + (y + 543),
      isoDate: y + '-' + mm + '-' + dd,
      dayOfWeek: THAI_DAYS[new Date(y, m - 1, d).getDay()]
    };
  }

  /* ---------------- API (ชื่อฟังก์ชันเดียวกับ Code.gs) ---------------- */
  const API = {
    getPageUrls: function () {
      return { dashboard: 'index.html', entry: 'form.html' };
    },

    getReportData: async function () {
      const rows = await query(
        'SELECT id, date, name, leave_type, shift, ot, picture FROM entries ORDER BY date, id');
      const data = [];
      const nameSet = {};
      rows.forEach(function (r) {
        const p = parseIso(r.date);
        if (!p) return;
        if (r.name) nameSet[r.name] = true;
        data.push({
          rowNumber: r.id,
          dateKey: p.dateKey,
          dateDisplay: p.display,
          isoDate: p.isoDate,
          dayOfWeek: p.dayOfWeek,
          name: r.name || '',
          leaveType: r.leave_type || '',
          shift: r.shift || '',
          ot: Number(r.ot) || 0,
          picture: r.picture || ''
        });
      });
      return {
        rows: data,
        totalRows: data.length,
        minDateDisplay: data.length ? data[0].dateDisplay : '',
        maxDateDisplay: data.length ? data[data.length - 1].dateDisplay : '',
        names: Object.keys(nameSet).sort()
      };
    },

    getSheetData: async function () { return (await API.getReportData()).rows; },
    getLeaveTypes: function () { return LEAVE_TYPES; },
    getShifts: function () { return SHIFTS; },
    getEmployeeNames: async function () { return (await API.getReportData()).names; },

    getFormInitData: async function () {
      let names = [];
      try { names = (await API.getReportData()).names; } catch (e) { /* ฟอร์มยังใช้งานได้ */ }
      return { names: names, leaveTypes: LEAVE_TYPES, shifts: SHIFTS };
    },

    getMyEntries: async function (name) {
      if (!name) return [];
      const rep = await API.getReportData();
      return rep.rows
        .filter(function (r) { return r.name === name; })
        .sort(function (a, b) { return b.dateKey - a.dateKey || b.rowNumber - a.rowNumber; })
        .slice(0, 60);
    },

    submitEntry: async function (entry) {
      if (!entry || !entry.date || !entry.name || !entry.leaveType || !entry.shift) {
        throw new Error('กรุณากรอกข้อมูลให้ครบ: Date, Name, Leave Type, Select Shift');
      }
      const p = parseIso(entry.date);
      if (!p) throw new Error('รูปแบบวันที่ไม่ถูกต้อง');

      let picture = entry.existingPicture || '';
      if (entry.pictureBase64) {
        try {
          const ext = ((entry.pictureFileName || '').match(/\.(\w{2,5})$/) || [, 'jpg'])[1].toLowerCase();
          const path = PICTURE_DIR + '/' + p.isoDate + '_' + Date.now() + '.' + ext;
          await writeFile(path, base64ToBytes(entry.pictureBase64), null, 'Add picture ' + path);
          picture = path;
        } catch (err) {
          if (err.needsConfig) throw err;
          // เหมือนเดิม: อัปโหลดรูปไม่สำเร็จ ให้บันทึกข้อมูลอื่นต่อได้
          console.warn('upload picture failed', err);
        }
      }

      const ot = Number(entry.ot) || 0;
      const rowNum = entry.rowNumber ? parseInt(entry.rowNumber, 10) : 0;
      const msg = (rowNum ? 'Edit ' : 'Add ') + p.display + ' ' + entry.name + ' (' + entry.leaveType + ')';

      return mutate(function (db) {
        if (rowNum) {
          db.run(
            "UPDATE entries SET date=?, name=?, leave_type=?, shift=?, ot=?, picture=?, updated_at=datetime('now') WHERE id=?",
            [p.isoDate, entry.name, entry.leaveType, entry.shift, ot, picture, rowNum]);
          if (db.getRowsModified() !== 1) throw new Error('ไม่พบแถวข้อมูลที่จะแก้ไข กรุณาลองใหม่อีกครั้ง');
          return { success: true, dateDisplay: p.display, updated: true, rowNumber: rowNum };
        }
        db.run('INSERT INTO entries(date, name, leave_type, shift, ot, picture) VALUES (?,?,?,?,?,?)',
          [p.isoDate, entry.name, entry.leaveType, entry.shift, ot, picture]);
        return { success: true, dateDisplay: p.display, updated: false };
      }, msg);
    }
  };

  /* ---------------- google.script.run shim ---------------- */
  function makeRunner(onOk, onFail) {
    return new Proxy({}, {
      get: function (_, prop) {
        if (prop === 'withSuccessHandler') return function (h) { return makeRunner(h, onFail); };
        if (prop === 'withFailureHandler') return function (h) { return makeRunner(onOk, h); };
        if (prop === 'withUserObject') return function () { return makeRunner(onOk, onFail); };
        return function () {
          const args = arguments;
          Promise.resolve()
            .then(function () {
              if (typeof API[prop] !== 'function') throw new Error('ไม่รู้จักฟังก์ชัน ' + String(prop));
              return API[prop].apply(null, args);
            })
            .then(function (r) {
              // คัดลอกผลลัพธ์แบบเดียวกับที่ Apps Script serialize ส่งกลับมา
              if (onOk) onOk(r === undefined ? r : JSON.parse(JSON.stringify(r)));
            }, function (err) {
              console.error(err);
              if (err && err.needsConfig) openSettings('กรุณาตั้งค่า GitHub ก่อนบันทึกข้อมูล');
              if (onFail) onFail(err instanceof Error ? err : new Error(String(err)));
            });
        };
      }
    });
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  Object.defineProperty(window.google.script, 'run', { get: function () { return makeRunner(null, null); } });

  /* ---------------- Settings dialog ---------------- */
  function openSettings(notice) {
    const cfg = getConfig();
    let ov = document.getElementById('ghSettingsOverlay');
    if (!ov) {
      const css = document.createElement('style');
      css.textContent =
        '#ghSettingsOverlay{position:fixed;inset:0;background:rgba(5,8,20,.65);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;font-family:Sarabun,"Segoe UI",Tahoma,sans-serif}' +
        '#ghSettingsOverlay .gs-card{background:#141a36;color:#f3f4f9;border:1px solid #2a3363;border-radius:18px;max-width:440px;width:100%;padding:22px;box-shadow:0 24px 60px -20px rgba(0,0,0,.7);max-height:92vh;overflow:auto}' +
        '#ghSettingsOverlay h3{margin:0 0 4px;font-size:17px}' +
        '#ghSettingsOverlay p{margin:0 0 14px;color:#8b93bd;font-size:13px;line-height:1.55}' +
        '#ghSettingsOverlay label{display:block;font-size:13px;font-weight:600;margin:12px 0 6px}' +
        '#ghSettingsOverlay input{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:1px solid #2a3363;background:#0d1330;color:#f3f4f9;font:inherit;font-size:14px}' +
        '#ghSettingsOverlay input:focus{outline:none;border-color:#4d7dfb;box-shadow:0 0 0 3px rgba(77,125,251,.25)}' +
        '#ghSettingsOverlay .gs-row{display:flex;gap:10px}#ghSettingsOverlay .gs-row>div{flex:1}' +
        '#ghSettingsOverlay .gs-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap}' +
        '#ghSettingsOverlay button{font:inherit;font-size:14px;font-weight:600;border-radius:999px;padding:9px 18px;cursor:pointer;border:1px solid #2a3363;background:#1b2350;color:#f3f4f9}' +
        '#ghSettingsOverlay button.primary{background:#4d7dfb;border-color:#4d7dfb}' +
        '#ghSettingsOverlay .gs-notice{background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.35);color:#fbbf24;border-radius:10px;padding:8px 12px;font-size:13px;margin-bottom:12px}' +
        '#ghSettingsOverlay .gs-status{font-size:13px;margin-top:12px;min-height:18px}' +
        '#ghSettingsOverlay a{color:#7ea2ff}';
      document.head.appendChild(css);
      ov = document.createElement('div');
      ov.id = 'ghSettingsOverlay';
      ov.innerHTML =
        '<div class="gs-card" role="dialog" aria-modal="true" aria-labelledby="gsTitle">' +
        '<h3 id="gsTitle">⚙️ ตั้งค่าการบันทึกข้อมูล (GitHub)</h3>' +
        '<div class="gs-notice" id="gsNotice" style="display:none"></div>' +
        '<p>ข้อมูลเก็บในไฟล์ <code>data/money.sqlite</code> ในรีโป GitHub การบันทึกจะ commit ไฟล์นี้ผ่าน GitHub API ' +
        'ใช้ <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Fine-grained token</a> ' +
        'ที่เลือกเฉพาะรีโปนี้ และให้สิทธิ์ <b>Contents: Read and write</b> — Token เก็บไว้ในเบราว์เซอร์เครื่องนี้เท่านั้น</p>' +
        '<div class="gs-row"><div><label for="gsOwner">Owner</label><input id="gsOwner" autocomplete="off"></div>' +
        '<div><label for="gsRepo">Repository</label><input id="gsRepo" autocomplete="off"></div></div>' +
        '<label for="gsBranch">Branch</label><input id="gsBranch" autocomplete="off">' +
        '<label for="gsToken">GitHub Token</label><input id="gsToken" type="password" autocomplete="off" placeholder="github_pat_...">' +
        '<div class="gs-status" id="gsStatus"></div>' +
        '<div class="gs-actions"><button type="button" id="gsClear">ล้าง Token</button>' +
        '<button type="button" id="gsTest">ทดสอบการเชื่อมต่อ</button>' +
        '<button type="button" id="gsClose">ปิด</button>' +
        '<button type="button" class="primary" id="gsSave">บันทึก</button></div></div>';
      document.body.appendChild(ov);
      ov.addEventListener('click', function (e) { if (e.target === ov) ov.style.display = 'none'; });
      const read = function () {
        return {
          owner: document.getElementById('gsOwner').value.trim(),
          repo: document.getElementById('gsRepo').value.trim(),
          branch: document.getElementById('gsBranch').value.trim() || 'main',
          token: document.getElementById('gsToken').value.trim()
        };
      };
      const status = function (t, ok) {
        const el = document.getElementById('gsStatus');
        el.textContent = t; el.style.color = ok === false ? '#f87171' : ok ? '#4ade80' : '#8b93bd';
      };
      document.getElementById('gsClose').onclick = function () { ov.style.display = 'none'; };
      document.getElementById('gsSave').onclick = function () {
        saveConfig(read()); status('บันทึกการตั้งค่าแล้ว ✅', true);
        setTimeout(function () { ov.style.display = 'none'; }, 600);
      };
      document.getElementById('gsClear').onclick = function () {
        document.getElementById('gsToken').value = ''; saveConfig(read()); status('ล้าง Token แล้ว');
      };
      document.getElementById('gsTest').onclick = async function () {
        const c = read();
        if (!c.owner || !c.repo || !c.token) { status('กรอก Owner, Repository และ Token ให้ครบ', false); return; }
        status('กำลังทดสอบ...');
        try {
          const res = await fetch('https://api.github.com/repos/' + encodeURIComponent(c.owner) + '/' + encodeURIComponent(c.repo),
            { headers: ghHeaders(c), cache: 'no-store' });
          if (!res.ok) throw await ghError(res);
          const info = await res.json();
          if (info.permissions && !info.permissions.push) throw new Error('Token นี้ไม่มีสิทธิ์เขียน (push) ในรีโปนี้');
          status('เชื่อมต่อสำเร็จ: ' + info.full_name + (info.private ? ' (private)' : ' (public)'), true);
        } catch (err) { status('เชื่อมต่อไม่สำเร็จ — ' + err.message, false); }
      };
    }
    document.getElementById('gsOwner').value = cfg.owner;
    document.getElementById('gsRepo').value = cfg.repo;
    document.getElementById('gsBranch').value = cfg.branch;
    document.getElementById('gsToken').value = cfg.token;
    document.getElementById('gsStatus').textContent = IS_LOCAL
      ? 'กำลังรันบนเครื่อง (localhost): บันทึกลงไฟล์ในเครื่องโดยตรง ไม่ต้องใช้ Token' : '';
    document.getElementById('gsStatus').style.color = '#8b93bd';
    const n = document.getElementById('gsNotice');
    n.style.display = notice ? 'block' : 'none';
    n.textContent = notice || '';
    ov.style.display = 'flex';
  }

  window.MoneyDB = { api: API, openSettings: openSettings, getConfig: getConfig, isLocal: IS_LOCAL };
  getSQL().catch(function () {}); // เริ่มโหลด sql.js ล่วงหน้า
})();
