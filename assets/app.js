"use strict";

/* ---------------------------------------------------------------------------
   KontoKonverter - clientseitiger Konverter: CAMT.053 -> MT940.
   Verarbeitung ausschliesslich im Browser, keine Datei verlaesst das Geraet.
--------------------------------------------------------------------------- */

const CONFIG = {
  counterBase: "https://api.counterapi.dev/v1/kontokonverter",
  signupEndpoint: "https://formsubmit.co/ajax/6gze8r4md17w@web-library.net",
  demoUrl: "samples/camt053_sample.xml",
  freeDatevLimit: 10,      // gratis: bis zu 10 Buchungen je DATEV-Export
  payUrl: ""               // Bezahllink (gesetzt, sobald Zahlungs-Account steht)
};

/* einfache, serverlose Lizenzschluessel-Pruefung (Format KK-XXXX-XXXX-PP, PP=Pruefsumme).
   Schwacher Schutz (clientseitig), aber ausreichend fuer dieses Preissegment; spaeter haertbar. */
function licenseValid(key) {
  key = String(key || "").trim().toUpperCase();
  const m = key.match(/^KK-([A-Z0-9]{4})-([A-Z0-9]{4})-(\d{2})$/);
  if (!m) return false;
  const body = "KK-" + m[1] + "-" + m[2];
  let h = 7;
  for (let i = 0; i < body.length; i++) h = (h * 31 + body.charCodeAt(i)) % 100;
  return String(h).padStart(2, "0") === m[3];
}
function isLicensed() { try { return licenseValid(localStorage.getItem("kk_license")); } catch (e) { return false; } }

/* ---------- namespace-toleranter XML-Zugriff ---------- */
const lname = (el) => (el.localName || el.tagName || "").replace(/^.*:/, "");
function firstDesc(node, name) {
  if (!node) return null;
  const stack = [...node.children];
  while (stack.length) { const el = stack.shift(); if (lname(el) === name) return el; for (const c of el.children) stack.push(c); }
  return null;
}
function allDesc(node, name) {
  const out = []; if (!node) return out;
  const walk = (n) => { for (const c of n.children) { if (lname(c) === name) out.push(c); walk(c); } };
  walk(node); return out;
}
function directChildren(node, name) { const o = []; if (!node) return o; for (const c of node.children) if (lname(c) === name) o.push(c); return o; }
function directChild(node, name) { const a = directChildren(node, name); return a.length ? a[0] : null; }
const txt = (el) => (el && el.textContent ? el.textContent.trim() : "");
const childTxt = (node, name) => txt(directChild(node, name));
const descTxt = (node, name) => txt(firstDesc(node, name));

/* ---------- CAMT.053 Parser ---------- */
function parseCamt(xmlString) {
  const doc = new DOMParser().parseFromString(xmlString, "application/xml");
  if (doc.querySelector && doc.querySelector("parsererror")) throw new Error("Die Datei ist kein gültiges XML.");
  const root = doc.documentElement;
  if (!firstDesc(root, "BkToCstmrStmt") && lname(root) !== "Document") {
    throw new Error("Das ist keine CAMT.053-Datei (Bank-zu-Kunde-Kontoauszug). Erkannt wird camt.053.001.02/08.");
  }
  const stmts = allDesc(root, "Stmt");
  if (!stmts.length) throw new Error("Keine Kontoauszug-Daten (Stmt) in der Datei gefunden.");

  const out = [];
  for (const stmt of stmts) {
    const acct = firstDesc(stmt, "Acct");
    const acctId = firstDesc(acct, "Id");
    let iban = acctId ? childTxt(acctId, "IBAN") : "";
    if (!iban && acctId) { const othr = firstDesc(acctId, "Othr"); iban = othr ? childTxt(othr, "Id") : ""; }
    const ccy = acct ? (childTxt(acct, "Ccy") || "") : "";
    const owner = descTxt(firstDesc(acct, "Ownr"), "Nm") || "";

    const balances = { open: null, close: null };
    for (const bal of allDesc(stmt, "Bal")) {
      const code = descTxt(firstDesc(bal, "Tp"), "Cd") || "";
      const amtEl = firstDesc(bal, "Amt");
      const b = {
        amount: parseFloat(txt(amtEl) || "0"),
        ccy: amtEl ? amtEl.getAttribute("Ccy") || ccy : ccy,
        sign: childTxt(bal, "CdtDbtInd") === "DBIT" ? "D" : "C",
        date: descTxt(firstDesc(bal, "Dt"), "Dt") || ""
      };
      if (["OPBD", "PRCD"].includes(code) && !balances.open) balances.open = b;
      if (["CLBD", "CLAV"].includes(code)) balances.close = b;
    }

    const entries = [];
    for (const ntry of allDesc(stmt, "Ntry")) {
      const amtEl = firstDesc(ntry, "Amt");
      const sign = childTxt(ntry, "CdtDbtInd") === "DBIT" ? "D" : "C";
      const bookg = descTxt(firstDesc(ntry, "BookgDt"), "Dt") || descTxt(firstDesc(ntry, "BookgDt"), "DtTm") || "";
      const val = descTxt(firstDesc(ntry, "ValDt"), "Dt") || descTxt(firstDesc(ntry, "ValDt"), "DtTm") || "";
      const ustrd = allDesc(ntry, "Ustrd").map(txt).filter(Boolean);
      // Gegenpartei: bei Gutschrift Debitor, bei Belastung Kreditor
      const rel = firstDesc(ntry, "RltdPties");
      let counterparty = "";
      if (rel) {
        const pick = sign === "C" ? (firstDesc(rel, "Dbtr") || firstDesc(rel, "Cdtr")) : (firstDesc(rel, "Cdtr") || firstDesc(rel, "Dbtr"));
        counterparty = pick ? childTxt(pick, "Nm") : "";
      }
      const addtl = childTxt(ntry, "AddtlNtryInf") || "";
      entries.push({
        date: bookg || val, valDate: val || bookg,
        amount: parseFloat(txt(amtEl) || "0"), sign,
        ccy: amtEl ? amtEl.getAttribute("Ccy") || ccy : ccy,
        remittance: ustrd.join(" "), counterparty, info: addtl
      });
    }
    out.push({
      iban, ccy, owner,
      statementId: childTxt(stmt, "Id") || "",
      fromDt: descTxt(firstDesc(stmt, "FrToDt"), "FrDtTm") || "",
      toDt: descTxt(firstDesc(stmt, "FrToDt"), "ToDtTm") || "",
      balances, entries
    });
  }
  return out;
}

/* ---------- MT940 Writer ---------- */
function n2(v) { return Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/,/g, "").replace(".", ","); }
function yymmdd(d) { const m = String(d || "").match(/(\d{4})-(\d{2})-(\d{2})/); return m ? m[1].slice(2) + m[2] + m[3] : ""; }
function mmdd(d) { const m = String(d || "").match(/(\d{4})-(\d{2})-(\d{2})/); return m ? m[2] + m[3] : ""; }

function field86(e) {
  // strukturiertes SWIFT-Feld 86 (deutsche Konvention): ?20-?29 Verwendungszweck, ?32 Name
  let s = "999";
  const purpose = (e.remittance || e.info || "").replace(/\s+/g, " ").trim();
  let pi = 20;
  for (let i = 0; i < purpose.length && pi <= 29; i += 27, pi++) s += "?" + pi + purpose.substr(i, 27);
  if (e.counterparty) s += "?32" + e.counterparty.substr(0, 27);
  return ":86:" + s;
}

function toMT940(stmt) {
  const L = [];
  const acct = stmt.iban || "KONTO";
  L.push(":20:" + (stmt.statementId || "KONTOAUSZUG").substr(0, 16));
  L.push(":25:" + acct);
  L.push(":28C:1/1");
  if (stmt.balances.open) {
    const b = stmt.balances.open;
    L.push(":60F:" + b.sign + (yymmdd(b.date) || yymmdd(stmt.fromDt)) + (b.ccy || stmt.ccy) + n2(b.amount));
  } else {
    L.push(":60F:C" + (yymmdd(stmt.fromDt) || "000101") + (stmt.ccy || "EUR") + "0,00");
  }
  for (const e of stmt.entries) {
    const vd = yymmdd(e.valDate || e.date);
    const ed = mmdd(e.date || e.valDate);
    L.push(":61:" + vd + ed + e.sign + n2(e.amount) + "NTRFNONREF");
    L.push(field86(e));
  }
  if (stmt.balances.close) {
    const b = stmt.balances.close;
    L.push(":62F:" + b.sign + (yymmdd(b.date) || yymmdd(stmt.toDt)) + (b.ccy || stmt.ccy) + n2(b.amount));
  } else {
    // Schlusssaldo aus Eröffnung + Bewegungen rechnen
    let bal = stmt.balances.open ? (stmt.balances.open.sign === "D" ? -stmt.balances.open.amount : stmt.balances.open.amount) : 0;
    for (const e of stmt.entries) bal += (e.sign === "D" ? -e.amount : e.amount);
    L.push(":62F:" + (bal < 0 ? "D" : "C") + (yymmdd(stmt.toDt) || "000101") + (stmt.ccy || "EUR") + n2(Math.abs(bal)));
  }
  return L.join("\r\n") + "\r\n";
}

/* ---------- Rendering ---------- */
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function fmtMoney(v, ccy) { try { return new Intl.NumberFormat("de-DE", { style: "currency", currency: ccy || "EUR" }).format(v); } catch (e) { return Number(v).toFixed(2) + " " + (ccy || ""); } }
function fmtDate(d) { const m = String(d || "").match(/(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]}` : (d || ""); }

let CURRENT = null;

function renderResult(stmts) {
  CURRENT = stmts;
  const totalEntries = stmts.reduce((a, s) => a + s.entries.length, 0);
  const blocks = stmts.map((s, si) => {
    const rows = s.entries.map((e) => `
      <tr>
        <td>${esc(fmtDate(e.date))}</td>
        <td>${esc(e.counterparty) || "<span class='faint'>&ndash;</span>"}<div class="purpose">${esc((e.remittance || e.info || "").slice(0, 90))}</div></td>
        <td class="num ${e.sign === "D" ? "neg" : "pos"}">${e.sign === "D" ? "&minus;" : "+"}${esc(fmtMoney(e.amount, e.ccy))}</td>
      </tr>`).join("");
    return `
      <div class="stmt">
        <div class="stmt-head">
          <div><span class="lbl">Konto</span><b>${esc(s.iban) || "&ndash;"}</b>${s.owner ? " &middot; " + esc(s.owner) : ""}</div>
          <div class="bal">
            ${s.balances.open ? `<span><span class="lbl">Anfangssaldo</span>${esc(fmtMoney((s.balances.open.sign === "D" ? -1 : 1) * s.balances.open.amount, s.balances.open.ccy))}</span>` : ""}
            ${s.balances.close ? `<span><span class="lbl">Endsaldo</span>${esc(fmtMoney((s.balances.close.sign === "D" ? -1 : 1) * s.balances.close.amount, s.balances.close.ccy))}</span>` : ""}
          </div>
        </div>
        <div class="tbl-wrap"><table class="tx"><thead><tr><th>Datum</th><th>Empfänger / Zweck</th><th class="num">Betrag</th></tr></thead><tbody>${rows || `<tr><td colspan="3" class="faint">Keine Buchungen.</td></tr>`}</tbody></table></div>
      </div>`;
  }).join("");

  const licensed = isLicensed();
  const datevPanel = `
    <div class="datev">
      <div class="datev-head"><h3>DATEV-Buchungsstapel exportieren</h3>${licensed ? `<span class="lic-ok">Pro freigeschaltet</span>` : `<span class="pro-tag">Pro</span>`}</div>
      <p class="datev-sub">Erzeugt eine EXTF-Datei (Format 700) zum Import in DATEV. Die Bank-Buchungen werden auf Ihr Geldkonto gegen ein Verrechnungskonto gebucht; die endgültige Kontierung nehmen Sie in DATEV vor.</p>
      <div class="datev-opts">
        <label>Geldkonto (Bank)<input type="text" id="dvKonto" value="1200" inputmode="numeric"></label>
        <label>Gegenkonto (Verrechnung)<input type="text" id="dvGegen" value="1590" inputmode="numeric"></label>
        <label>Berater-Nr.<input type="text" id="dvBerater" placeholder="optional" inputmode="numeric"></label>
        <label>Mandanten-Nr.<input type="text" id="dvMandant" placeholder="optional" inputmode="numeric"></label>
      </div>
      <div class="datev-actions">
        <button class="btn-primary" id="dlDatev" type="button">DATEV-Buchungsstapel herunterladen</button>
        ${licensed ? "" : `<span class="datev-hint">Gratis bis ${CONFIG.freeDatevLimit} Buchungen. ${totalEntries > CONFIG.freeDatevLimit ? `Ihr Auszug hat ${totalEntries} &ndash; <button type="button" class="linkbtn" id="unlockBtn">Pro freischalten</button>.` : ""}</span>`}
      </div>
      <p class="datev-note" id="datevNote" hidden></p>
    </div>`;

  document.getElementById("result").innerHTML = `
    <div class="res-bar">
      <span class="ok-pill">${esc(totalEntries)} Buchungen aus ${stmts.length} Auszug(en) gelesen</span>
      <div class="res-actions">
        <button class="btn-primary" id="dlMt940" type="button">MT940 herunterladen</button>
        <button class="btn-ghost" id="resetBtn" type="button">Andere Datei</button>
      </div>
    </div>
    ${blocks}
    ${datevPanel}
    <p class="disclaimer">Bitte die erzeugte Datei vor dem Bank-/DATEV-Import stichprobenartig prüfen. Keine steuerliche Beratung.</p>`;

  document.getElementById("result").hidden = false;
  document.getElementById("dlMt940").addEventListener("click", downloadMt940);
  document.getElementById("dlDatev").addEventListener("click", downloadDatev);
  const unlock = document.getElementById("unlockBtn");
  if (unlock) unlock.addEventListener("click", () => openPro("datev"));
  document.getElementById("resetBtn").addEventListener("click", reset);
  count("convert_success");
  document.getElementById("result").scrollIntoView({ behavior: "smooth", block: "start" });
}

function downloadMt940() {
  if (!CURRENT) return;
  const text = CURRENT.map(toMT940).join("");
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (CURRENT[0].iban || "kontoauszug") + ".sta";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  count("download_mt940");
}

function downloadDatev() {
  if (!CURRENT || !window.DATEV) return;
  const opts = {
    konto: (document.getElementById("dvKonto").value || "1200").trim(),
    gegenkonto: (document.getElementById("dvGegen").value || "1590").trim(),
    berater: (document.getElementById("dvBerater").value || "").trim(),
    mandant: (document.getElementById("dvMandant").value || "").trim()
  };
  const licensed = isLicensed();
  const total = CURRENT.reduce((a, s) => a + s.entries.length, 0);
  if (!licensed) opts.limit = CONFIG.freeDatevLimit;
  const r = window.DATEV.download(CURRENT, opts);
  count("download_datev");
  const note = document.getElementById("datevNote");
  note.hidden = false; note.classList.remove("ok");
  if (!licensed && total > CONFIG.freeDatevLimit) {
    note.innerHTML = `Gratis-Version: nur die ersten ${CONFIG.freeDatevLimit} von ${total} Buchungen exportiert. <button type="button" class="linkbtn" id="unlockBtn2">Pro freischalten</button> für den vollständigen Export.`;
    const u = document.getElementById("unlockBtn2"); if (u) u.addEventListener("click", () => openPro("datev"));
    count("datev_limit_hit");
  } else {
    note.classList.add("ok");
    note.textContent = `DATEV-Buchungsstapel mit ${r.count} Buchungen erzeugt (Geldkonto ${opts.konto} gegen ${opts.gegenkonto}).`;
  }
}

/* Lizenzschluessel einloesen */
function applyLicense() {
  const inp = document.getElementById("licKey");
  const out = document.getElementById("licNote");
  const key = (inp.value || "").trim();
  if (licenseValid(key)) {
    try { localStorage.setItem("kk_license", key.toUpperCase()); } catch (e) {}
    out.hidden = false; out.classList.add("ok"); out.textContent = "Pro freigeschaltet. Vielen Dank!";
    count("license_activated");
    if (CURRENT) renderResult(CURRENT);
    document.getElementById("result").scrollIntoView({ behavior: "smooth" });
  } else {
    out.hidden = false; out.classList.remove("ok"); out.textContent = "Dieser Lizenzschlüssel ist ungültig.";
  }
}

function openPro(which) {
  count(which === "datev" ? "pro_datev_click" : "pro_nav_click");
  const sec = document.getElementById("pro");
  sec.scrollIntoView({ behavior: "smooth" });
  const inp = document.getElementById("proEmail");
  if (inp) inp.focus({ preventScroll: true });
}

function reset() {
  CURRENT = null;
  const r = document.getElementById("result"); r.hidden = true; r.innerHTML = "";
  document.getElementById("tool").scrollIntoView({ behavior: "smooth" });
}

/* ---------- Datei-Handling ---------- */
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const errorBox = document.getElementById("errorBox");
function showError(m) { errorBox.textContent = m; errorBox.hidden = false; document.getElementById("result").hidden = true; }
function clearError() { errorBox.hidden = true; }

function handleFile(file) {
  clearError();
  if (!file) return;
  const reader = new FileReader();
  reader.onerror = () => showError("Die Datei konnte nicht gelesen werden.");
  reader.onload = () => {
    try { renderResult(parseCamt(reader.result)); }
    catch (e) { showError(e.message || "Die Datei konnte nicht verarbeitet werden."); count("parse_error"); }
  };
  reader.readAsText(file, "UTF-8");
}

["dragenter", "dragover"].forEach(ev => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("drag"); }));
["dragleave", "drop"].forEach(ev => dropzone.addEventListener(ev, (e) => { e.preventDefault(); if (ev === "drop" || e.target === dropzone) dropzone.classList.remove("drag"); }));
dropzone.addEventListener("drop", (e) => { const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) handleFile(f); });
dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
document.getElementById("browseBtn").addEventListener("click", (e) => { e.stopPropagation(); fileInput.click(); });
fileInput.addEventListener("change", () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); fileInput.value = ""; });

document.getElementById("demoBtn").addEventListener("click", async () => {
  clearError();
  try { const r = await fetch(CONFIG.demoUrl); renderResult(parseCamt(await r.text())); count("demo"); }
  catch (e) { showError("Beispiel konnte nicht geladen werden."); }
});

/* ---------- Pro-Fake-Door ---------- */
const proForm = document.getElementById("proForm");
const proNote = document.getElementById("proNote");
proForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("proEmail").value.trim();
  const btn = document.getElementById("proSubmit");
  if (!email) return;
  btn.disabled = true;
  let ok = false;
  try {
    const r = await fetch(CONFIG.signupEndpoint, {
      method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ email, source: "kontokonverter_pro", _subject: "Neue Pro-Vormerkung (KontoKonverter)", _template: "table", _captcha: "false" })
    });
    const j = await r.json().catch(() => ({}));
    ok = r.ok && (j.success === "true" || j.success === true);
  } catch (e) { ok = false; }
  count("pro_signup");
  proNote.textContent = ok ? "Vielen Dank. Wir melden uns, sobald DATEV-Export und Stapelverarbeitung verfügbar sind." : "Das hat nicht geklappt. Bitte später erneut versuchen.";
  if (ok) { proNote.classList.add("ok"); proForm.reset(); }
  btn.disabled = false;
});

const licBtn = document.getElementById("licBtn");
if (licBtn) licBtn.addEventListener("click", applyLicense);
const buyBtn = document.getElementById("buyBtn");
if (buyBtn) buyBtn.addEventListener("click", () => {
  count("buy_click");
  if (CONFIG.payUrl) { window.open(CONFIG.payUrl, "_blank", "noopener"); }
  else { const i = document.getElementById("proEmail"); if (i) i.focus(); }
});

/* ---------- anonyme Reichweitenzaehlung ---------- */
function count(event) {
  try {
    if (!CONFIG.counterBase) return;
    const key = String(event || "").replace(/[^a-z0-9_]/gi, "").slice(0, 40);
    if (!key) return;
    const img = new Image(); img.src = CONFIG.counterBase + "/" + key + "/up?t=" + Date.now();
  } catch (e) {}
}
count("pageview");
