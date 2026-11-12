/* Football Brain: Wiki (Vorschau, Stand 12.11.2026).
   Zeigt Teams, Regeln, Spieler, Statistik und Tabelle aus wiki-teams.json, wiki-regeln.json und den drei Dateien
   des Daten-Skripts (wiki-spieler.json, wiki-statistik.json, wiki-tabelle.json; Quelle nflverse, CC BY 4.0).
   Die Seite liest nur Dateien von ihrer eigenen Adresse, es wird nichts von fremden Servern geladen. */

(function () {
  "use strict";

  var DATEIEN = {
    teams: "wiki-teams.json",
    regeln: "wiki-regeln.json",
    spieler: "wiki-spieler.json",
    statistik: "wiki-statistik.json",
    tabelle: "wiki-tabelle.json",
    spielplan: "wiki-spielplan.json",
    namen: "wiki-namen.json"
  };
  var MAX_TREFFER = 30;
  var MAX_SPIELER = 50;

  // Alle Themen haben inzwischen Daten; die Liste bleibt, falls später wieder eine Leerstelle gebraucht wird.
  var LEERSTELLEN = [];

  // Bestenlisten der Statistik: Feld in wiki-statistik.json, Titel, Einheit.
  var BESTENLISTEN = [
    { feld: "passing_yards", titel: "Passing Yards", einheit: "Yards", pos: ["QB"] },
    { feld: "passing_tds", titel: "Passing Touchdowns", einheit: "TD", pos: ["QB"] },
    { feld: "rushing_yards", titel: "Rushing Yards", einheit: "Yards", pos: null },
    { feld: "rushing_tds", titel: "Rushing Touchdowns", einheit: "TD", pos: null },
    { feld: "receptions", titel: "Receptions", einheit: "Fänge", pos: null },
    { feld: "receiving_yards", titel: "Receiving Yards", einheit: "Yards", pos: null },
    { feld: "receiving_tds", titel: "Receiving Touchdowns", einheit: "TD", pos: null },
    { feld: "def_sacks", titel: "Sacks", einheit: "Sacks", pos: null },
    { feld: "def_interceptions", titel: "Interceptions (Abwehr)", einheit: "INT", pos: null },
    { feld: "fg_made", titel: "Field Goals", einheit: "FG", pos: null }
  ];

  var daten = { teams: null, regeln: null, spieler: null, statistik: null, tabelle: null, spielplan: null, namen: null };
  var planFilter = { woche: null, team: "alle" };

  // Name, Position und Team zu einer Spieler-ID: erst aus dem Kader, sonst aus wiki-namen.json (Spieler ohne Kaderplatz).
  function spielerInfo(id) {
    var k = spielerNachId[id];
    if (k) { return { name: k.name, pos: k.pos, team: k.team, imKader: true }; }
    var n = daten.namen && daten.namen.spieler && daten.namen.spieler[id];
    return n ? { name: n.name, pos: n.pos, team: n.team, imKader: false } : null;
  }

  var ROEMISCH = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  // Super Bowl I wurde im Januar 1967 gespielt, also ist Super Bowl N im Jahr 1966 + N.
  function superBowlJahr(nummer) {
    var s = String(nummer).toUpperCase();
    var n = 0;
    if (/^\d+$/.test(s)) { n = parseInt(s, 10); } else {
      for (var i = 0; i < s.length; i++) {
        var w = ROEMISCH[s[i]] || 0;
        var nach = ROEMISCH[s[i + 1]] || 0;
        n += w < nach ? -w : w;
      }
    }
    return n ? 1966 + n : null;
  }
  var spielerNachId = {};
  var spielerFilter = { team: "alle", pos: "alle", text: "" };
  var fehler = {};
  var suchindex = [];
  var teamFilter = "alle";
  var letztesThema = null;

  /* ---------- Kleine Helfer ---------- */

  // Baut einen Knoten. Text kommt immer als Text hinein, nie als HTML.
  function el(tag, eigenschaften, kinder) {
    var knoten = document.createElement(tag);
    if (eigenschaften) {
      Object.keys(eigenschaften).forEach(function (name) {
        var wert = eigenschaften[name];
        if (wert === null || wert === undefined || wert === false) { return; }
        if (name === "text") {
          knoten.textContent = wert;
        } else if (name === "klasse") {
          knoten.className = wert;
        } else {
          knoten.setAttribute(name, wert === true ? "" : String(wert));
        }
      });
    }
    (kinder || []).forEach(function (kind) {
      if (kind === null || kind === undefined || kind === false) { return; }
      knoten.appendChild(typeof kind === "string" ? document.createTextNode(kind) : kind);
    });
    return knoten;
  }

  function leeren(knoten) {
    while (knoten.firstChild) { knoten.removeChild(knoten.firstChild); }
    return knoten;
  }

  function hat(wert) {
    return wert !== undefined && wert !== null && wert !== "";
  }

  // Für die Suche: klein geschrieben, ohne Akzente und Umlautpunkte.
  function normal(text) {
    return String(text === null || text === undefined ? "" : text)
      .toLowerCase()
      .replace(/ß/g, "ss")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
  }

  function datumZeigen(iso) {
    var teile = String(iso || "").split("-");
    return teile.length === 3 ? teile[2] + "." + teile[1] + "." + teile[0] : String(iso || "");
  }

  function laden(datei) {
    return fetch(datei, { cache: "no-cache" }).then(function (antwort) {
      if (!antwort.ok) { throw new Error("Fehler " + antwort.status); }
      return antwort.json();
    });
  }

  function teamListe() {
    return (daten.teams && daten.teams.teams) || [];
  }

  function regelListe() {
    return (daten.regeln && daten.regeln.regeln) || [];
  }

  // Die Nummer einer Regelstelle: Regel.Abschnitt.Artikel, zum Beispiel 4.2.1.
  function eintragId(regel, stelle) {
    var id = String(regel.nummer);
    if (hat(stelle.abschnitt)) { id += "." + stelle.abschnitt; }
    if (hat(stelle.artikel)) { id += "." + stelle.artikel; }
    return id;
  }

  function belegText(regel, stelle) {
    var teile = ["Regel " + regel.nummer];
    if (hat(stelle.abschnitt)) { teile.push("Abschnitt " + stelle.abschnitt); }
    if (hat(stelle.artikel)) { teile.push("Artikel " + stelle.artikel); }
    return teile.join(", ");
  }

  function absaetze(text) {
    return (text instanceof Array ? text : [text]).filter(hat);
  }

  /* ---------- Quellenzeilen ---------- */

  function quellenZeile(quellen, gelesen) {
    var zeile = el("p", { klasse: "quelle" }, ["Quelle: "]);
    (quellen || []).forEach(function (quelle, i) {
      if (i > 0) { zeile.appendChild(document.createTextNode(" · ")); }
      if (quelle.url && /^https:\/\//.test(quelle.url)) {
        zeile.appendChild(el("a", { href: quelle.url, target: "_blank", rel: "noopener noreferrer", text: quelle.titel || quelle.url }));
      } else {
        zeile.appendChild(document.createTextNode(quelle.titel || ""));
      }
    });
    if (gelesen) { zeile.appendChild(document.createTextNode(" (gelesen am " + datumZeigen(gelesen) + ")")); }
    return zeile;
  }

  // Der Hinweis am Ende einer Liste: Stand und Hinweis aus der Datei.
  function sammelHinweis(sammlung) {
    var text = [];
    if (sammlung && sammlung.stand) { text.push("Stand der Texte: " + datumZeigen(sammlung.stand) + "."); }
    if (sammlung && sammlung.hinweis) { text.push(sammlung.hinweis); }
    return el("p", { klasse: "quelle", text: text.join(" ") });
  }

  /* ---------- Start ---------- */

  function themaKarte(id, name, zeile, leer) {
    return el("a", { klasse: leer ? "thema leer" : "thema", href: "#" + id }, [
      el("span", { klasse: "thema-text" }, [
        el("span", { klasse: "thema-name", text: name }),
        el("span", { klasse: "thema-zahl", text: zeile })
      ]),
      leer ? el("span", { klasse: "leer-marke", text: "Leerstelle" }) : null
    ]);
  }

  function themenAufbauen() {
    var liste = leeren(document.getElementById("themen"));
    var teams = teamListe();
    var regeln = regelListe();
    var stellen = 0;
    regeln.forEach(function (r) { stellen += (r.eintraege || []).length; });

    liste.appendChild(themaKarte("teams", "Teams",
      teams.length ? teams.length + " Teams, nach Conference und Division" : "Die Teamliste lässt sich gerade nicht laden", false));
    liste.appendChild(themaKarte("regeln", "Regeln",
      regeln.length ? stellen + " Regelstellen aus " + regeln.length + " Regeln, mit Nummer" : "Die Regelliste lässt sich gerade nicht laden", false));
    var sp = spielerListe();
    liste.appendChild(themaKarte("spieler", "Spieler",
      sp.length ? sp.length + " Spieler, Stand " + datumZeigen(daten.spieler.stand) : "Die Spielerliste lässt sich gerade nicht laden", false));
    var anzahlStat = daten.statistik && daten.statistik.anzahl;
    liste.appendChild(themaKarte("statistik", "Statistik",
      anzahlStat ? "Bestenlisten, Saison " + daten.statistik.saison : "Die Statistik lässt sich gerade nicht laden", false));
    liste.appendChild(themaKarte("tabelle", "Tabelle",
      daten.tabelle ? "Saison " + daten.tabelle.saison + ", nach " + daten.tabelle.woche + " Wochen" : "Die Tabelle lässt sich gerade nicht laden", false));
    var plan = daten.spielplan && daten.spielplan.spiele;
    liste.appendChild(themaKarte("spielplan", "Spielplan",
      plan && plan.length ? "Saison " + daten.spielplan.saison + ", " + plan.length + " Spiele nach Woche" : "Kommt, sobald wiki-spielplan.json da ist", !(plan && plan.length)));
    LEERSTELLEN.forEach(function (l) {
      liste.appendChild(themaKarte(l.id, l.titel, "Kommt später aus dem Daten-Skript", true));
    });
  }

  function spielerListe() {
    return (daten.spieler && daten.spieler.spieler) || [];
  }

  function teamName(kuerzel) {
    var t = teamListe().filter(function (x) { return x.kuerzel === kuerzel; })[0];
    return t ? t.name : kuerzel;
  }

  /* ---------- Suche ---------- */

  function suchindexBauen() {
    suchindex = [];
    teamListe().forEach(function (t) {
      suchindex.push({
        typ: "Team",
        titel: t.name,
        zeile: t.conference + " " + t.division + " · " + t.stadion,
        hash: "#teams/" + t.kuerzel,
        titelN: normal(t.name + " " + t.kuerzel),
        heu: normal([t.name, t.kuerzel, t.ort, t.stadion, t.stadionOrt, t.conference, t.division, t.gegruendet, t.profil].join(" "))
      });
    });
    spielerListe().forEach(function (s) {
      suchindex.push({
        typ: "Spieler",
        titel: s.name,
        zeile: (s.pos || "") + " · " + teamName(s.team) + (s.college ? " · " + s.college : ""),
        hash: "#spieler/" + encodeURIComponent(s.id || s.name),
        titelN: normal(s.name),
        heu: normal([s.name, s.pos, s.team, teamName(s.team), s.college].join(" "))
      });
    });
    regelListe().forEach(function (r) {
      suchindex.push({
        typ: "Regel",
        titel: "Regel " + r.nummer + ": " + r.titel,
        zeile: r.englisch || "",
        hash: "#regeln/" + r.nummer,
        titelN: normal("regel " + r.nummer + " " + r.titel + " " + (r.englisch || "")),
        heu: normal(["regel", r.nummer, r.titel, r.englisch, r.kurz].join(" "))
      });
      (r.eintraege || []).forEach(function (e) {
        suchindex.push({
          typ: "Regel",
          titel: e.titel,
          zeile: belegText(r, e),
          hash: "#regeln/" + eintragId(r, e),
          titelN: normal(e.titel + " " + (e.stichwoerter || []).join(" ")),
          heu: normal(["regel", r.nummer, r.titel, r.englisch, e.titel, absaetze(e.text).join(" "), (e.stichwoerter || []).join(" "), belegText(r, e), eintragId(r, e)].join(" "))
        });
      });
    });
  }

  function suchen(eingabe) {
    var feld = leeren(document.getElementById("treffer"));
    var themen = document.getElementById("themen");
    var begriffe = normal(eingabe).split(/\s+/).filter(function (b) { return b.length > 0; });
    if (!begriffe.length) {
      feld.hidden = true;
      themen.hidden = false;
      return;
    }

    var gefunden = [];
    suchindex.forEach(function (eintrag, nr) {
      var punkte = 0;
      for (var i = 0; i < begriffe.length; i++) {
        if (eintrag.heu.indexOf(begriffe[i]) === -1) { return; }
        punkte += eintrag.titelN.indexOf(begriffe[i]) === -1 ? 1 : 2;
      }
      gefunden.push({ eintrag: eintrag, punkte: punkte, nr: nr });
    });
    gefunden.sort(function (a, b) { return (b.punkte - a.punkte) || (a.nr - b.nr); });
    var zeige = gefunden.slice(0, MAX_TREFFER);

    var kopf;
    if (!gefunden.length) {
      kopf = "Nichts gefunden. Versuch den Teamnamen, ein Stadion oder ein Stichwort wie „Touchdown“.";
    } else if (gefunden.length > zeige.length) {
      kopf = "Die ersten " + zeige.length + " von " + gefunden.length + " Treffern:";
    } else {
      kopf = gefunden.length === 1 ? "1 Treffer" : gefunden.length + " Treffer";
    }
    feld.hidden = false;
    themen.hidden = true;
    feld.appendChild(el("p", { klasse: "treffer-kopf", text: kopf }));
    zeige.forEach(function (t) {
      feld.appendChild(el("a", { klasse: "treffer-eintrag", href: t.eintrag.hash }, [
        el("span", { klasse: "treffer-typ", text: t.eintrag.typ }),
        el("span", { klasse: "treffer-titel", text: t.eintrag.titel }),
        el("span", { klasse: "treffer-zeile", text: t.eintrag.zeile })
      ]));
    });
  }

  /* ---------- Themenansicht: gemeinsame Teile ---------- */

  function titelSetzen(text) {
    document.getElementById("thema-titel").textContent = text;
    document.title = "Football Brain: Wiki · " + text;
  }

  function ladeProblem(datei) {
    var grund = "";
    Object.keys(DATEIEN).forEach(function (name) {
      if (DATEIEN[name] === datei && fehler[name]) { grund = " (" + fehler[name] + ")"; }
    });
    return el("p", { klasse: "hinweis", text: "Die Datei " + datei + " lässt sich gerade nicht laden" + grund + ". Öffnest du die Seite direkt aus dem Ordner, blockiert der Browser das; über die Vorschau-Adresse oder einen kleinen lokalen Server funktioniert es." });
  }

  // Klappt den Eintrag auf und springt hin. Bei einer Regelstelle (zum Beispiel 4.2.1) wird die Stelle markiert.
  function zielOeffnen(elternId, ziel) {
    var eltern = document.getElementById(elternId);
    window.scrollTo(0, 0);
    if (!ziel || !eltern) { return; }
    eltern.open = true;
    var knoten = eltern;
    if (ziel.indexOf(".") !== -1) {
      var stelle = document.getElementById("regel-" + ziel);
      if (stelle) {
        stelle.classList.add("markiert");
        knoten = stelle;
      }
    }
    knoten.scrollIntoView({ block: "start" });
  }

  /* ---------- Teams ---------- */

  function superBowlText(t) {
    if (!hat(t.superBowlSiege)) { return null; }
    if (t.superBowlSiege === 0) { return "noch keiner"; }
    var spiele = (t.superBowlSpiele || []).map(superBowlJahr).filter(hat).join(", ");
    return t.superBowlSiege + (spiele ? " (" + spiele + ")" : "");
  }

  function bilanzText(kuerzel) {
    var gefunden = null;
    ((daten.tabelle && daten.tabelle.divisionen) || []).forEach(function (d) {
      d.teams.forEach(function (r) {
        if (r.team === kuerzel) { gefunden = { r: r, platz: d.teams.indexOf(r) + 1 }; }
      });
    });
    if (!gefunden) { return null; }
    var r = gefunden.r;
    return r.siege + "-" + r.niederlagen + (r.unentschieden ? "-" + r.unentschieden : "") +
      " (Punkte " + r.punkte + " zu " + r.gegen + "), Platz " + gefunden.platz + " in der Division";
  }

  function rivalenText(t) {
    var r = teamListe().filter(function (x) {
      return x.conference === t.conference && x.division === t.division && x.kuerzel !== t.kuerzel;
    }).map(function (x) { return x.name; });
    return r.length ? r.join(", ") : null;
  }

  function kaderText(kuerzel) {
    var n = spielerListe().filter(function (s) { return s.team === kuerzel; }).length;
    return n ? n + " Spieler im Kader (Woche " + daten.spieler.kaderwoche + ")" : null;
  }

  function quarterbackText(kuerzel) {
    var qb = spielerListe().filter(function (s) { return s.team === kuerzel && s.pos === "QB"; })
      .map(function (s) { return s.name + (hat(s.nr) ? " (#" + s.nr + ")" : ""); });
    return qb.length ? qb.join(", ") : null;
  }

  function filterLeiste(teams) {
    var leiste = el("div", { klasse: "filter", role: "group", "aria-label": "Conference wählen" });
    [["alle", "Alle"], ["AFC", "AFC"], ["NFC", "NFC"]].forEach(function (paar) {
      var anzahl = teams.filter(function (t) { return paar[0] === "alle" || t.conference === paar[0]; }).length;
      var knopf = el("button", {
        type: "button",
        text: paar[1] + " (" + anzahl + ")",
        "aria-pressed": teamFilter === paar[0] ? "true" : "false"
      });
      knopf.addEventListener("click", function () {
        teamFilter = paar[0];
        teamsZeigen("");
      });
      leiste.appendChild(knopf);
    });
    return leiste;
  }

  function teamKarte(t) {
    var karte = el("details", { klasse: "eintrag", id: "team-" + t.kuerzel });
    karte.appendChild(el("summary", null, [
      el("span", { klasse: "kuerzel", text: t.kuerzel }),
      el("span", { klasse: "eintrag-text" }, [
        el("span", { klasse: "eintrag-titel", text: t.name }),
        el("span", { klasse: "eintrag-zeile", text: t.conference + " " + t.division + (t.stadionOrt ? " · " + t.stadionOrt : "") })
      ])
    ]));

    var detail = el("div", { klasse: "eintrag-detail" });
    var fakten = el("dl", { klasse: "fakten" });
    [
      ["Liga", t.conference + " " + t.division],
      ["Spitzname", t.kurzname],
      ["Stadion", t.stadion ? t.stadion + (t.stadionOrt ? ", " + t.stadionOrt : "") : null],
      ["Stadion eröffnet", t.stadionEroeffnet],
      ["Stadion-Hinweis", t.stadionHinweis || (t.stadionGeteilt ? "Wird geteilt mit " + teamName(t.stadionGeteilt) + "." : null)],
      ["Gegründet", t.gegruendet],
      ["Super-Bowl-Siege", superBowlText(t)],
      ["Super Bowl", t.superBowlHinweis],
      ["Bilanz " + (daten.tabelle ? daten.tabelle.saison : ""), bilanzText(t.kuerzel)],
      ["Division-Rivalen", rivalenText(t)],
      ["Kader", kaderText(t.kuerzel)],
      ["Quarterbacks", quarterbackText(t.kuerzel)]
    ].forEach(function (paar) {
      if (!hat(paar[1])) { return; }
      fakten.appendChild(el("dt", { text: paar[0] }));
      fakten.appendChild(el("dd", { text: String(paar[1]) }));
    });
    detail.appendChild(fakten);
    if (t.profil) { detail.appendChild(el("p", { klasse: "profil", text: t.profil })); }
    detail.appendChild(quellenZeile(t.quellen, t.gelesen));
    karte.appendChild(detail);
    return karte;
  }

  function teamsZeigen(ziel) {
    var teams = teamListe();
    var inhalt = leeren(document.getElementById("thema-inhalt"));
    titelSetzen("Teams");
    if (!teams.length) {
      inhalt.appendChild(ladeProblem(DATEIEN.teams));
      return;
    }
    var gesucht = teams.filter(function (t) { return t.kuerzel === ziel; })[0];
    if (gesucht && teamFilter !== "alle" && gesucht.conference !== teamFilter) { teamFilter = "alle"; }

    inhalt.appendChild(el("p", { klasse: "thema-info", text: "Die 32 Teams der NFL mit Conference, Division, Heimstadion, Gründung und Super-Bowl-Siegen. Antippen klappt ein Team auf." }));
    inhalt.appendChild(filterLeiste(teams));

    var reihenfolge = [];
    var proGruppe = {};
    teams.forEach(function (t) {
      if (teamFilter !== "alle" && t.conference !== teamFilter) { return; }
      var name = t.conference + " " + t.division;
      if (!proGruppe[name]) {
        proGruppe[name] = [];
        reihenfolge.push(name);
      }
      proGruppe[name].push(t);
    });
    reihenfolge.forEach(function (name) {
      inhalt.appendChild(el("h3", { klasse: "gruppe " + name.slice(0, 3).toLowerCase(), text: name }));
      var liste = el("div", { klasse: "eintraege" });
      proGruppe[name].forEach(function (t) { liste.appendChild(teamKarte(t)); });
      inhalt.appendChild(liste);
    });
    inhalt.appendChild(sammelHinweis(daten.teams));
    zielOeffnen("team-" + ziel, ziel);
  }

  /* ---------- Regeln ---------- */

  function regelStelle(regel, stelle) {
    var knoten = el("article", { klasse: "artikel", id: "regel-" + eintragId(regel, stelle) });
    var nummer = [];
    if (hat(stelle.abschnitt)) { nummer.push("Abschnitt " + stelle.abschnitt); }
    if (hat(stelle.artikel)) { nummer.push("Artikel " + stelle.artikel); }
    knoten.appendChild(el("p", { klasse: "artikel-nummer", text: nummer.length ? nummer.join(" · ") : "Regel " + regel.nummer }));
    knoten.appendChild(el("h3", { klasse: "artikel-titel", text: stelle.titel }));
    absaetze(stelle.text).forEach(function (absatz) {
      knoten.appendChild(el("p", { klasse: "artikel-text", text: absatz }));
    });
    knoten.appendChild(el("p", {
      klasse: "quelle",
      text: "Beleg: " + belegText(regel, stelle) + " · NFL Rulebook 2026" + (hat(stelle.seite) ? ", PDF-Seite " + stelle.seite : "")
    }));
    return knoten;
  }

  function regelKarte(regel) {
    var stellen = regel.eintraege || [];
    var karte = el("details", { klasse: "eintrag regel", id: "regel-" + regel.nummer });
    karte.appendChild(el("summary", null, [
      el("span", { klasse: "kuerzel", text: String(regel.nummer) }),
      el("span", { klasse: "eintrag-text" }, [
        el("span", { klasse: "eintrag-titel", text: regel.titel }),
        el("span", { klasse: "eintrag-zeile", text: "Regel " + regel.nummer + (regel.englisch ? " · " + regel.englisch : "") + " · " + stellen.length + (stellen.length === 1 ? " Stelle" : " Stellen") })
      ])
    ]));
    var detail = el("div", { klasse: "eintrag-detail" });
    if (regel.kurz) { detail.appendChild(el("p", { klasse: "profil", text: regel.kurz })); }
    stellen.forEach(function (stelle) { detail.appendChild(regelStelle(regel, stelle)); });
    karte.appendChild(detail);
    return karte;
  }

  function regelnZeigen(ziel) {
    var regeln = regelListe();
    var inhalt = leeren(document.getElementById("thema-inhalt"));
    titelSetzen("Regeln");
    if (!regeln.length) {
      inhalt.appendChild(ladeProblem(DATEIEN.regeln));
      return;
    }
    inhalt.appendChild(el("p", { klasse: "thema-info", text: "Die Regeln der NFL in eigenen Worten. Die Nummer zeigt, wo die Stelle im offiziellen Regelbuch 2026 steht. Maßgeblich ist immer das Regelbuch selbst." }));
    var suchFeld = el("input", { type: "search", klasse: "regel-suche", placeholder: "In den Regeln suchen, zum Beispiel Holding oder 4.2", "aria-label": "Regeln durchsuchen", autocomplete: "off", spellcheck: "false" });
    var suchInfo = el("p", { klasse: "thema-info" });
    var liste = el("div", { klasse: "eintraege" });
    regeln.forEach(function (r) { liste.appendChild(regelKarte(r)); });
    inhalt.appendChild(suchFeld);
    inhalt.appendChild(suchInfo);
    inhalt.appendChild(liste);
    suchFeld.addEventListener("input", function () {
      var begriffe = normal(suchFeld.value).split(/\s+/).filter(Boolean);
      var treffer = 0;
      regeln.forEach(function (r) {
        var karte = document.getElementById("regel-" + r.nummer);
        var kopfText = normal(["regel", r.nummer, r.titel, r.englisch, r.kurz].join(" "));
        var passtRegel = begriffe.every(function (b) { return kopfText.indexOf(b) !== -1; });
        var sichtbar = 0;
        (r.eintraege || []).forEach(function (e) {
          var knoten = document.getElementById("regel-" + eintragId(r, e));
          var text = normal([r.nummer, r.titel, e.titel, absaetze(e.text).join(" "), (e.stichwoerter || []).join(" "), eintragId(r, e)].join(" "));
          var passt = !begriffe.length || passtRegel || begriffe.every(function (b) { return text.indexOf(b) !== -1; });
          if (knoten) { knoten.hidden = !passt; }
          if (passt) { sichtbar++; }
        });
        var zeigen = !begriffe.length || passtRegel || sichtbar > 0;
        if (karte) {
          karte.hidden = !zeigen;
          if (begriffe.length && zeigen) { karte.open = true; }
          if (!begriffe.length) { karte.open = false; }
        }
        if (zeigen && begriffe.length) { treffer += passtRegel ? (r.eintraege || []).length || 1 : sichtbar; }
      });
      suchInfo.textContent = !begriffe.length ? "" : treffer ? treffer + " passende Regelstellen" : "Nichts gefunden. Versuch ein anderes Stichwort oder eine Nummer.";
    });
    inhalt.appendChild(sammelHinweis(daten.regeln));
    zielOeffnen("regel-" + ziel.split(".")[0], ziel);
  }

  /* ---------- Spieler ---------- */

  var STATFELDER = [
    ["spiele", "Spiele"],
    ["completions", "Pässe angekommen"], ["attempts", "Passversuche"], ["passing_yards", "Passing Yards"], ["passing_tds", "Passing TD"], ["passing_interceptions", "Interceptions geworfen"],
    ["carries", "Läufe"], ["rushing_yards", "Rushing Yards"], ["rushing_tds", "Rushing TD"],
    ["targets", "Targets"], ["receptions", "Receptions"], ["receiving_yards", "Receiving Yards"], ["receiving_tds", "Receiving TD"],
    ["def_tackles_solo", "Tackles (allein)"], ["def_tackle_assists", "Tackle-Assists"], ["def_tackles_for_loss", "Tackles for Loss"], ["def_sacks", "Sacks"], ["def_interceptions", "Interceptions (Abwehr)"], ["def_pass_defended", "Pässe abgewehrt"], ["def_fumbles_forced", "Fumbles erzwungen"],
    ["fg_made", "Field Goals getroffen"], ["fg_att", "Field-Goal-Versuche"], ["fg_long", "Längstes Field Goal"], ["pat_made", "Extrapunkte getroffen"], ["pat_att", "Extrapunkt-Versuche"],
    ["fumbles_verloren", "Fumbles verloren"]
  ];

  function groesseText(zoll) {
    if (!hat(zoll)) { return null; }
    var cm = Math.round(zoll * 2.54);
    return Math.floor(zoll / 12) + " ft " + (zoll % 12) + " in (" + cm + " cm)";
  }

  function gewichtText(pfund) {
    return hat(pfund) ? pfund + " lb (" + Math.round(pfund * 0.4536) + " kg)" : null;
  }

  function spielerKarte(s) {
    var karte = el("details", { klasse: "eintrag", id: "spieler-" + (s.id || "") });
    karte.appendChild(el("summary", null, [
      el("span", { klasse: "kuerzel", text: hat(s.nr) ? "#" + s.nr : s.team }),
      el("span", { klasse: "eintrag-text" }, [
        el("span", { klasse: "eintrag-titel", text: s.name }),
        el("span", { klasse: "eintrag-zeile", text: (s.pos || "?") + " · " + teamName(s.team) })
      ])
    ]));
    var detail = el("div", { klasse: "eintrag-detail" });
    var fakten = el("dl", { klasse: "fakten" });
    [
      ["Team", teamName(s.team)],
      ["Position", s.pos],
      ["Rückennummer", s.nr],
      ["Größe", groesseText(s.groesse)],
      ["Gewicht", gewichtText(s.gewicht)],
      ["College", s.college],
      ["Geboren", s.geboren ? datumZeigen(s.geboren) : null],
      ["Jahre in der NFL", s.erfahrung],
      ["Draft", hat(s.einstieg) ? s.einstieg + (hat(s.draft_pick) ? ", Pick " + s.draft_pick : "") + (s.draft_team ? " (" + s.draft_team + ")" : "") : null],
      ["Status", s.status]
    ].forEach(function (paar) {
      if (!hat(paar[1])) { return; }
      fakten.appendChild(el("dt", { text: paar[0] }));
      fakten.appendChild(el("dd", { text: String(paar[1]) }));
    });
    detail.appendChild(fakten);

    var zahlen = daten.statistik && daten.statistik.spieler && s.id ? daten.statistik.spieler[s.id] : null;
    if (zahlen) {
      detail.appendChild(el("p", { klasse: "profil", text: "Statistik Saison " + daten.statistik.saison + " (Hauptrunde)" }));
      var stat = el("dl", { klasse: "fakten" });
      STATFELDER.forEach(function (paar) {
        if (!hat(zahlen[paar[0]])) { return; }
        stat.appendChild(el("dt", { text: paar[1] }));
        stat.appendChild(el("dd", { text: String(zahlen[paar[0]]) }));
      });
      detail.appendChild(stat);
    } else {
      detail.appendChild(el("p", { klasse: "quelle", text: "Keine Statistik in dieser Saison." }));
    }
    karte.appendChild(detail);
    return karte;
  }

  function optionen(auswahl, werte, alle, aktuell) {
    auswahl.appendChild(el("option", { value: "alle", text: alle }));
    werte.forEach(function (w) {
      auswahl.appendChild(el("option", { value: w.wert, text: w.text, selected: aktuell === w.wert }));
    });
    auswahl.value = aktuell;
  }

  function spielerZeigen(ziel) {
    var alle = spielerListe();
    var inhalt = leeren(document.getElementById("thema-inhalt"));
    titelSetzen("Spieler");
    if (!alle.length) {
      inhalt.appendChild(ladeProblem(DATEIEN.spieler));
      return;
    }
    var gesucht = ziel ? alle.filter(function (s) { return s.id === ziel || s.name === ziel; })[0] : null;
    if (gesucht) { spielerFilter = { team: "alle", pos: "alle", text: gesucht.name }; }

    inhalt.appendChild(el("p", { klasse: "thema-info", text: "Alle Spieler der Kader mit Position, Team, Größe, Gewicht und College. Antippen zeigt die Zahlen der Saison." }));

    var teams = teamListe().map(function (t) { return { wert: t.kuerzel, text: t.name }; });
    var posWerte = {};
    alle.forEach(function (s) { if (s.pos) { posWerte[s.pos] = true; } });
    var positionen = Object.keys(posWerte).sort().map(function (p) { return { wert: p, text: p }; });

    var teamAuswahl = el("select", { "aria-label": "Team wählen" });
    optionen(teamAuswahl, teams, "Alle Teams", spielerFilter.team);
    var posAuswahl = el("select", { "aria-label": "Position wählen" });
    optionen(posAuswahl, positionen, "Alle Positionen", spielerFilter.pos);
    var textFeld = el("input", { type: "search", placeholder: "Name oder College", "aria-label": "Spieler suchen", autocomplete: "off", spellcheck: "false" });
    textFeld.value = spielerFilter.text;

    var filter = el("div", { klasse: "filter filter-spieler" }, [textFeld, teamAuswahl, posAuswahl]);
    var kopf = el("p", { klasse: "thema-info" });
    var liste = el("div", { klasse: "eintraege" });
    inhalt.appendChild(filter);
    inhalt.appendChild(kopf);
    inhalt.appendChild(liste);
    inhalt.appendChild(el("p", { klasse: "quelle", text: "Kader der Woche " + daten.spieler.kaderwoche + ", Stand " + datumZeigen(daten.spieler.stand) + ". Quelle: " + daten.spieler.quelle + "." }));

    function neuZeichnen() {
      spielerFilter = { team: teamAuswahl.value, pos: posAuswahl.value, text: textFeld.value };
      var begriffe = normal(spielerFilter.text).split(/\s+/).filter(Boolean);
      var treffer = alle.filter(function (s) {
        if (spielerFilter.team !== "alle" && s.team !== spielerFilter.team) { return false; }
        if (spielerFilter.pos !== "alle" && s.pos !== spielerFilter.pos) { return false; }
        var heu = normal([s.name, s.college].join(" "));
        return begriffe.every(function (b) { return heu.indexOf(b) !== -1; });
      });
      leeren(liste);
      treffer.slice(0, MAX_SPIELER).forEach(function (s) { liste.appendChild(spielerKarte(s)); });
      kopf.textContent = !treffer.length ? "Kein Spieler gefunden."
        : treffer.length > MAX_SPIELER ? "Die ersten " + MAX_SPIELER + " von " + treffer.length + " Spielern. Grenze mit Team, Position oder Name weiter ein."
        : treffer.length + (treffer.length === 1 ? " Spieler" : " Spieler");
      return treffer;
    }
    [teamAuswahl, posAuswahl].forEach(function (f) { f.addEventListener("change", neuZeichnen); });
    textFeld.addEventListener("input", neuZeichnen);
    var gefunden = neuZeichnen();
    window.scrollTo(0, 0);
    if (gesucht && gefunden.length) {
      var karte = document.getElementById("spieler-" + gesucht.id);
      if (karte) { karte.open = true; karte.scrollIntoView({ block: "start" }); }
    }
  }

  /* ---------- Statistik ---------- */

  function statistikZeigen() {
    var inhalt = leeren(document.getElementById("thema-inhalt"));
    titelSetzen("Statistik");
    var stat = daten.statistik && daten.statistik.spieler;
    if (!stat) {
      inhalt.appendChild(ladeProblem(DATEIEN.statistik));
      return;
    }
    inhalt.appendChild(el("p", { klasse: "thema-info", text: "Die zehn Besten der Saison " + daten.statistik.saison + " (Hauptrunde) in zehn Wertungen. Antippen eines Namens öffnet den Spieler." }));
    BESTENLISTEN.forEach(function (b) {
      var reihe = Object.keys(stat).filter(function (id) {
        if (!hat(stat[id][b.feld])) { return false; }
        var s = spielerInfo(id);
        return !b.pos || (s && b.pos.indexOf(s.pos) !== -1);
      }).sort(function (a, c) { return stat[c][b.feld] - stat[a][b.feld]; }).slice(0, 10);
      inhalt.appendChild(el("h3", { klasse: "gruppe", text: b.titel }));
      var tabelle = el("table", { klasse: "tabelle" });
      tabelle.appendChild(el("tr", null, [el("th", { text: "#" }), el("th", { text: "Spieler" }), el("th", { text: "Team" }), el("th", { text: b.einheit })]));
      reihe.forEach(function (id, i) {
        var s = spielerInfo(id);
        var namensKnoten = !s ? "Name fehlt (" + id + ")"
          : s.imKader ? el("a", { href: "#spieler/" + encodeURIComponent(id), text: s.name })
          : s.name + (s.pos ? " (" + s.pos + ", nicht im aktuellen Kader)" : " (nicht im aktuellen Kader)");
        tabelle.appendChild(el("tr", null, [
          el("td", { text: String(i + 1) }),
          el("td", null, [namensKnoten]),
          el("td", { text: s && s.team ? s.team : "" }),
          el("td", { text: String(stat[id][b.feld]) })
        ]));
      });
      inhalt.appendChild(tabelle);
    });
    inhalt.appendChild(el("p", { klasse: "quelle", text: "Stand " + datumZeigen(daten.statistik.stand) + ". Quelle: " + daten.statistik.quelle + "." }));
    window.scrollTo(0, 0);
  }

  /* ---------- Tabelle ---------- */

  function tabelleZeigen() {
    var inhalt = leeren(document.getElementById("thema-inhalt"));
    titelSetzen("Tabelle");
    var t = daten.tabelle;
    if (!t || !t.divisionen) {
      inhalt.appendChild(ladeProblem(DATEIEN.tabelle));
      return;
    }
    inhalt.appendChild(el("p", { klasse: "thema-info", text: "Siege, Niederlagen und Punkte der Hauptrunde " + t.saison + ", nach " + t.woche + " Wochen. Antippen eines Teams öffnet das Team." }));
    t.divisionen.forEach(function (d) {
      var farbe = d.division.indexOf("AFC") === 0 ? " afc" : d.division.indexOf("NFC") === 0 ? " nfc" : "";
      inhalt.appendChild(el("h3", { klasse: "gruppe" + farbe, text: d.division }));
      var tabelle = el("table", { klasse: "tabelle" + farbe });
      tabelle.appendChild(el("tr", null, ["Team", "S", "N", "U", "Pkt", "Gegen"].map(function (k) { return el("th", { text: k }); })));
      d.teams.forEach(function (r) {
        tabelle.appendChild(el("tr", null, [
          el("td", null, [el("a", { href: "#teams/" + r.team, text: teamName(r.team) })]),
          el("td", { text: String(r.siege) }),
          el("td", { text: String(r.niederlagen) }),
          el("td", { text: String(r.unentschieden) }),
          el("td", { text: String(r.punkte) }),
          el("td", { text: String(r.gegen) })
        ]));
      });
      inhalt.appendChild(tabelle);
    });
    inhalt.appendChild(el("p", { klasse: "quelle", text: "S = Siege, N = Niederlagen, U = Unentschieden, Pkt = erzielte Punkte, Gegen = Gegenpunkte. " + (t.hinweis || "") + " Stand " + datumZeigen(t.stand) + ". Quelle: " + t.quelle + "." }));
    window.scrollTo(0, 0);
  }

  /* ---------- Spielplan ---------- */

  // Rechnet Datum und Uhrzeit in US-Ostzeit (ET) in deutsche Zeit um, mit Sommer- und Winterzeit beider Seiten.
  function inDeutsch(datum, zeit) {
    if (!datum || !zeit) { return { datum: datum || "", zeit: zeit || "", stempel: 0, deutsch: false }; }
    try {
      var d = datum.split("-").map(Number);
      var t = zeit.split(":").map(Number);
      var raten = Date.UTC(d[0], d[1] - 1, d[2], t[0], t[1]);
      var ny = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });
      var p = {};
      ny.formatToParts(new Date(raten)).forEach(function (x) { p[x.type] = parseInt(x.value, 10); });
      var offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - raten;
      var echt = raten - offset;
      var de = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
      var q = {};
      de.formatToParts(new Date(echt)).forEach(function (x) { q[x.type] = x.value; });
      return { datum: q.year + "-" + q.month + "-" + q.day, zeit: q.hour + ":" + q.minute, stempel: echt, deutsch: true };
    } catch (e) {
      return { datum: datum, zeit: zeit, stempel: 0, deutsch: false };
    }
  }

  function spielplanZeigen() {
    var inhalt = leeren(document.getElementById("thema-inhalt"));
    titelSetzen("Spielplan");
    var plan = daten.spielplan;
    var spiele = (plan && plan.spiele) || [];
    if (!spiele.length) {
      inhalt.appendChild(ladeProblem(DATEIEN.spielplan));
      return;
    }
    var wochen = [];
    spiele.forEach(function (s) { if (wochen.indexOf(s.woche) === -1) { wochen.push(s.woche); } });
    wochen.sort(function (a, b) { return a - b; });
    // Aktuelle Woche: die erste mit einem Spiel ohne Ergebnis, sonst die letzte.
    var aktuell = wochen[wochen.length - 1];
    for (var i = 0; i < wochen.length; i++) {
      var offen = spiele.some(function (s) { return s.woche === wochen[i] && !hat(s.heimPunkte); });
      if (offen) { aktuell = wochen[i]; break; }
    }
    if (planFilter.woche === null || wochen.indexOf(planFilter.woche) === -1) { planFilter.woche = aktuell; }

    inhalt.appendChild(el("p", { klasse: "thema-info", text: "Alle Spiele der Hauptrunde " + plan.saison + ". Wähle eine Woche oder ein Team. Datum und Uhrzeit in deutscher Zeit (umgerechnet aus US-Ostzeit). Späte Spiele rutschen dadurch oft auf den nächsten Tag." }));
    var wochenAuswahl = el("select", { "aria-label": "Woche wählen" });
    wochen.forEach(function (w) {
      wochenAuswahl.appendChild(el("option", { value: String(w), text: "Woche " + w + (w === aktuell ? " (aktuell)" : "") }));
    });
    wochenAuswahl.appendChild(el("option", { value: "alle", text: "Alle Wochen" }));
    wochenAuswahl.value = planFilter.woche === "alle" ? "alle" : String(planFilter.woche);
    var teamAuswahl = el("select", { "aria-label": "Team wählen" });
    optionen(teamAuswahl, teamListe().map(function (t) { return { wert: t.kuerzel, text: t.name }; }), "Alle Teams", planFilter.team);
    inhalt.appendChild(el("div", { klasse: "filter filter-spieler" }, [wochenAuswahl, teamAuswahl]));
    var kopf = el("p", { klasse: "thema-info" });
    var liste = el("div", { klasse: "eintraege" });
    inhalt.appendChild(kopf);
    inhalt.appendChild(liste);

    function neuZeichnen() {
      planFilter.woche = wochenAuswahl.value === "alle" ? "alle" : parseInt(wochenAuswahl.value, 10);
      planFilter.team = teamAuswahl.value;
      leeren(liste);
      var treffer = spiele.filter(function (s) {
        if (planFilter.woche !== "alle" && s.woche !== planFilter.woche) { return false; }
        return planFilter.team === "alle" || s.heim === planFilter.team || s.gast === planFilter.team;
      }).map(function (s) {
        return { s: s, de: inDeutsch(s.datum, s.zeit) };
      }).sort(function (a, b) {
        return (a.s.woche - b.s.woche) || (a.de.stempel - b.de.stempel);
      });
      var letzte = null;
      treffer.forEach(function (eintrag) {
        var s = eintrag.s;
        var de = eintrag.de;
        var gruppe = "Woche " + s.woche + " · " + datumZeigen(de.datum);
        if (gruppe !== letzte) { liste.appendChild(el("h3", { klasse: "gruppe", text: gruppe })); letzte = gruppe; }
        var fertig = hat(s.heimPunkte) && hat(s.gastPunkte);
        liste.appendChild(el("div", { klasse: "eintrag spiel" }, [
          el("div", { klasse: "eintrag-text", style: "padding:10px 12px" }, [
            el("span", { klasse: "eintrag-titel", text: teamName(s.gast) + " @ " + teamName(s.heim) }),
            el("span", { klasse: "eintrag-zeile", text: fertig ? "Endstand " + s.gastPunkte + " : " + s.heimPunkte : (s.zeit ? de.zeit + (de.deutsch ? " Uhr" : " Uhr ET") : "Zeit offen") })
          ])
        ]));
      });
      if (planFilter.woche !== "alle") {
        var spielt = {};
        spiele.forEach(function (s) { if (s.woche === planFilter.woche) { spielt[s.heim] = true; spielt[s.gast] = true; } });
        var bye = teamListe().filter(function (t) { return !spielt[t.kuerzel]; }).map(function (t) { return t.name; });
        if (bye.length && planFilter.team === "alle") { liste.appendChild(el("p", { klasse: "quelle", text: "Spielfrei (Bye): " + bye.join(", ") })); }
      }
      kopf.textContent = treffer.length ? treffer.length + (treffer.length === 1 ? " Spiel" : " Spiele") : "Kein Spiel gefunden.";
    }
    wochenAuswahl.addEventListener("change", neuZeichnen);
    teamAuswahl.addEventListener("change", neuZeichnen);
    neuZeichnen();
    inhalt.appendChild(el("p", { klasse: "quelle", text: "Stand " + datumZeigen(plan.stand) + ". Quelle: " + plan.quelle + "." }));
    window.scrollTo(0, 0);
  }

  /* ---------- Leerstellen ---------- */

  function leerstelleZeigen(l) {
    var inhalt = leeren(document.getElementById("thema-inhalt"));
    titelSetzen(l.titel);
    inhalt.appendChild(el("div", { klasse: "leerstelle" }, [
      el("span", { klasse: "leer-marke", text: "Leerstelle" }),
      el("p", { klasse: "leer-text", text: l.text }),
      el("p", { klasse: "leer-datei" }, ["Vorgesehene Datei: ", el("code", { text: l.datei })])
    ]));
    window.scrollTo(0, 0);
  }

  /* ---------- Ansichten wechseln ---------- */

  function fehlerZeigen(text) {
    var feld = document.getElementById("fehler");
    feld.textContent = text || "";
    feld.hidden = !text;
  }

  function zeigen() {
    var roh = location.hash.replace(/^#/, "");
    try {
      roh = decodeURIComponent(roh);
    } catch (e) {
      roh = "";
    }
    var teile = roh.split("/");
    var thema = teile[0];
    var ziel = teile.slice(1).join("/");
    var leerstelle = LEERSTELLEN.filter(function (l) { return l.id === thema; })[0];
    var start = document.getElementById("start");
    var seite = document.getElementById("thema");

    try {
      if (["teams", "regeln", "spieler", "statistik", "tabelle", "spielplan"].indexOf(thema) !== -1 || leerstelle) {
        start.hidden = true;
        seite.hidden = false;
        document.body.setAttribute("data-ansicht", "thema");
        if (thema === "teams") {
          teamsZeigen(ziel);
        } else if (thema === "regeln") {
          regelnZeigen(ziel);
        } else if (thema === "spieler") {
          spielerZeigen(ziel);
        } else if (thema === "statistik") {
          statistikZeigen();
        } else if (thema === "tabelle") {
          tabelleZeigen();
        } else if (thema === "spielplan") {
          spielplanZeigen();
        } else {
          leerstelleZeigen(leerstelle);
        }
        if (letztesThema !== thema) { document.getElementById("thema-titel").focus({ preventScroll: true }); }
        letztesThema = thema;
      } else {
        seite.hidden = true;
        start.hidden = false;
        document.body.setAttribute("data-ansicht", "start");
        document.title = "Football Brain: Wiki";
        letztesThema = null;
        window.scrollTo(0, 0);
      }
    } catch (problem) {
      fehlerZeigen("Die Ansicht ließ sich nicht aufbauen: " + (problem && problem.message ? problem.message : problem));
    }
  }

  /* ---------- Start ---------- */

  function starten() {
    var namen = Object.keys(DATEIEN);
    Promise.all(namen.map(function (name) {
      return laden(DATEIEN[name]).then(
        function (inhalt) { daten[name] = inhalt; },
        function (problem) { fehler[name] = problem && problem.message ? problem.message : String(problem); }
      );
    })).then(function () {
      document.getElementById("laden").hidden = true;
      var nichtGeladen = Object.keys(fehler).filter(function (n) { return n !== "namen" && n !== "spielplan"; });
      if (nichtGeladen.length) {
        fehlerZeigen("Nicht alles ließ sich laden: " + nichtGeladen.map(function (n) { return DATEIEN[n] + " (" + fehler[n] + ")"; }).join(", ") + ". Öffnest du die Seite direkt aus dem Ordner, blockiert der Browser das Laden; über die Vorschau-Adresse oder einen kleinen lokalen Server funktioniert es.");
      }
      spielerListe().forEach(function (s) { if (s.id) { spielerNachId[s.id] = s; } });
      suchindexBauen();
      themenAufbauen();

      var suchfeld = document.getElementById("suche");
      suchfeld.addEventListener("input", function () { suchen(suchfeld.value); });
      document.getElementById("suche-form").addEventListener("submit", function (ereignis) { ereignis.preventDefault(); });
      window.addEventListener("hashchange", zeigen);
      zeigen();
    }).catch(function (problem) {
      document.getElementById("laden").hidden = true;
      fehlerZeigen("Der Aufbau ist fehlgeschlagen: " + (problem && problem.message ? problem.message : problem));
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", starten);
  } else {
    starten();
  }
})();
