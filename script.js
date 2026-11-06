(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var BULAN = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
  var BLN = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  var HARI_P = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
  var DOW = ["Sen","Sel","Rab","Kam","Jum","Sab","Min"];
  var FLOW_LABEL = { ringan: "ringan", sedang: "sedang", banyak: "banyak" };

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function fmt(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parse(s) { var p = s.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function diffDays(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
  function longDate(s) { var d = parse(s); return HARI_P[d.getDay()] + ", " + d.getDate() + " " + BULAN[d.getMonth()] + " " + d.getFullYear(); }
  function shortDate(s) { var d = parse(s); return d.getDate() + " " + BLN[d.getMonth()]; }
  function weekStart(d) { return addDays(d, -((d.getDay() + 6) % 7)); }
  function todayStr() { return fmt(new Date()); }
  function isDate(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  /* ---------- toast ---------- */
  var toastTimer = null;
  function toast(msg) {
    var t = $("#toast"); t.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.textContent = ""; }, 3500);
  }

  /* ---------- penyimpanan (per perangkat) ---------- */
  var KEY = "rematri.v1", SKEY = "rematri.session";
  var store = { accounts: [] };
  var memoryOnly = false;
  var memSession = null;
  var current = null;

  function loadStore() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) { var p = JSON.parse(raw); if (p && Array.isArray(p.accounts)) store = p; }
      localStorage.setItem(KEY + ".t", "1"); localStorage.removeItem(KEY + ".t");
    } catch (e) { memoryOnly = true; }
  }
  function saveStore() {
    if (memoryOnly) return;
    try { localStorage.setItem(KEY, JSON.stringify(store)); }
    catch (e) { memoryOnly = true; $("#mem-notice").hidden = false; }
  }
  function getSession() { try { return sessionStorage.getItem(SKEY) || memSession; } catch (e) { return memSession; } }
  function setSession(id) {
    memSession = id;
    try { if (id) sessionStorage.setItem(SKEY, id); else sessionStorage.removeItem(SKEY); } catch (e) {}
  }

  /* ---------- PIN ---------- */
  function newSalt() {
    var a = new Uint8Array(8);
    try { crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < 8; i++) a[i] = Math.floor(Math.random() * 256); }
    return Array.prototype.map.call(a, function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join("");
  }
  function newId() { return "a" + Date.now().toString(36) + newSalt().slice(0, 6); }
  function hashPin(pin, salt) {
    var text = salt + ":" + pin;
    function fallback() {
      var h = 2166136261;
      for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
      return "f" + (h >>> 0).toString(16);
    }
    try {
      if (window.crypto && crypto.subtle) {
        return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function (buf) {
          return Array.prototype.map.call(new Uint8Array(buf), function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join("");
        }, fallback);
      }
    } catch (e) {}
    return Promise.resolve(fallback());
  }

  /* ---------- navigasi ---------- */
  var VIEWS = ["beranda", "kenali", "cegah", "gizi", "bahaya", "skrining", "pantau"];
  function route() {
    var h = (location.hash || "").replace("#", "");
    if (VIEWS.indexOf(h) < 0) h = "beranda";
    VIEWS.forEach(function (v) { $("#v-" + v).hidden = v !== h; });
    $$("[data-nav]").forEach(function (a) {
      if (a.getAttribute("data-nav") === h) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    var title = { beranda: "Rematri Bebas Anemia" };
    window.scrollTo(0, 0);
    if (h === "pantau") renderPantau();
    if (h === "skrining") updateResultActions();
  }
  window.addEventListener("hashchange", route);

  /* ---------- skrining ---------- */
  var lastResult = null;
  function countChecked(name) { return $$('input[name="' + name + '"]:checked').length; }
  function levelOf(g, f, d) {
    if (d > 0) return { key: "hi", label: "Perlu pemeriksaan segera" };
    if (g >= 5 || (g >= 3 && f >= 3)) return { key: "hi", label: "Kemungkinan anemia tinggi" };
    if (g >= 2 || f >= 3) return { key: "mid", label: "Ada tanda yang mengarah ke anemia" };
    return { key: "lo", label: "Tanda anemia belum menonjol" };
  }
  var TEXTS = {
    hi: "Hasil ini bukan diagnosis. Periksakan kadar Hb ke puskesmas, UKS, atau fasilitas kesehatan dalam minggu ini. Sambil menunggu, makan lauk sumber zat besi dan minum TTD sesuai anjuran.",
    mid: "Periksakan Hb bila keluhan berlanjut sampai dua minggu. Mulai sekarang perbaiki asupan zat besi dan minum TTD secara teratur.",
    lo: "Tetap minum TTD rutin dan makan sumber zat besi. Ulangi skrining bila muncul keluhan baru."
  };
  function onQuiz(e) {
    e.preventDefault();
    var g = countChecked("g"), f = countChecked("f"), d = countChecked("d");
    var lv = levelOf(g, f, d);
    lastResult = { date: todayStr(), g: g, f: f, d: d, level: lv.key, label: lv.label, saved: false };
    var chip = $("#res-chip"); chip.textContent = lv.label; chip.className = "chip " + lv.key;
    $("#res-g").textContent = g + "/8"; $("#res-f").textContent = f + "/6";
    $("#res-text").textContent = d > 0 && lv.key === "hi" && g < 5 ? TEXTS.hi : TEXTS[lv.key];
    $("#res-danger").hidden = d === 0;
    var r = $("#result"); r.hidden = false;
    updateResultActions();
    r.scrollIntoView({ block: "nearest" }); r.focus({ preventScroll: true });
  }
  function updateResultActions() {
    var box = $("#res-actions"); if (!box) return;
    if (!lastResult) { box.innerHTML = ""; return; }
    if (current) {
      box.innerHTML = lastResult.saved
        ? '<span class="status-ok" style="font-weight:600">Tersimpan di akunmu.</span>'
        : '<button type="button" class="btn" id="btn-save-res">Simpan hasil ke akun saya</button>';
      var b = $("#btn-save-res"); if (b) b.addEventListener("click", saveResult);
    } else {
      box.innerHTML = '<a class="btn ghost" href="#pantau">Masuk untuk menyimpan hasil</a>';
    }
  }
  function saveResult() {
    if (!current || !lastResult || lastResult.saved) return;
    current.skrining.unshift({ date: lastResult.date, g: lastResult.g, f: lastResult.f, level: lastResult.level, label: lastResult.label, bahaya: lastResult.d > 0 });
    current.skrining = current.skrining.slice(0, 100);
    lastResult.saved = true; saveStore(); updateResultActions(); toast("Hasil skrining disimpan.");
  }

  /* ---------- akun ---------- */
  function showAuthTab(which) {
    var reg = which === "reg";
    $("#form-reg").hidden = !reg; $("#form-log").hidden = reg;
    $("#tab-reg").className = "btn" + (reg ? "" : " ghost"); $("#tab-log").className = "btn" + (reg ? " ghost" : "");
    $("#tab-reg").setAttribute("aria-selected", reg); $("#tab-log").setAttribute("aria-selected", !reg);
  }
  function fillAccounts() {
    var sel = $("#log-acc");
    sel.innerHTML = store.accounts.map(function (a) { return '<option value="' + esc(a.id) + '">' + esc(a.name) + (a.kelas ? " (" + esc(a.kelas) + ")" : "") + "</option>"; }).join("");
  }
  function readJson(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { try { res(JSON.parse(String(fr.result))); } catch (e) { rej(e); } };
      fr.onerror = function () { rej(fr.error); };
      fr.readAsText(file);
    });
  }
  function mergeInto(acc, data) {
    if (!data || data.app !== "rematri" || !data.account) throw new Error("bukan cadangan");
    var a = data.account, n = 0;
    if (a.ttd && typeof a.ttd === "object") Object.keys(a.ttd).forEach(function (k) { if (isDate(k) && a.ttd[k] === true) { acc.ttd[k] = true; n++; } });
    if (a.haid && typeof a.haid === "object") Object.keys(a.haid).forEach(function (k) { if (isDate(k) && FLOW_LABEL[a.haid[k]]) { acc.haid[k] = a.haid[k]; n++; } });
    if (Array.isArray(a.skrining)) a.skrining.slice(0, 100).forEach(function (s) {
      if (s && isDate(s.date) && typeof s.g === "number" && typeof s.f === "number" && ["hi", "mid", "lo"].indexOf(s.level) >= 0) {
        var dup = acc.skrining.some(function (x) { return x.date === s.date && x.g === s.g && x.f === s.f; });
        if (!dup) { acc.skrining.push({ date: s.date, g: s.g, f: s.f, level: s.level, label: String(s.label || "").slice(0, 60), bahaya: !!s.bahaya }); n++; }
      }
    });
    acc.skrining.sort(function (x, y) { return x.date < y.date ? 1 : -1; });
    acc.skrining = acc.skrining.slice(0, 100);
    return n;
  }
  function onRegister(e) {
    e.preventDefault();
    var err = $("#reg-err"); err.textContent = "";
    var name = $("#reg-name").value.trim(), kelas = $("#reg-kelas").value.trim(), pin = $("#reg-pin").value, pin2 = $("#reg-pin2").value;
    if (name.length < 2) { err.textContent = "Tulis nama panggilan minimal 2 huruf."; return; }
    if (!/^\d{4,6}$/.test(pin)) { err.textContent = "PIN harus 4 sampai 6 angka."; return; }
    if (pin !== pin2) { err.textContent = "Kedua PIN belum sama."; return; }
    if (store.accounts.some(function (a) { return a.name.toLowerCase() === name.toLowerCase(); })) { err.textContent = "Nama itu sudah dipakai di perangkat ini. Tambahkan inisial atau angka."; return; }
    var salt = newSalt();
    hashPin(pin, salt).then(function (hash) {
      var acc = { id: newId(), name: name, kelas: kelas, salt: salt, hash: hash, created: todayStr(), ttd: {}, haid: {}, skrining: [] };
      var f = $("#reg-file").files[0];
      var p = f ? readJson(f).then(function (d) { mergeInto(acc, d); }) : Promise.resolve();
      return p.then(function () {
        store.accounts.push(acc); saveStore(); doLogin(acc.id);
        $("#form-reg").reset();
        toast(f ? "Akun dibuat dan data cadangan dipulihkan." : "Akun dibuat. Selamat datang, " + name + ".");
      }, function () { err.textContent = "File cadangan tidak bisa dibaca. Kosongkan pilihan file atau pilih file yang benar."; });
    });
  }
  function onLogin(e) {
    e.preventDefault();
    var err = $("#log-err"); err.textContent = "";
    var acc = store.accounts.filter(function (a) { return a.id === $("#log-acc").value; })[0];
    if (!acc) { err.textContent = "Belum ada akun di perangkat ini. Buat akun dulu."; return; }
    hashPin($("#log-pin").value, acc.salt).then(function (h) {
      if (h !== acc.hash) { err.textContent = "PIN belum cocok. Coba lagi."; return; }
      $("#log-pin").value = ""; doLogin(acc.id);
    });
  }
  function doLogin(id) {
    current = store.accounts.filter(function (a) { return a.id === id; })[0] || null;
    setSession(current ? current.id : null);
    selected = todayStr(); var t = new Date(); view = { y: t.getFullYear(), m: t.getMonth() };
    renderPantau(); updateResultActions();
  }
  function doLogout() { current = null; setSession(null); renderPantau(); updateResultActions(); toast("Kamu sudah keluar."); }

  /* ---------- kalender & perhitungan ---------- */
  var view = { y: new Date().getFullYear(), m: new Date().getMonth() };
  var selected = todayStr();

  function periods(acc) {
    var ds = Object.keys(acc.haid).sort(), out = [];
    ds.forEach(function (d) {
      var last = out[out.length - 1];
      if (last && diffDays(last.end, d) <= 2) { last.end = d; last.days.push(d); }
      else out.push({ start: d, end: d, days: [d] });
    });
    out.forEach(function (p) {
      p.len = diffDays(p.start, p.end) + 1;
      p.banyak = p.days.filter(function (d) { return acc.haid[d] === "banyak"; }).length;
    });
    return out;
  }
  function cycleStats(acc) {
    var ps = periods(acc), cycles = [];
    for (var i = 1; i < ps.length; i++) cycles.push(diffDays(ps[i - 1].start, ps[i].start));
    var good = cycles.filter(function (c) { return c >= 15 && c <= 90; }).slice(-3);
    var avg = good.length ? Math.round(good.reduce(function (a, b) { return a + b; }, 0) / good.length) : null;
    var last = ps[ps.length - 1] || null;
    var next = null;
    if (last) next = fmt(addDays(parse(last.start), avg || 28));
    return { ps: ps, cycles: cycles, avg: avg, last: last, next: next };
  }

  function renderCalendar(focusDate) {
    var y = view.y, m = view.m, today = todayStr();
    $("#cal-title").textContent = BULAN[m] + " " + y;
    var first = new Date(y, m, 1), offset = (first.getDay() + 6) % 7, dim = new Date(y, m + 1, 0).getDate();
    var cs = cycleStats(current), html = DOW.map(function (d) { return '<div class="dow" aria-hidden="true">' + d + "</div>"; }).join("");
    for (var i = 0; i < offset; i++) html += "<div></div>";
    for (var d = 1; d <= dim; d++) {
      var ds = fmt(new Date(y, m, d)), flow = current.haid[ds], ttd = current.ttd[ds];
      var cls = "day" + (flow ? " haid f-" + flow : "") + (ds === today ? " today" : "") + (cs.next === ds && ds > today && !flow ? " pred" : "");
      var label = longDate(ds) + (flow ? ", haid " + flow : "") + (ttd ? ", sudah minum TTD" : "") + (cs.next === ds && ds > today ? ", perkiraan haid berikutnya" : "");
      html += '<button type="button" class="' + cls + '" data-date="' + ds + '" aria-pressed="' + (ds === selected) + '" aria-label="' + esc(label) + '"' + (ds > today ? " disabled" : "") + (ds === today ? ' aria-current="date"' : "") + '>' +
        '<span class="dn">' + d + '</span><span class="marks">' + (flow ? '<svg class="ic" aria-hidden="true"><use href="#i-drop"/></svg>' : "") + (ttd ? '<i class="caps"></i>' : "") + "</span></button>";
    }
    $("#cal-grid").innerHTML = html;
    var now = new Date();
    $("#cal-next").disabled = (y > now.getFullYear()) || (y === now.getFullYear() && m >= now.getMonth());
    $("#cal-prev").disabled = (now.getFullYear() * 12 + now.getMonth()) - (y * 12 + m) >= 36;
    if (focusDate) { var b = $('[data-date="' + focusDate + '"]', $("#cal-grid")); if (b) b.focus(); }
  }

  function renderEditor() {
    var ds = selected, future = ds > todayStr();
    $("#ed-date").textContent = longDate(ds);
    var on = !!current.ttd[ds], t = $("#ed-ttd");
    t.setAttribute("aria-pressed", on); t.disabled = future;
    $(".box", t).textContent = on ? "✓" : "";
    $("#ed-ttd-t").textContent = on ? "Sudah minum TTD" : "Tandai sudah minum TTD";
    var fl = current.haid[ds] || "";
    $$("#ed-flow button").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-flow") === fl); b.disabled = future; });
  }

  function renderSummary() {
    var today = new Date(), ts = fmt(today), ws = weekStart(today), cnt = 0, haidDays = 0, haidTaken = 0;
    for (var i = 0; i < 7; i++) {
      var d = fmt(addDays(ws, i));
      if (d > ts) break;
      if (current.ttd[d]) cnt++;
      if (current.haid[d]) { haidDays++; if (current.ttd[d]) haidTaken++; }
    }
    $("#st-ttd-big").innerHTML = '<span class="mono">' + cnt + "</span> tablet";
    var msg;
    if (current.haid[ts]) msg = current.ttd[ts] ? "Hari ini haid dan TTD sudah diminum. Lanjutkan setiap hari selama haid." : "Hari ini kamu haid. Minum 1 tablet TTD hari ini.";
    else if (cnt > 0) msg = "Target mingguan tercapai. Pilih hari yang sama setiap minggu agar tidak lupa.";
    else msg = "Minggu ini belum ada TTD. Pilih satu hari tetap, lalu tandai di kalender setelah minum.";
    if (haidDays > 0) msg += " Saat haid minggu ini: " + haidTaken + " dari " + haidDays + " hari.";
    $("#st-ttd-msg").textContent = msg;

    var wk = "", metCount = 0;
    for (var k = 7; k >= 0; k--) {
      var s = addDays(ws, -7 * k), c = 0;
      for (var j = 0; j < 7; j++) if (current.ttd[fmt(addDays(s, j))]) c++;
      var st = c > 0 ? "met" : (k === 0 ? "pend" : "miss");
      if (c > 0) metCount++;
      wk += '<div class="wk ' + st + '"><span class="wkb" aria-hidden="true">' + (st === "met" ? "✓" : st === "miss" ? "–" : "…") + "</span><span>" + pad(s.getDate()) + "/" + pad(s.getMonth() + 1) + '</span><span class="sr-only">' + (st === "met" ? "ada TTD" : st === "miss" ? "tidak ada TTD" : "minggu berjalan, belum ada TTD") + "</span></div>";
    }
    var w = $("#weeks"); w.innerHTML = wk; w.setAttribute("aria-label", "Kepatuhan TTD: " + metCount + " dari 8 minggu terakhir ada catatan");

    var cs = cycleStats(current), notes = [], big, cm;
    if (!cs.last) {
      big = "Belum ada catatan";
      cm = "Tandai hari haid di kalender. Setelah dua kali haid tercatat, siklusmu akan dihitung.";
    } else {
      var daysTo = diffDays(ts, cs.next);
      big = "Haid terakhir: " + shortDate(cs.last.start);
      cm = "Lama haid terakhir " + cs.last.len + " hari. ";
      cm += cs.avg ? "Rata-rata siklus " + cs.avg + " hari. " : "Perkiraan memakai siklus 28 hari karena baru ada satu catatan. ";
      if (daysTo > 0) cm += "Haid berikutnya diperkirakan " + shortDate(cs.next) + ", sekitar " + daysTo + " hari lagi.";
      else if (daysTo === 0) cm += "Haid diperkirakan mulai hari ini.";
      else cm += "Perkiraan haid sudah lewat " + (-daysTo) + " hari. Catat bila haid sudah mulai.";
      if (cs.last.len > 7 || cs.last.banyak >= 3) notes.push("Haid terakhir lama atau banyak. Haid seperti ini membuat tubuh kehilangan lebih banyak zat besi. Ceritakan ke guru UKS atau petugas puskesmas dan periksakan Hb.");
      var lastCycle = cs.cycles.length ? cs.cycles[cs.cycles.length - 1] : null;
      if (lastCycle !== null && (lastCycle < 21 || lastCycle > 45)) notes.push("Siklus terakhir " + lastCycle + " hari, di luar kisaran umum 21–45 hari pada remaja. Pantau beberapa bulan. Bila terulang, tanyakan ke petugas kesehatan.");
    }
    $("#st-cyc-big").textContent = big; $("#st-cyc-msg").textContent = cm;
    $("#st-notes").innerHTML = notes.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("");

    var h = current.skrining.slice(0, 5);
    $("#hist").innerHTML = h.length ? h.map(function (s) {
      return '<li><span class="mono">' + esc(shortDate(s.date)) + '</span><span class="chip ' + esc(s.level) + '">' + esc(s.label) + '</span><span class="hint">keluhan ' + s.g + "/8, risiko " + s.f + "/6</span></li>";
    }).join("") : '<li class="hint">Belum ada hasil tersimpan. Isi skrining, lalu simpan hasilnya ke akunmu.</li>';
  }

  function renderDash() {
    $("#dash-sub").textContent = current.kelas ? "Kelas " + current.kelas : "Akun pribadi";
    $("#dash-hello").textContent = "Halo, " + current.name;
    renderCalendar(); renderEditor(); renderSummary();
  }

  function renderPantau() {
    $("#mem-notice").hidden = !memoryOnly;
    if (!current) {
      $("#auth").hidden = false; $("#dash").hidden = true;
      fillAccounts();
      showAuthTab(store.accounts.length ? "log" : "reg");
    } else {
      $("#auth").hidden = true; $("#dash").hidden = false; renderDash();
    }
  }

  function afterChange(focusDate) { saveStore(); renderCalendar(focusDate); renderEditor(); renderSummary(); }

  /* ---------- cadangan ---------- */
  function backupJson() {
    return JSON.stringify({ app: "rematri", version: 1, exportedAt: todayStr(), account: { name: current.name, kelas: current.kelas, ttd: current.ttd, haid: current.haid, skrining: current.skrining } }, null, 2);
  }
  function showFallback(json) {
    $("#backup-text").value = json; $("#backup-fallback").hidden = false;
  }
  function doBackup() {
    var json = backupJson();
    if (!(window.claude && window.claude.use)) {
      try {
        var blob = new Blob([json], { type: "application/json" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url; a.download = "cadangan-rematri.json";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        toast("Cadangan diunduh.");
      } catch (err) { showFallback(json); }
      return;
    }
    var use = window.claude.use("downloads");
    use.then(function (dl) {
      if (!dl) { showFallback(json); return; }
      return dl.save({ filename: "cadangan-rematri.json", data: json }).then(function () { toast("Cadangan disimpan."); }, function (e) {
        if (e && e.code === "declined") { toast("Penyimpanan dibatalkan."); return; }
        showFallback(json);
      });
    }, function () { showFallback(json); });
  }
  function copyBackup() {
    var ta = $("#backup-text");
    function manual() { ta.focus(); ta.select(); toast("Teks terpilih. Salin dengan menu atau tombol salin perangkatmu."); }
    try { navigator.clipboard.writeText(ta.value).then(function () { toast("Teks disalin."); }, manual); } catch (e) { manual(); }
  }
  function doRestore(e) {
    var f = e.target.files[0]; if (!f) return;
    readJson(f).then(function (d) {
      var n = mergeInto(current, d); saveStore(); renderDash(); toast(n ? "Data cadangan digabungkan ke akunmu." : "File terbaca, tetapi tidak ada catatan baru.");
    }, function () { toast("File cadangan tidak bisa dibaca."); });
    e.target.value = "";
  }
  function doDelete() {
    store.accounts = store.accounts.filter(function (a) { return a.id !== current.id; });
    saveStore(); current = null; setSession(null); $("#del-confirm").hidden = true; renderPantau(); updateResultActions(); toast("Akun dihapus.");
  }

  /* ---------- pasang event ---------- */
  function init() {
    loadStore();
    var sid = getSession();
    if (sid) current = store.accounts.filter(function (a) { return a.id === sid; })[0] || null;

    $("#quiz").addEventListener("submit", onQuiz);
    $("#quiz-reset").addEventListener("click", function () {
      $("#quiz").reset(); $("#result").hidden = true; lastResult = null; window.scrollTo(0, 0);
    });

    $("#tab-reg").addEventListener("click", function () { showAuthTab("reg"); });
    $("#tab-log").addEventListener("click", function () { fillAccounts(); showAuthTab("log"); });
    $("#form-reg").addEventListener("submit", onRegister);
    $("#form-log").addEventListener("submit", onLogin);
    $("#btn-logout").addEventListener("click", doLogout);

    $("#cal-grid").addEventListener("click", function (e) {
      var b = e.target.closest("[data-date]"); if (!b || b.disabled) return;
      selected = b.getAttribute("data-date"); renderCalendar(selected); renderEditor();
    });
    $("#cal-prev").addEventListener("click", function () { view.m--; if (view.m < 0) { view.m = 11; view.y--; } renderCalendar(); });
    $("#cal-next").addEventListener("click", function () { view.m++; if (view.m > 11) { view.m = 0; view.y++; } renderCalendar(); });
    $("#ed-ttd").addEventListener("click", function () {
      if (selected > todayStr()) return;
      if (current.ttd[selected]) delete current.ttd[selected]; else current.ttd[selected] = true;
      afterChange();
    });
    $("#ed-flow").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-flow]"); if (!b || b.disabled || selected > todayStr()) return;
      var v = b.getAttribute("data-flow");
      if (v) current.haid[selected] = v; else delete current.haid[selected];
      afterChange();
    });

    $("#btn-backup").addEventListener("click", doBackup);
    $("#btn-copy").addEventListener("click", copyBackup);
    $("#file-restore").addEventListener("change", doRestore);
    $("#btn-del").addEventListener("click", function () { $("#del-confirm").hidden = false; });
    $("#btn-del-no").addEventListener("click", function () { $("#del-confirm").hidden = true; });
    $("#btn-del-yes").addEventListener("click", doDelete);

    $("#mem-notice").hidden = !memoryOnly;
    route();
  }
  init();
})();
