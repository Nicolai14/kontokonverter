"use strict";
/* DATEV-Buchungsstapel (EXTF, Format 700/Kategorie 21) - clientseitiger Writer.
   Ausgabe in Windows-1252, Semikolon-getrennt, CRLF. */
(function(){
  var COLS = "Umsatz (ohne Soll/Haben-Kz);Soll/Haben-Kennzeichen;WKZ Umsatz;Kurs;Basisumsatz;WKZ Basisumsatz;Konto;Gegenkonto (ohne BU-Schlüssel);BU-Schlüssel;Belegdatum;Belegfeld 1;Belegfeld 2;Skonto;Buchungstext;Postensperre;Diverse Adressnummer;Geschäftspartnerbank;Sachverhalt;Zinssperre;Beleglink;Beleginfo – Art 1;Beleginfo – Inhalt 1;Beleginfo – Art 2;Beleginfo – Inhalt 2;Beleginfo – Art 3;Beleginfo – Inhalt 3;Beleginfo – Art 4;Beleginfo – Inhalt 4;Beleginfo – Art 5;Beleginfo – Inhalt 5;Beleginfo – Art 6;Beleginfo – Inhalt 6;Beleginfo – Art 7;Beleginfo – Inhalt 7;Beleginfo – Art 8;Beleginfo – Inhalt 8;KOST1 – Kostenstelle;KOST2 – Kostenstelle;Kost Menge;EU-Land u. USt-IdNr.;EU-Steuersatz;Abw. Versteuerungsart;Sachverhalt L+L;Funktionsergänzung L+L;BU 49 Hauptfunktionstyp;BU 49 Hauptfunktionsnummer;BU 49 Funktionsergänzung;Zusatzinformation – Art 1;Zusatzinformation – Inhalt 1;Zusatzinformation – Art 2;Zusatzinformation – Inhalt 2;Zusatzinformation – Art 3;Zusatzinformation – Inhalt 3;Zusatzinformation – Art 4;Zusatzinformation – Inhalt 4;Zusatzinformation – Art 5;Zusatzinformation – Inhalt 5;Zusatzinformation – Art 6;Zusatzinformation – Inhalt 6;Zusatzinformation – Art 7;Zusatzinformation – Inhalt 7;Zusatzinformation – Art 8;Zusatzinformation – Inhalt 8;Zusatzinformation – Art 9;Zusatzinformation – Inhalt 9;Zusatzinformation – Art 10;Zusatzinformation – Inhalt 10;Zusatzinformation – Art 11;Zusatzinformation – Inhalt 11;Zusatzinformation – Art 12;Zusatzinformation – Inhalt 12;Zusatzinformation – Art 13;Zusatzinformation – Inhalt 13;Zusatzinformation – Art 14;Zusatzinformation – Inhalt 14;Zusatzinformation – Art 15;Zusatzinformation – Inhalt 15;Zusatzinformation – Art 16;Zusatzinformation – Inhalt 16;Zusatzinformation – Art 17;Zusatzinformation – Inhalt 17;Zusatzinformation – Art 18;Zusatzinformation – Inhalt 18;Zusatzinformation – Art 19;Zusatzinformation – Inhalt 19;Zusatzinformation – Art 20;Zusatzinformation – Inhalt 20;Stück;Gewicht;Zahlweise;Forderungsart;Veranlagungsjahr;Zugeordnete Fälligkeit;Skontotyp;Auftragsnummer;Buchungstyp;USt-Schlüssel (Anzahlungen);EU-Mitgliedstaat (Anzahlungen);Sachverhalt L+L (Anzahlungen);EU-Steuersatz (Anzahlungen);Erlöskonto (Anzahlungen);Herkunft-Kz;Leerfeld;KOST-Datum;SEPA-Mandatsreferenz;Skontosperre;Gesellschaftername;Beteiligtennummer;Identifikationsnummer;Zeichnernummer;Postensperre bis;Bezeichnung;Kennzeichen;Festschreibung;Leistungsdatum;Datum Zuord.;Fälligkeit;Generalumkehr;Steuersatz;Land;Abrechnungsreferent;BVV-Position;EU-Mitgliedstaat u. UStID (Ursprung);EU-Steuersatz (Ursprung);Abw. Skontokonto";  // exakte 125 Spaltenkopfzeile (Zeile 2)

  var CP = {0x20AC:0x80,0x201A:0x82,0x0192:0x83,0x201E:0x84,0x2026:0x85,0x2020:0x86,0x2021:0x87,0x02C6:0x88,0x2030:0x89,0x0160:0x8A,0x2039:0x8B,0x0152:0x8C,0x017D:0x8E,0x2018:0x91,0x2019:0x92,0x201C:0x93,0x201D:0x94,0x2022:0x95,0x2013:0x96,0x2014:0x97,0x02DC:0x98,0x2122:0x99,0x0161:0x9A,0x203A:0x9B,0x0153:0x9C,0x017E:0x9E,0x0178:0x9F};
  function encodeCp1252(str){
    var out=[];
    for(var i=0;i<str.length;i++){var c=str.charCodeAt(i); if(c<=0xFF)out.push(c); else if(CP[c]!==undefined)out.push(CP[c]); else out.push(0x3F);}
    return new Uint8Array(out);
  }
  function q(s){ return '"' + String(s==null?"":s).replace(/"/g,'""') + '"'; }
  function amt(v){ return Math.abs(Number(v)).toFixed(2).replace(".",","); }
  function ttmm(d){ var m=String(d||"").match(/(\d{4})-(\d{2})-(\d{2})/); return m? m[3]+m[2] : ""; }
  function ymd(d){ var m=String(d||"").match(/(\d{4})-(\d{2})-(\d{2})/); return m? m[1]+m[2]+m[3] : ""; }
  function clean(s){ return String(s||"").replace(/[\r\n;]+/g," ").trim().slice(0,60); }
  function pad2(n){ return (n<10?"0":"")+n; }

  // erzeugt EXTF-Text. opts: {konto,gegenkonto,berater,mandant,skl,bezeichnung,limit}
  function build(stmts, opts){
    opts = opts||{};
    var konto = (opts.konto||"1200"), gegen=(opts.gegenkonto||"1590");
    var skl = String(opts.skl||"4");
    // alle Buchungen mit Datum sammeln
    var rows=[], dates=[];
    stmts.forEach(function(s){
      s.entries.forEach(function(e){
        var d = (e.date||e.valDate);
        if(ymd(d)) dates.push(ymd(d));
        rows.push(e);
      });
    });
    var limited = false;
    if(opts.limit && rows.length>opts.limit){ rows = rows.slice(0,opts.limit); limited=true; }
    dates.sort();
    var von = dates.length? dates[0] : "";
    var bis = dates.length? dates[dates.length-1] : "";
    var wj = (von? von.slice(0,4): "2026") + "0101";
    var now = new Date();
    var ts = ""+now.getFullYear()+pad2(now.getMonth()+1)+pad2(now.getDate())+pad2(now.getHours())+pad2(now.getMinutes())+pad2(now.getSeconds())+"000";
    var bez = clean(opts.bezeichnung || ("Kontoauszug "+(stmts[0]&&stmts[0].iban||"")));

    // Header-Zeile 1 (31 Felder)
    var h1 = [q("EXTF"),"700","21",q("Buchungsstapel"),"13",ts,"",q("KK"),q("KontoKonverter"),"",
              (opts.berater||""),(opts.mandant||""),wj,skl,von,bis,q(bez),"","1","","0",q("EUR"),
              "","","","","","","","",""].join(";");

    // Datenzeilen (je 125 Felder)
    var nCols = COLS.split(";").length;
    var lines = rows.map(function(e){
      var f = new Array(nCols).fill("");
      f[0] = amt(e.amount);                       // Umsatz (ohne S/H-Kz)
      f[1] = q(e.sign==="D" ? "H" : "S");          // Geldkonto: Eingang=S, Ausgang=H
      f[6] = konto;                                // Konto (Bank-Sachkonto)
      f[7] = gegen;                                // Gegenkonto (Verrechnung)
      f[9] = ttmm(e.date||e.valDate);              // Belegdatum TTMM
      f[13]= q(clean((e.counterparty? e.counterparty+" ":"") + (e.remittance||e.info||"")));
      return f.join(";");
    });

    var text = h1 + "\r\n" + COLS + "\r\n" + lines.join("\r\n") + "\r\n";
    return { text:text, count:rows.length, limited:limited };
  }

  function download(stmts, opts){
    var r = build(stmts, opts);
    var bytes = encodeCp1252(r.text);
    var blob = new Blob([bytes], {type:"text/csv;charset=windows-1252"});
    var a=document.createElement("a"); a.href=URL.createObjectURL(blob);
    a.download="EXTF_Buchungsstapel.csv"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){URL.revokeObjectURL(a.href);},2000);
    return r;
  }
  window.DATEV = { build:build, download:download, encodeCp1252:encodeCp1252, nCols: COLS.split(";").length };
})();
