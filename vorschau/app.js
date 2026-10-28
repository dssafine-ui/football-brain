// Football Brain: lädt die Fragen aus fragen.json und merkt sich den Fortschritt auf diesem Gerät (localStorage).
// Kein Konto, kein Server: Wissensstufe, freigeschaltete Stufen, Punkte, Serie, gesehene Fragen und Ergebnisse bleiben im Browser.
// Das Tagesquiz hat fünf Fragen. Danach lassen sich ohne Obergrenze weitere neue Fragen spielen, immer zufällig aus allen Themen.
// Highschool ist von Anfang an offen. College und NFL werden frei, sobald man auf der Stufe davor genug Punkte gesammelt hat.
// Neue Fragen zählen immer für die nächste Stufe, Wiederholungen in der Übungsrunde nur, wenn auf der Stufe alle neuen Fragen durch sind.
// Dazu: Einführung beim ersten Start, Fortschritt per Code auf ein anderes Gerät mitnehmen, Fragen melden, beantwortete Fragen nachlesen.
(function () {
  'use strict';

  // Die Vorschau liegt im Unterordner /vorschau/ derselben Domain. Der Browserspeicher gilt je Domain, nicht je Ordner:
  // Ohne eigenen Schlüssel würde die Vorschau den echten Fortschritt lesen und überschreiben.
  const IN_VORSCHAU = /\/vorschau(\/|$)/.test(window.location.pathname);
  const SPEICHER_KEY = 'football-tagesquiz-fortschritt-v1' + (IN_VORSCHAU ? '-vorschau' : '');
  // Stand der App-Dateien (steht unten auf der Startseite, damit sich nach einem Upload nachprüfen lässt, ob die neue Fassung läuft).
  const APP_STAND = '2026-10-28';
  // Der Code zum Mitnehmen des Fortschritts beginnt immer so. Daran erkennt die App, ob ein eingefügter Text überhaupt ein Code ist.
  const CODE_KOPF = 'FB1:';
  const FRAGEN_PRO_RUNDE = 5;
  const BUCHSTABEN = ['A', 'B', 'C', 'D', 'E', 'F'];
  const ABSCHNITTE = ['laden', 'start', 'frage', 'ergebnis', 'nachlesen', 'fehler'];
  const WOCHENTAGE_KURZ = ['M', 'D', 'M', 'D', 'F', 'S', 'S'];
  const WOCHENTAGE_LANG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
  // Umfang des Tagesrings (Radius 50 in der Zeichnung von index.html).
  const RING_UMFANG = 2 * Math.PI * 50;
  const NEULADEN_NACH_MS = 30 * 60 * 1000;
  // Die Wissensstufe sagt, wie schwer eine Frage ist. Mit dem Thema (Kategorie) hat sie nichts zu tun.
  // freiAb: So viele Punkte braucht man auf der Stufe davor, damit diese Stufe frei wird. Die erste Stufe ist von Anfang an offen.
  // thema: Wofür die Stufe steht. Das steht in der Einführung und folgt den Kriterien für die Einstufung der Fragen.
  const STUFEN = [
    { nummer: 1, name: 'Highschool', hinweis: 'leicht', thema: 'Grundregeln, Positionen und leichtes Allgemeinwissen', freiAb: 0 },
    { nummer: 2, name: 'College', hinweis: 'mittel', thema: 'Spezialregeln, Spielzüge und wichtige Personen', freiAb: 100 },
    { nummer: 3, name: 'NFL', hinweis: 'schwer', thema: 'besondere Spielzüge, Personen und hohes Allgemeinwissen', freiAb: 200 },
  ];
  // Neue Spieler starten bei den leichten Fragen (Highschool). STANDARD_STUFE gilt nur für Fragen, in denen die Stufe fehlt.
  const START_STUFE = 1;
  const STANDARD_STUFE = 2;
  // Neue Fragen (Tagesquiz und weitere Fragen) zählen voll, Wiederholungen in der Übungsrunde halb.
  const PUNKTE_NEU = 10;
  const PUNKTE_UEBUNG = 5;
  // Rundenarten: tag = Tagesquiz, mehr = weitere neue Fragen nach dem Tagesquiz, ueben = alte Fragen wiederholen.
  const RUNDENNAMEN = { tag: 'Tagesquiz', mehr: 'Weitere Fragen', ueben: 'Übungsrunde' };

  let fragen = [];
  let fragenNachId = {};
  let listenStand = '';
  let speicher = leererSpeicher();
  let speicherGeht = true;
  let runde = null;
  let position = 0;
  let ergebnisRunde = null;
  // Das Thema, das im Nachlesen gerade offen ist (null: die Übersicht der Themen).
  let nachlesenThema = null;

  function $(id) {
    return document.getElementById(id);
  }

  function istObjekt(wert) {
    return wert !== null && typeof wert === 'object' && !Array.isArray(wert);
  }

  // ---------- Datum ----------

  function tagString(datum) {
    const monat = String(datum.getMonth() + 1).padStart(2, '0');
    const tag = String(datum.getDate()).padStart(2, '0');
    return datum.getFullYear() + '-' + monat + '-' + tag;
  }

  function heute() {
    return tagString(new Date());
  }

  function tagZuDatum(tag) {
    const teile = tag.split('-').map(Number);
    return new Date(teile[0], teile[1] - 1, teile[2]);
  }

  function tagDavor(tag) {
    const datum = tagZuDatum(tag);
    datum.setDate(datum.getDate() - 1);
    return tagString(datum);
  }

  function datumKurz(tag) {
    const teile = tag.split('-');
    return teile[2] + '.' + teile[1] + '.' + teile[0];
  }

  function datumLang(datum) {
    return datum.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  // ---------- Speicher ----------

  function leererSpeicher() {
    // stufenPunkte: Punkte je Wissensstufe (Stelle 0 = Stufe 1). freigabe: die höchste Stufe, die schon spielbar ist.
    // erklaert: Die Einführung auf der Startseite wurde schon gesehen.
    return { v: 1, fragen: {}, tage: {}, runde: null, stufe: START_STUFE, punkte: 0, stufenPunkte: STUFEN.map(() => 0), freigabe: START_STUFE, erklaert: false };
  }

  // Macht aus gespeicherten oder eingefügten Daten einen sauberen Stand. Was nicht passt, bleibt auf dem Anfangswert.
  function standAusDaten(daten) {
    const frisch = leererSpeicher();
    if (istObjekt(daten.fragen)) frisch.fragen = daten.fragen;
    if (istObjekt(daten.tage)) frisch.tage = daten.tage;
    if (istObjekt(daten.runde)) frisch.runde = daten.runde;
    if (stufeGueltig(daten.stufe)) frisch.stufe = daten.stufe;
    if (Number.isFinite(daten.punkte) && daten.punkte >= 0) frisch.punkte = Math.floor(daten.punkte);
    if (Array.isArray(daten.stufenPunkte)) {
      STUFEN.forEach((stufe, i) => {
        const wert = daten.stufenPunkte[i];
        if (Number.isFinite(wert) && wert >= 0) frisch.stufenPunkte[i] = Math.floor(wert);
      });
    }
    // Ein Stand von vor der Freischaltung kennt keine Freigabe: Die Stufe, auf der schon gespielt wurde, bleibt offen.
    if (stufeGueltig(daten.freigabe)) frisch.freigabe = daten.freigabe;
    else frisch.freigabe = Math.max(START_STUFE, frisch.stufe);
    // Gespeichert ist nie eine gesperrte Stufe als gewählte Stufe; sollte es doch so sein, gilt die höchste freie.
    if (frisch.stufe > frisch.freigabe) frisch.stufe = frisch.freigabe;
    // Wer schon gespielt hat, braucht die Einführung nicht mehr.
    frisch.erklaert = daten.erklaert === true || frisch.punkte > 0 || Object.keys(frisch.tage).length > 0;
    return frisch;
  }

  function speicherLaden() {
    try {
      const roh = window.localStorage.getItem(SPEICHER_KEY);
      const daten = roh ? JSON.parse(roh) : null;
      if (istObjekt(daten)) return standAusDaten(daten);
    } catch (fehler) {
      // Lesen nicht erlaubt oder Daten kaputt: sauber von vorn anfangen.
    }
    return leererSpeicher();
  }

  function speicherSichern() {
    try {
      window.localStorage.setItem(SPEICHER_KEY, JSON.stringify(speicher));
      speicherGeht = true;
    } catch (fehler) {
      speicherGeht = false;
    }
  }

  // ---------- Fortschritt mitnehmen ----------

  function textZuBase64(text) {
    let binaer = '';
    new TextEncoder().encode(text).forEach((byte) => {
      binaer += String.fromCharCode(byte);
    });
    return window.btoa(binaer);
  }

  function base64ZuText(base64) {
    const binaer = window.atob(base64);
    const bytes = new Uint8Array(binaer.length);
    for (let i = 0; i < binaer.length; i++) bytes[i] = binaer.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  // Der Code hält den Stand ohne die Einzelheiten alter Tage und ohne laufende Runde. So bleibt er kurz.
  // Von alten Tagen zählt nur, dass an ihnen gespielt wurde (für die Serie); die Einzelheiten von heute bleiben dabei.
  function fortschrittCode() {
    const heuteTag = heute();
    const tage = {};
    Object.keys(speicher.tage).forEach((tag) => {
      const eintrag = speicher.tage[tag];
      const runden = istObjekt(eintrag) && Number.isFinite(eintrag.runden) ? eintrag.runden : 1;
      tage[tag] = tag === heuteTag ? eintrag : { runden: runden };
    });
    const stand = Object.assign({}, speicher, { tage: tage, runde: null });
    return CODE_KOPF + textZuBase64(JSON.stringify(stand));
  }

  // Gibt den Stand aus einem eingefügten Code zurück, oder null, wenn der Text kein vollständiger Code ist.
  function fortschrittAusCode(text) {
    const code = String(text || '').replace(/\s+/g, '');
    if (code.indexOf(CODE_KOPF) !== 0) return null;
    try {
      const daten = JSON.parse(base64ZuText(code.slice(CODE_KOPF.length)));
      return istObjekt(daten) && daten.v === 1 ? standAusDaten(daten) : null;
    } catch (fehler) {
      return null;
    }
  }

  function standKurz(stand) {
    const serie = serieBerechnen(stand);
    return stand.punkte.toLocaleString('de-DE') + ' Punkte, ' + serie + (serie === 1 ? ' Tag' : ' Tage') + ' in Serie';
  }

  // ---------- Fragen und Runden ----------

  function frageGueltig(frage) {
    return (
      istObjekt(frage) &&
      typeof frage.id === 'string' &&
      frage.id !== '' &&
      typeof frage.frage === 'string' &&
      frage.frage !== '' &&
      Array.isArray(frage.antworten) &&
      frage.antworten.length >= 2 &&
      frage.antworten.length <= BUCHSTABEN.length &&
      frage.antworten.every((antwort) => typeof antwort === 'string' && antwort !== '') &&
      Number.isInteger(frage.richtig) &&
      frage.richtig >= 0 &&
      frage.richtig < frage.antworten.length
    );
  }

  function stufeGueltig(wert) {
    return Number.isInteger(wert) && wert >= 1 && wert <= STUFEN.length;
  }

  // Fehlt die Stufe in der Fragenliste, gilt die Frage als mittelschwer.
  function stufeVon(frage) {
    return stufeGueltig(frage.stufe) ? frage.stufe : STANDARD_STUFE;
  }

  // Die nächste Stufe, die noch gesperrt ist. 0, wenn alle Stufen frei sind.
  function naechsteGesperrte() {
    return speicher.freigabe < STUFEN.length ? speicher.freigabe + 1 : 0;
  }

  // Eine Stufe ist leer gespielt, wenn alle ihre Fragen schon einmal beantwortet wurden.
  function stufeLeer(nummer) {
    return !fragen.some((frage) => stufeVon(frage) === nummer && !istGesehen(frage));
  }

  // Stufe n + 1 wird frei, sobald die Punkte auf Stufe n die Schwelle (freiAb) erreichen. Was frei ist, bleibt frei.
  // Gibt die höchste neu freigeschaltete Stufe zurück, sonst 0.
  function freischaltenPruefen() {
    const vorher = speicher.freigabe;
    while (
      speicher.freigabe < STUFEN.length &&
      speicher.stufenPunkte[speicher.freigabe - 1] >= STUFEN[speicher.freigabe].freiAb
    ) {
      speicher.freigabe += 1;
    }
    return speicher.freigabe > vorher ? speicher.freigabe : 0;
  }

  function punkteJeFrage(art) {
    return art === 'ueben' ? PUNKTE_UEBUNG : PUNKTE_NEU;
  }

  function rundenName(art) {
    return RUNDENNAMEN[art] || 'Runde';
  }

  function istGesehen(frage) {
    const eintrag = speicher.fragen[frage.id];
    return istObjekt(eintrag) && !!eintrag.tag;
  }

  // Tagesquiz, weitere Fragen und Übungsrunde nehmen nur Fragen der gewählten Wissensstufe.
  function ungesehene() {
    return fragen.filter((frage) => stufeVon(frage) === speicher.stufe && !istGesehen(frage));
  }

  function gesehene() {
    return fragen.filter((frage) => stufeVon(frage) === speicher.stufe && istGesehen(frage));
  }

  function ungeseheneInsgesamt() {
    return fragen.filter((frage) => !istGesehen(frage)).length;
  }

  function mischen(liste) {
    const kopie = liste.slice();
    for (let i = kopie.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const merk = kopie[i];
      kopie[i] = kopie[j];
      kopie[j] = merk;
    }
    return kopie;
  }

  // Die angefangene, noch nicht beendete Runde von heute (oder null).
  function aktiveRunde(art) {
    const r = speicher.runde;
    if (!istObjekt(r) || r.fertig || r.art !== art || r.tag !== heute()) return null;
    if (!Array.isArray(r.ids) || !Array.isArray(r.antworten)) return null;
    if (r.ids.length === 0 || r.ids.length !== r.antworten.length) return null;
    if (!r.ids.every((id) => fragenNachId[id])) return null;
    return r;
  }

  // Eine angefangene Runde von heute (Tagesquiz, weitere Fragen oder Übung) hält die Wissensstufe fest.
  function rundeOffen() {
    return !!(aktiveRunde('tag') || aktiveRunde('mehr') || aktiveRunde('ueben'));
  }

  // Die Zahl, mit der eine Antwort beginnt („15 Yards“, „53 1/3 Yards“, „100,0“, „1.000“, „1895“), sonst null.
  function zahlAmAnfang(text) {
    const treffer = /^\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?/.exec(text);
    if (!treffer) return null;
    return parseFloat(treffer[1].replace(/\./g, '') + (treffer[2] ? '.' + treffer[2] : ''));
  }

  // Antworten wie „Alle genannten“ oder „Beide sind richtig“ zeigen auf die anderen Antworten und müssen deshalb hinten bleiben.
  function verweistAufAndere(text) {
    const wort = '(alle|keine|keiner|keines|beide|beides)';
    return (
      new RegExp('^' + wort + '\\.?$', 'i').test(text.trim()) ||
      new RegExp('\\b' + wort + '\\b.{0,30}\\b(genannt\\w*|oben|obigen?|davon|antworten|aussagen|optionen|richtig|stimm\\w*|zutreffend\\w*)\\b', 'i').test(text)
    );
  }

  // Die Reihenfolge der Antworten einer Frage für eine Runde: Stelle für Stelle der Platz in der Fragenliste.
  // Gemischt wird in jeder Runde, damit die richtige Antwort nicht immer unter demselben Buchstaben steht. Zwei Ausnahmen:
  // Bestehen alle Antworten aus Zahlen, stehen sie aufsteigend (ein „15 Yards“ vor „5 Yards“ wäre unnatürlich),
  // und Antworten, die auf die anderen zeigen („Alle genannten“), bleiben hinten.
  function antwortReihenfolge(frage) {
    const plaetze = frage.antworten.map((text, i) => i);
    const zahlen = frage.antworten.map(zahlAmAnfang);
    if (zahlen.every((zahl) => zahl !== null)) {
      return plaetze.sort((a, b) => zahlen[a] - zahlen[b] || a - b);
    }
    const hinten = plaetze.filter((i) => verweistAufAndere(frage.antworten[i]));
    const vorne = mischen(plaetze.filter((i) => hinten.indexOf(i) === -1));
    return vorne.concat(hinten);
  }

  // Die Reihenfolge, in der die Antworten einer Frage in dieser Runde stehen: Stelle für Stelle der Platz in der Fragenliste.
  // Alle Runden mischen (siehe antwortReihenfolge und rundeStarten). Fehlt eine brauchbare gemerkte Reihenfolge, zum Beispiel bei einer Runde,
  // die vor dem Umbau angefangen wurde, bleibt es bei der Reihenfolge der Liste.
  function antwortOrdnung(r, stelle) {
    const anzahl = fragenNachId[r.ids[stelle]].antworten.length;
    const gemerkt = Array.isArray(r.ordnung) ? r.ordnung[stelle] : null;
    const brauchbar =
      Array.isArray(gemerkt) &&
      gemerkt.length === anzahl &&
      gemerkt.every((wert) => Number.isInteger(wert) && wert >= 0 && wert < anzahl) &&
      new Set(gemerkt).size === anzahl;
    if (brauchbar) return gemerkt;
    const reihe = [];
    for (let i = 0; i < anzahl; i++) reihe.push(i);
    return reihe;
  }

  // erledigt: Tagesquiz von heute ist durch. laeuft: angefangen. offen: kann starten. leer: keine neuen Fragen mehr auf der gewählten Stufe.
  function tagZustand() {
    const eintrag = speicher.tage[heute()];
    if (istObjekt(eintrag) && istObjekt(eintrag.tagesquiz)) return 'erledigt';
    if (aktiveRunde('tag')) return 'laeuft';
    return ungesehene().length > 0 ? 'offen' : 'leer';
  }

  // Weitere Fragen: Ist das Tagesquiz von heute durch, gibt es ohne Tageslimit neue Fragen der gewählten Stufe, je Runde fünf.
  // gesperrt: Tagesquiz noch nicht durch. laeuft: angefangen. offen: kann starten. leer: keine neuen Fragen mehr auf der gewählten Stufe.
  function mehrZustand() {
    if (tagZustand() !== 'erledigt') return 'gesperrt';
    if (aktiveRunde('mehr')) return 'laeuft';
    return ungesehene().length > 0 ? 'offen' : 'leer';
  }

  function mehrSichtbar(zustand) {
    return zustand === 'offen' || zustand === 'laeuft';
  }

  function mehrKnopfText(zustand) {
    if (zustand === 'laeuft') return 'Weitere Fragen fortsetzen';
    const anzahl = Math.min(ungesehene().length, FRAGEN_PRO_RUNDE);
    return 'Noch ' + anzahl + (anzahl === 1 ? ' neue Frage' : ' neue Fragen');
  }

  // Neue Fragen von heute: Tagesquiz plus alle weiteren Runden.
  function heuteBilanz() {
    const bilanz = { richtig: 0, von: 0 };
    const eintrag = speicher.tage[heute()];
    if (!istObjekt(eintrag)) return bilanz;
    [eintrag.tagesquiz, eintrag.weitere].forEach((teil) => {
      if (istObjekt(teil) && Number.isFinite(teil.richtig) && Number.isFinite(teil.von)) {
        bilanz.richtig += teil.richtig;
        bilanz.von += teil.von;
      }
    });
    return bilanz;
  }

  function leerHinweis() {
    // Ist die nächste Stufe noch gesperrt, bringt hier nur die Übungsrunde weitere Punkte dafür.
    if (naechsteGesperrte() === speicher.stufe + 1) {
      return 'Auf dieser Stufe sind alle Fragen durch. Die Übungsrunde bringt Punkte für ' + STUFEN[speicher.stufe].name + '.';
    }
    return ungeseheneInsgesamt() > 0
      ? 'Auf dieser Stufe sind alle Fragen durch. Wechsle die Stufe oder nutze die Übungsrunde.'
      : 'Alle Fragen sind durch. Neue gibt es, sobald die Fragenliste ergänzt wird. Bis dahin hilft die Übungsrunde.';
  }

  // Tage in Folge mit mindestens einer beendeten Runde. Ist heute noch nichts gespielt, zählt gestern noch.
  // Ohne Angabe gilt der Stand dieses Geräts; mit Angabe lässt sich auch ein eingelesener Stand ansehen.
  function serieBerechnen(stand) {
    const tage = (stand || speicher).tage;
    let tag = heute();
    if (!tage[tag]) tag = tagDavor(tag);
    let serie = 0;
    while (tage[tag] && serie < 3650) {
      serie += 1;
      tag = tagDavor(tag);
    }
    return serie;
  }

  function auswerten(r) {
    const ids = Array.isArray(r.ids) ? r.ids : [];
    const antworten = Array.isArray(r.antworten) ? r.antworten : [];
    const eintraege = [];
    ids.forEach((id, i) => {
      const frage = fragenNachId[id];
      if (!frage) return;
      eintraege.push({ frage: frage, gewaehlt: antworten[i], richtig: antworten[i] === frage.richtig });
    });
    return {
      eintraege: eintraege,
      richtig: eintraege.filter((eintrag) => eintrag.richtig).length,
      von: eintraege.length,
    };
  }

  function rundeStarten(art) {
    let kandidaten;
    if (art === 'ueben') {
      // Übung: erst die Fragen, die zuletzt falsch waren, dann der Rest.
      const alte = mischen(gesehene());
      const falsche = alte.filter((frage) => speicher.fragen[frage.id].richtig === false);
      const richtige = alte.filter((frage) => speicher.fragen[frage.id].richtig !== false);
      kandidaten = falsche.concat(richtige);
    } else {
      // Tagesquiz und weitere Fragen: zufällig aus allen noch ungesehenen Fragen der Stufe, egal zu welchem Thema.
      kandidaten = mischen(ungesehene());
    }
    const ids = mischen(kandidaten.slice(0, FRAGEN_PRO_RUNDE)).map((frage) => frage.id);
    if (ids.length === 0) {
      startZeigen();
      return;
    }
    runde = { art: art, tag: heute(), stufe: speicher.stufe, ids: ids, antworten: ids.map(() => -1), fertig: false };
    // In jeder Runde stehen die Antworten jedes Mal anders, damit niemand nur den Platz der richtigen Antwort lernt
    // (in der Fragenliste ist B bei einem Drittel der Fragen richtig). Die Reihenfolge wird mit der Runde gespeichert und bleibt nach einer Pause gleich.
    runde.ordnung = ids.map((id) => antwortReihenfolge(fragenNachId[id]));
    speicher.runde = runde;
    speicher.erklaert = true;
    speicherSichern();
    position = 0;
    frageZeigen();
  }

  function rundeFortsetzen(r) {
    runde = r;
    const offen = r.antworten.indexOf(-1);
    if (offen === -1) {
      rundeBeenden();
      return;
    }
    position = offen;
    frageZeigen();
  }

  // Weitere Fragen nach dem Tagesquiz: eine angefangene Runde geht weiter, sonst beginnt eine neue.
  function mehrStarten() {
    const laufend = aktiveRunde('mehr');
    if (laufend) rundeFortsetzen(laufend);
    else if (tagZustand() === 'erledigt') rundeStarten('mehr');
  }

  function rundeBeenden() {
    const r = runde;
    if (!r.fertig) {
      r.fertig = true;
      const aus = auswerten(r);
      const eintrag = istObjekt(speicher.tage[r.tag]) ? speicher.tage[r.tag] : { runden: 0 };
      eintrag.runden = (eintrag.runden || 0) + 1;
      if (r.art === 'tag') {
        eintrag.tagesquiz = {
          ids: r.ids.slice(),
          antworten: r.antworten.slice(),
          richtig: aus.richtig,
          von: aus.von,
        };
      } else if (r.art === 'mehr') {
        const bisher = istObjekt(eintrag.weitere) ? eintrag.weitere : {};
        eintrag.weitere = {
          richtig: (bisher.richtig || 0) + aus.richtig,
          von: (bisher.von || 0) + aus.von,
        };
      }
      speicher.tage[r.tag] = eintrag;
      speicher.runde = r;
      speicherSichern();
    }
    ergebnisZeigen(r, auswerten(r).richtig * punkteJeFrage(r.art));
  }

  // anzeige: An welcher Stelle der Knopf steht. Gespeichert wird immer der Platz der Antwort in der Fragenliste.
  function antwortWaehlen(anzeige) {
    if (!runde || runde.fertig || runde.antworten[position] !== -1) return;
    const frage = fragenNachId[runde.ids[position]];
    const index = antwortOrdnung(runde, position)[anzeige];
    if (index === undefined) return;
    runde.antworten[position] = index;
    const alt = istObjekt(speicher.fragen[frage.id]) ? speicher.fragen[frage.id] : {};
    const richtig = index === frage.richtig;
    speicher.fragen[frage.id] = { tag: alt.tag || runde.tag, richtig: richtig };
    if (richtig) {
      const gewinn = punkteJeFrage(runde.art);
      const stufe = stufeVon(frage);
      speicher.punkte += gewinn;
      // Neue Fragen zählen immer für die nächste Stufe. Wiederholungen zählen nur, wenn auf der Stufe keine neuen Fragen mehr übrig sind;
      // sonst ließe sich eine Stufe mit denselben Fragen freispielen. Gingen Punkte nur aufs Konto, merkt sich die Runde das für das Ergebnis.
      if (runde.art !== 'ueben' || stufeLeer(stufe)) {
        speicher.stufenPunkte[stufe - 1] += gewinn;
        // Reichen die Punkte, wird die nächste Stufe frei. Die Runde merkt es sich für die Meldung im Ergebnis.
        const neu = freischaltenPruefen();
        if (neu) runde.freigabe = neu;
      } else {
        runde.nurGesamt = true;
      }
    }
    speicher.runde = runde;
    speicherSichern();
    rueckmeldungZeigen(frage, index);
  }

  function weiter() {
    if (position + 1 < runde.ids.length) {
      position += 1;
      frageZeigen();
    } else {
      rundeBeenden();
    }
  }

  function zuruecksetzen() {
    if (!window.confirm('Fortschritt wirklich löschen? Serie, Punkte, Ergebnisse, gesehene Fragen und freigeschaltete Stufen fangen wieder bei null an. Einen Code zum Sichern gibt es vorher unter „Fortschritt aufs andere Gerät mitnehmen“.')) return;
    speicher = leererSpeicher();
    runde = null;
    ergebnisRunde = null;
    speicherSichern();
    startZeigen();
  }

  // ---------- Anzeige ----------

  function abschnittZeigen(name) {
    ABSCHNITTE.forEach((id) => {
      $(id).hidden = id !== name;
    });
    // Das Design hängt daran: Auf dem Start steht der Ball groß im Kopf, sonst klein.
    document.body.dataset.ansicht = name;
    window.scrollTo(0, 0);
  }

  function startZeigen() {
    abschnittZeigen('start');
    $('datum').textContent = datumLang(new Date());

    const zustand = tagZustand();
    const mehr = mehrZustand();
    const vorrat = ungesehene().length;
    const serie = serieBerechnen();

    $('serie').textContent = String(serie);
    $('serie-label').textContent = serie === 1 ? 'Tag in Serie' : 'Tage in Serie';
    $('vorrat').textContent = String(vorrat);
    $('punkte-gesamt').textContent = speicher.punkte.toLocaleString('de-DE');
    stufenZeigen();
    einfuehrungZeigen();

    let knopfText = '';
    if (zustand === 'erledigt') {
      knopfText = 'Ergebnis vom Tagesquiz ansehen';
    } else if (zustand === 'laeuft') {
      knopfText = 'Tagesquiz fortsetzen';
    } else if (zustand === 'offen') {
      knopfText = 'Tagesquiz starten';
      if (vorrat < FRAGEN_PRO_RUNDE) knopfText += ' (' + vorrat + (vorrat === 1 ? ' Frage)' : ' Fragen)');
    }
    tagesringZeigen(zustand, vorrat);
    wocheZeigen();
    $('tag-starten').textContent = knopfText;
    $('tag-starten').hidden = zustand === 'leer';

    // Nach dem Tagesquiz sind die weiteren Fragen die Hauptaktion, das Ergebnis rückt in die zweite Reihe.
    const mehrKnopf = $('mehr-starten');
    mehrKnopf.hidden = !mehrSichtbar(mehr);
    mehrKnopf.textContent = mehrKnopfText(mehr);
    $('tag-starten').className = mehrKnopf.hidden ? 'haupt' : 'neben';

    const uebenKnopf = $('ueben-starten');
    // Solange eine Tagesrunde oder eine Runde mit weiteren Fragen läuft, bleibt die Übung zu: Sie würde den einzigen Rundenspeicher überschreiben.
    uebenKnopf.hidden = zustand === 'laeuft' || mehr === 'laeuft' || gesehene().length === 0;
    uebenKnopf.textContent = aktiveRunde('ueben') ? 'Übungsrunde fortsetzen' : 'Übungsrunde (alte Fragen wiederholen)';

    // Nachlesen gibt es erst, wenn schon eine Frage beantwortet wurde.
    $('nachlesen-starten').hidden = beantwortete().length === 0;

    const hinweise = [];
    if (!speicherGeht) {
      hinweise.push('Hier lässt sich nichts speichern (privater Modus?). Serie und Vorrat starten beim nächsten Öffnen wieder bei null.');
    }
    if (vorrat === 0) {
      hinweise.push(leerHinweis());
    } else if (vorrat <= 2 * FRAGEN_PRO_RUNDE) {
      const tage = Math.ceil(vorrat / FRAGEN_PRO_RUNDE);
      hinweise.push(
        'Noch ' + vorrat + (vorrat === 1 ? ' neue Frage' : ' neue Fragen') + ' auf dieser Stufe, das reicht für ' +
          tage + (tage === 1 ? ' Tag' : ' Tage') + '. Bald braucht die Fragenliste Nachschub.'
      );
    }
    $('hinweis').textContent = hinweise.join(' ');
    $('hinweis').hidden = hinweise.length === 0;

    const stand = listenStand ? 'Fragenliste vom ' + datumKurz(listenStand) + ' · ' : '';
    $('stand').textContent = stand + fragen.length + ' Fragen · App vom ' + datumKurz(APP_STAND);
  }

  // Der Tagesring zeigt, wie weit das Tagesquiz von heute ist: beantwortete Fragen von allen Fragen der Runde.
  // Ist es geschafft, steht darunter, wie viele der neuen Fragen heute richtig waren (Tagesquiz und weitere Fragen zusammen).
  function tagesringZeigen(zustand, vorrat) {
    let fertig = 0;
    let gesamt = Math.min(FRAGEN_PRO_RUNDE, vorrat);
    let zeile;
    if (zustand === 'erledigt') {
      const tagesquiz = speicher.tage[heute()].tagesquiz;
      gesamt = Number.isFinite(tagesquiz.von) && tagesquiz.von > 0 ? tagesquiz.von : FRAGEN_PRO_RUNDE;
      fertig = gesamt;
      const bilanz = heuteBilanz();
      zeile = 'Geschafft! Heute ' + bilanz.richtig + ' von ' + bilanz.von + ' richtig.';
    } else if (zustand === 'laeuft') {
      const laufend = aktiveRunde('tag');
      gesamt = laufend.ids.length;
      fertig = laufend.antworten.filter((antwort) => antwort !== -1).length;
      zeile = fertig + ' von ' + gesamt + ' beantwortet. Mach weiter!';
    } else if (zustand === 'offen') {
      zeile = gesamt + (gesamt === 1 ? ' neue Frage wartet' : ' neue Fragen warten') + ' auf dich.';
    } else {
      gesamt = 0;
      zeile = 'Auf dieser Stufe sind alle Fragen durch.';
    }
    const anteil = gesamt > 0 ? fertig / gesamt : 0;
    $('heute-karte').dataset.zustand = zustand;
    $('ring-zahl').textContent = gesamt > 0 ? fertig + '/' + gesamt : '–';
    $('ring').setAttribute('aria-label', gesamt > 0 ? 'Tagesquiz heute: ' + fertig + ' von ' + gesamt + ' Fragen' : 'Tagesquiz heute: keine neuen Fragen');
    const fuellung = $('ring-fuell');
    fuellung.style.strokeDasharray = String(RING_UMFANG);
    fuellung.style.strokeDashoffset = String(RING_UMFANG * (1 - anteil));
    $('heute-zeile').textContent = zeile;
  }

  // Die Wochenleiste: Montag bis Sonntag der laufenden Woche, ein Football für jeden Tag mit mindestens einer beendeten Runde.
  function wocheZeigen() {
    const heuteTag = heute();
    const jetzt = tagZuDatum(heuteTag);
    const montag = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate() - ((jetzt.getDay() + 6) % 7));
    const liste = $('woche');
    liste.textContent = '';
    for (let i = 0; i < 7; i++) {
      const tag = tagString(new Date(montag.getFullYear(), montag.getMonth(), montag.getDate() + i));
      const gespielt = !!speicher.tage[tag];
      const lage = tag === heuteTag ? 'heute' : tag > heuteTag ? 'spaeter' : 'vorbei';
      const punkt = document.createElement('li');
      punkt.className = 'wt ' + lage + (gespielt ? ' gespielt' : '');
      punkt.dataset.tag = tag;
      const marke = document.createElement('span');
      marke.className = 'wt-marke';
      marke.setAttribute('aria-hidden', 'true');
      const buchstabe = document.createElement('span');
      buchstabe.className = 'wt-buchstabe';
      buchstabe.setAttribute('aria-hidden', 'true');
      buchstabe.textContent = WOCHENTAGE_KURZ[i];
      const vorlesen = document.createElement('span');
      vorlesen.className = 'nur-vorlesen';
      vorlesen.textContent = WOCHENTAGE_LANG[i] + (gespielt ? ': gespielt' : lage === 'spaeter' ? '' : ': nicht gespielt');
      punkt.append(marke, buchstabe, vorlesen);
      liste.appendChild(punkt);
    }
  }

  function stufenAufbauen() {
    const box = $('stufen');
    STUFEN.forEach((stufe) => {
      const knopf = document.createElement('button');
      knopf.type = 'button';
      knopf.className = 'stufe';
      knopf.dataset.stufe = String(stufe.nummer);
      knopf.setAttribute('aria-label', stufe.name + ', ' + stufe.hinweis);
      const name = document.createElement('span');
      name.className = 'stufe-name';
      name.textContent = stufe.name;
      const hinweis = document.createElement('span');
      hinweis.className = 'stufe-hinweis';
      hinweis.textContent = stufe.hinweis;
      knopf.append(name, hinweis);
      knopf.addEventListener('click', () => stufeWaehlen(stufe.nummer));
      box.appendChild(knopf);
    });

    // Unter den Knöpfen steht, wie weit es bis zur nächsten gesperrten Stufe ist. Text und Balken füllt stufenZeigen.
    const ziel = document.createElement('div');
    ziel.className = 'stufen-ziel';
    ziel.id = 'stufen-ziel';
    ziel.hidden = true;
    const zielText = document.createElement('p');
    zielText.id = 'stufen-ziel-text';
    const zielBalken = document.createElement('div');
    zielBalken.className = 'balken';
    zielBalken.setAttribute('aria-hidden', 'true');
    const zielFuellung = document.createElement('div');
    zielFuellung.id = 'stufen-ziel-balken';
    zielBalken.appendChild(zielFuellung);
    ziel.append(zielText, zielBalken);
    box.after(ziel);
    $('stufen-info').setAttribute('aria-live', 'polite');
  }

  // Die Zeilen unter den Punkten im Ergebnis: „Neue Stufe frei“ mit Knopf zum Wechseln, dazu ein Hinweis zu Übungspunkten.
  // Sie entstehen hier, damit index.html unverändert bleibt.
  function ergebnisZeilenAufbauen() {
    const zeile = document.createElement('p');
    zeile.className = 'freigabe';
    zeile.id = 'ergebnis-freigabe';
    zeile.hidden = true;

    const wechselZeile = document.createElement('div');
    wechselZeile.className = 'wechsel-zeile';
    wechselZeile.id = 'ergebnis-wechsel-zeile';
    wechselZeile.hidden = true;
    const wechsel = document.createElement('button');
    wechsel.type = 'button';
    wechsel.className = 'wechsel';
    wechsel.id = 'ergebnis-wechsel';
    wechsel.addEventListener('click', ergebnisStufeWaehlen);
    wechselZeile.appendChild(wechsel);

    const uebung = document.createElement('p');
    uebung.className = 'quelle';
    uebung.id = 'ergebnis-uebungshinweis';
    uebung.hidden = true;

    $('ergebnis-gewinn').after(zeile, wechselZeile, uebung);
  }

  // Die Einführung steht beim ersten Start oben und aufgeklappt, danach zugeklappt weiter unten zum Nachlesen.
  // Die Stufen und Zahlen kommen aus STUFEN und den Punktewerten, damit der Text nie von der App abweicht.
  function einfuehrungAufbauen() {
    const box = document.createElement('details');
    box.className = 'info einfuehrung';
    box.id = 'einfuehrung';
    const titel = document.createElement('summary');
    titel.textContent = 'So funktioniert Football Brain';
    const liste = document.createElement('ul');
    const zeilen = [
      'Jeden Tag gibt es ein Tagesquiz mit ' + FRAGEN_PRO_RUNDE + ' neuen Fragen, danach so viele weitere, wie du magst.',
      'Jede richtige neue Antwort bringt ' + PUNKTE_NEU + ' Punkte, jede richtige Wiederholung in der Übungsrunde ' + PUNKTE_UEBUNG + '.',
    ];
    STUFEN.forEach((stufe) => {
      zeilen.push(stufe.name + ' (' + stufe.hinweis + '): ' + stufe.thema + '.');
    });
    const frei = STUFEN.slice(1).map((stufe, i) => stufe.name + ' mit ' + stufe.freiAb + ' Punkten auf ' + STUFEN[i].name);
    zeilen.push('Die nächste Stufe wird frei: ' + frei.join(', ') + '. Wiederholungen zählen dafür erst, wenn alle neuen Fragen einer Stufe durch sind.');
    zeilen.forEach((text) => {
      const punkt = document.createElement('li');
      punkt.textContent = text;
      liste.appendChild(punkt);
    });
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'neben';
    ok.id = 'einfuehrung-ok';
    ok.textContent = 'Verstanden, los geht’s';
    ok.addEventListener('click', () => {
      speicher.erklaert = true;
      speicherSichern();
      startZeigen();
    });
    box.append(titel, liste, ok);
    $('installieren').before(box);
  }

  // Solange die Einführung nicht bestätigt und keine erste Runde gestartet ist, steht sie oben. Aufgeklappt wird sie nur beim Hochschieben,
  // damit sie nicht jedes Mal wieder aufgeht, wenn jemand sie zugeklappt hat und in die App zurückkommt.
  function einfuehrungZeigen() {
    const box = $('einfuehrung');
    const neu = !speicher.erklaert;
    $('einfuehrung-ok').hidden = !neu;
    box.classList.toggle('oben', neu);
    if (neu && $('start').firstElementChild !== box) {
      $('start').prepend(box);
      box.open = true;
    } else if (!neu && $('start').firstElementChild === box) {
      $('installieren').before(box);
      box.open = false;
    }
  }

  // Der Kasten zum Mitnehmen des Fortschritts: Code kopieren, auf dem anderen Gerät einfügen und einlesen.
  function mitnehmenAufbauen() {
    const box = document.createElement('details');
    box.className = 'info';
    box.id = 'mitnehmen';
    const titel = document.createElement('summary');
    titel.textContent = 'Fortschritt aufs andere Gerät mitnehmen';
    const erklaerung = document.createElement('p');
    erklaerung.textContent =
      'Dein Fortschritt liegt nur in diesem Browser. Kopiere hier den Code und füge ihn auf dem anderen Gerät im selben Feld ein, zum Beispiel beim Wechsel auf ein neues Handy.';
    const kopierKnopf = document.createElement('button');
    kopierKnopf.type = 'button';
    kopierKnopf.className = 'neben';
    kopierKnopf.id = 'code-kopieren';
    kopierKnopf.textContent = 'Code kopieren';
    kopierKnopf.addEventListener('click', codeKopieren);
    const beschriftung = document.createElement('label');
    beschriftung.htmlFor = 'code-feld';
    beschriftung.textContent = 'Code von einem anderen Gerät einfügen:';
    const feld = document.createElement('textarea');
    feld.id = 'code-feld';
    feld.rows = 3;
    feld.spellcheck = false;
    feld.setAttribute('autocomplete', 'off');
    feld.setAttribute('autocapitalize', 'off');
    const lesenKnopf = document.createElement('button');
    lesenKnopf.type = 'button';
    lesenKnopf.className = 'neben';
    lesenKnopf.id = 'code-einlesen';
    lesenKnopf.textContent = 'Code einlesen';
    lesenKnopf.addEventListener('click', codeEinlesen);
    const info = document.createElement('p');
    info.className = 'quelle';
    info.id = 'code-info';
    info.hidden = true;
    info.setAttribute('aria-live', 'polite');
    box.append(titel, erklaerung, kopierKnopf, beschriftung, feld, lesenKnopf, info);
    $('installieren').after(box);
  }

  function codeKopieren() {
    const code = fortschrittCode();
    const info = $('code-info');
    info.hidden = false;
    // Ist die Zwischenablage nicht erlaubt, steht der Code im Feld, zum Markieren und Kopieren von Hand.
    const vonHand = () => {
      const feld = $('code-feld');
      feld.value = code;
      feld.focus();
      feld.select();
      info.textContent = 'Der Code steht im Feld unten. Markiere ihn und kopiere ihn von Hand.';
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(() => {
        info.textContent = 'Code kopiert. Füge ihn auf dem anderen Gerät im Feld unten ein und tippe auf „Code einlesen“.';
      }, vonHand);
    } else {
      vonHand();
    }
  }

  // Der eingefügte Code ersetzt den Stand dieses Geräts, aber erst nach der Rückfrage mit beiden Ständen.
  function codeEinlesen() {
    const info = $('code-info');
    info.hidden = false;
    const neu = fortschrittAusCode($('code-feld').value);
    if (!neu) {
      info.textContent = 'Das ist kein gültiger Code. Kopiere ihn noch einmal vollständig vom anderen Gerät.';
      return;
    }
    if (!window.confirm('Fortschritt auf diesem Gerät ersetzen?\n\nJetzt hier: ' + standKurz(speicher) + '\nIm Code: ' + standKurz(neu))) return;
    speicher = neu;
    runde = null;
    ergebnisRunde = null;
    freischaltenPruefen();
    speicherSichern();
    $('code-feld').value = '';
    startZeigen();
    info.textContent = 'Fortschritt übernommen: ' + standKurz(speicher) + '.';
    info.scrollIntoView({ block: 'nearest' });
  }

  // „Frage melden“ unter den Antworten: Der Knopf reicht Kennung und Wortlaut der Frage weiter, damit sie sich prüfen lässt.
  function meldenAufbauen() {
    const zeile = document.createElement('div');
    zeile.className = 'melden-zeile';
    const knopf = document.createElement('button');
    knopf.type = 'button';
    knopf.className = 'klein';
    knopf.id = 'melden';
    knopf.textContent = 'Frage melden';
    knopf.addEventListener('click', frageMelden);
    const hinweis = document.createElement('p');
    hinweis.className = 'quelle';
    hinweis.id = 'melden-hinweis';
    hinweis.hidden = true;
    zeile.append(knopf, hinweis);
    $('rueckmeldung').after(zeile);
  }

  function frageMelden() {
    const frage = runde ? fragenNachId[runde.ids[position]] : null;
    if (!frage) return;
    const text =
      'Football Brain, Frage melden\n' +
      frage.id + ' · ' + (frage.kategorie ? frage.kategorie + ' · ' : '') + 'Stufe ' + STUFEN[stufeVon(frage) - 1].name + '\n' +
      '„' + frage.frage + '“\n' +
      'Mein Hinweis: ';
    const hinweis = $('melden-hinweis');
    const kopiert = 'Text kopiert. Füge ihn in eine Nachricht ein, ergänze deinen Hinweis und schick ihn dem, der dir die App gegeben hat.';
    if (navigator.share) {
      navigator.share({ text: text }).catch((fehler) => {
        if (!fehler || fehler.name !== 'AbortError') kopieren(text, hinweis, kopiert);
      });
    } else {
      kopieren(text, hinweis, kopiert);
    }
  }

  // Tippt jemand auf eine gesperrte Stufe, steht unter den Knöpfen, was dafür noch fehlt.
  function sperreZeigen(nummer) {
    const stufe = STUFEN[nummer - 1];
    const davor = STUFEN[nummer - 2];
    let text;
    if (nummer === speicher.freigabe + 1) {
      const fehlt = Math.max(0, stufe.freiAb - speicher.stufenPunkte[nummer - 2]);
      text = stufe.name + ' ist noch gesperrt. Sammle ' + stufe.freiAb + ' Punkte auf ' + davor.name + ', dir fehlen noch ' + fehlt + '.';
    } else {
      text = stufe.name + ' ist noch gesperrt. Schalte erst ' + davor.name + ' frei.';
    }
    $('stufen-info').textContent = text;
    $('stufen-info').hidden = false;
    const knopf = document.querySelector('#stufen .stufe[data-stufe="' + nummer + '"]');
    if (knopf) {
      knopf.classList.add('wackelt');
      knopf.addEventListener('animationend', () => knopf.classList.remove('wackelt'), { once: true });
    }
  }

  function stufeWaehlen(nummer) {
    if (!stufeGueltig(nummer) || nummer === speicher.stufe || rundeOffen()) return;
    if (nummer > speicher.freigabe) {
      sperreZeigen(nummer);
      return;
    }
    speicher.stufe = nummer;
    speicherSichern();
    startZeigen();
  }

  function stufenZeigen() {
    const gesperrt = rundeOffen();
    document.querySelectorAll('#stufen .stufe').forEach((knopf) => {
      const nummer = Number(knopf.dataset.stufe);
      const stufe = STUFEN[nummer - 1];
      const aktiv = nummer === speicher.stufe;
      // Eine Stufe, für die noch Punkte fehlen, bleibt antippbar (sie erklärt dann, was fehlt), wirkt aber gesperrt.
      const zu = nummer > speicher.freigabe;
      const hinweis = zu ? 'gesperrt' : stufe.hinweis;
      knopf.classList.toggle('aktiv', aktiv);
      knopf.classList.toggle('zu', zu);
      knopf.setAttribute('aria-pressed', aktiv ? 'true' : 'false');
      if (zu) knopf.setAttribute('aria-disabled', 'true');
      else knopf.removeAttribute('aria-disabled');
      knopf.setAttribute('aria-label', stufe.name + ', ' + hinweis);
      knopf.querySelector('.stufe-hinweis').textContent = hinweis;
      knopf.disabled = gesperrt;
    });
    let info = '';
    if (gesperrt) info = 'Die Stufe lässt sich erst wechseln, wenn die laufende Runde beendet ist.';
    else if (tagZustand() === 'erledigt') info = 'Die gewählte Stufe gilt ab morgen, für weitere Fragen und für die Übungsrunde.';
    $('stufen-info').textContent = info;
    $('stufen-info').hidden = info === '';

    // Weg zur nächsten gesperrten Stufe: Punkte auf der höchsten freien Stufe gegen die Schwelle.
    const ziel = naechsteGesperrte();
    $('stufen-ziel').hidden = ziel === 0;
    if (ziel) {
      const stufe = STUFEN[ziel - 1];
      const habe = Math.min(speicher.stufenPunkte[ziel - 2], stufe.freiAb);
      $('stufen-ziel-text').textContent =
        stufe.name + ' wird frei: ' + habe + ' von ' + stufe.freiAb + ' Punkten auf ' + STUFEN[ziel - 2].name + '.';
      $('stufen-ziel-balken').style.width = (stufe.freiAb > 0 ? (habe / stufe.freiAb) * 100 : 100) + '%';
    }
  }

  function frageZeigen() {
    const frage = fragenNachId[runde.ids[position]];
    abschnittZeigen('frage');
    $('fortschritt-text').textContent =
      rundenName(runde.art) + ' · Frage ' + (position + 1) + ' von ' + runde.ids.length;
    $('fortschritt-balken').style.width = (position / runde.ids.length) * 100 + '%';
    const stufenName = STUFEN[stufeVon(frage) - 1].name;
    $('kategorie').textContent = (frage.kategorie ? frage.kategorie + ' · ' : '') + 'Stufe ' + stufenName;
    $('frage-text').textContent = frage.frage;

    const box = $('antworten');
    box.textContent = '';
    // original: Platz der Antwort in der Fragenliste, anzeige: Stelle des Knopfes (und damit der Buchstabe).
    antwortOrdnung(runde, position).forEach((original, anzeige) => {
      const knopf = document.createElement('button');
      knopf.type = 'button';
      knopf.className = 'antwort';
      const buchstabe = document.createElement('span');
      buchstabe.className = 'buchstabe';
      buchstabe.textContent = BUCHSTABEN[anzeige];
      const inhalt = document.createElement('span');
      inhalt.className = 'text';
      inhalt.textContent = frage.antworten[original];
      const marke = document.createElement('span');
      marke.className = 'marke';
      marke.setAttribute('aria-hidden', 'true');
      knopf.append(buchstabe, inhalt, marke);
      knopf.addEventListener('click', () => antwortWaehlen(anzeige));
      box.appendChild(knopf);
    });
    $('rueckmeldung').hidden = true;
    $('melden-hinweis').hidden = true;
    $('melden-hinweis').textContent = '';
  }

  function quelleZeigen(quelle) {
    quelleFuellen($('rueckmeldung-quelle'), quelle);
  }

  // Schreibt die Quelle einer Frage in die Zeile (mit Link, wenn es eine Webadresse gibt) und zeigt sie nur, wenn es eine gibt.
  function quelleFuellen(zeile, quelle) {
    zeile.textContent = '';
    zeile.hidden = true;
    if (!istObjekt(quelle) || (!quelle.text && !quelle.url)) return;
    zeile.append('Quelle: ');
    if (typeof quelle.url === 'string' && /^https?:\/\//.test(quelle.url)) {
      const link = document.createElement('a');
      link.href = quelle.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = quelle.text || quelle.url;
      zeile.appendChild(link);
    } else {
      zeile.append(quelle.text || '');
    }
    zeile.hidden = false;
  }

  // gewaehlt: Platz der gewählten Antwort in der Fragenliste. Die Knöpfe stehen in der Reihenfolge von antwortOrdnung.
  function rueckmeldungZeigen(frage, gewaehlt) {
    const richtig = gewaehlt === frage.richtig;
    const ordnung = antwortOrdnung(runde, position);
    const knoepfe = $('antworten').children;
    for (let i = 0; i < knoepfe.length; i++) {
      knoepfe[i].disabled = true;
      const marke = knoepfe[i].querySelector('.marke');
      if (ordnung[i] === frage.richtig) {
        knoepfe[i].classList.add('richtig');
        marke.textContent = '✓';
      } else if (ordnung[i] === gewaehlt) {
        knoepfe[i].classList.add('falsch');
        marke.textContent = '✗';
      }
    }

    const box = $('rueckmeldung');
    box.className = 'rueckmeldung ' + (richtig ? 'ok' : 'nein');
    $('rueckmeldung-titel').textContent = richtig ? 'Richtig!' : 'Leider falsch';
    const loesung = $('rueckmeldung-richtig');
    loesung.textContent = 'Richtig ist: ' + BUCHSTABEN[ordnung.indexOf(frage.richtig)] + ') ' + frage.antworten[frage.richtig];
    loesung.hidden = richtig;
    $('rueckmeldung-text').textContent = frage.erklaerung || '';
    quelleZeigen(frage.quelle);
    $('weiter').textContent = position + 1 < runde.ids.length ? 'Nächste Frage' : 'Ergebnis ansehen';
    $('fortschritt-balken').style.width = ((position + 1) / runde.ids.length) * 100 + '%';

    box.hidden = false;
    $('rueckmeldung-titel').focus({ preventScroll: true });
    box.scrollIntoView({ block: 'nearest' });
  }

  function ergebnisSpruch(richtig, von) {
    if (von === 0) return '';
    const anteil = richtig / von;
    if (anteil === 1) return 'Alles richtig. Sauber gespielt!';
    if (anteil >= 0.8) return 'Sehr stark, fast makellos.';
    if (anteil >= 0.6) return 'Solide Runde, da geht noch mehr.';
    if (anteil >= 0.4) return 'Mittelfeld. Die Erklärungen helfen fürs nächste Mal.';
    return 'Heute lief es nicht rund. Die Übungsrunde holt die Fehler wieder rein.';
  }

  // Dieselben Grenzen wie beim Spruch; das Design zeigt dazu ein passendes Zeichen über dem Ergebnis.
  function ergebnisStimmung(richtig, von) {
    if (von === 0) return 'mittel';
    const anteil = richtig / von;
    if (anteil === 1) return 'top';
    if (anteil >= 0.8) return 'stark';
    if (anteil >= 0.6) return 'solide';
    if (anteil >= 0.4) return 'mittel';
    return 'schwach';
  }

  // Hat diese Runde die nächste Stufe freigeschaltet, steht das direkt unter den Punkten, dazu ein Knopf zum Wechseln.
  // Gingen Übungspunkte nur aufs Punktekonto, steht hier auch, warum der Balken zur nächsten Stufe nicht gewachsen ist.
  function ergebnisFreigabeZeigen() {
    const r = ergebnisRunde;
    const frei = stufeGueltig(r.freigabe) ? r.freigabe : 0;
    const freiZeile = $('ergebnis-freigabe');
    freiZeile.textContent = frei ? 'Neue Stufe frei: ' + STUFEN[frei - 1].name : '';
    freiZeile.hidden = frei === 0;

    const gewaehlt = frei !== 0 && speicher.stufe === frei;
    const wechsel = $('ergebnis-wechsel');
    wechsel.textContent = frei === 0 ? '' : gewaehlt ? STUFEN[frei - 1].name + ' ist jetzt gewählt' : 'Zu ' + STUFEN[frei - 1].name + ' wechseln';
    wechsel.disabled = gewaehlt;
    $('ergebnis-wechsel-zeile').hidden = frei === 0 || speicher.stufe > frei;

    const stufe = stufeGueltig(r.stufe) ? r.stufe : 0;
    const erklaeren = r.art === 'ueben' && r.nurGesamt === true && stufe !== 0 && naechsteGesperrte() === stufe + 1;
    const uebung = $('ergebnis-uebungshinweis');
    uebung.textContent = erklaeren
      ? 'Wiederholungen zählen fürs Punktekonto. Für ' + STUFEN[stufe].name + ' zählen sie erst, wenn auf ' + STUFEN[stufe - 1].name + ' alle neuen Fragen durch sind.'
      : '';
    uebung.hidden = !erklaeren;
  }

  // Direkt unter dem Ergebnis geht es mit der nächsten Runde neuer Fragen weiter, solange auf der Stufe welche übrig sind.
  function ergebnisWeiterZeigen() {
    const mehr = mehrZustand();
    const weiterKnopf = $('weiter-spielen');
    weiterKnopf.hidden = !mehrSichtbar(mehr);
    weiterKnopf.textContent = mehrKnopfText(mehr);
    $('teilen').className = weiterKnopf.hidden ? 'haupt' : 'neben';
    const leerText = mehr === 'leer' ? leerHinweis() : '';
    $('mehr-hinweis').textContent = leerText;
    $('mehr-hinweis').hidden = leerText === '';
  }

  // „Zu College wechseln“ im Ergebnis: Die frisch freigeschaltete Stufe wird gleich gewählt.
  // Danach kommen weitere neue Fragen und die Übungsrunde von dort (ein Tagesquiz von heute, das schon gespielt ist, bleibt wie es ist).
  function ergebnisStufeWaehlen() {
    const nummer = ergebnisRunde ? ergebnisRunde.freigabe : 0;
    if (!stufeGueltig(nummer) || nummer > speicher.freigabe || rundeOffen()) return;
    speicher.stufe = nummer;
    speicherSichern();
    ergebnisFreigabeZeigen();
    ergebnisWeiterZeigen();
  }

  function ergebnisZeigen(r, gewinn) {
    ergebnisRunde = r;
    const aus = auswerten(r);
    const serie = serieBerechnen();
    abschnittZeigen('ergebnis');
    $('ergebnis').dataset.stimmung = ergebnisStimmung(aus.richtig, aus.von);
    $('ergebnis-art').textContent = rundenName(r.art) + ' · ' + datumKurz(r.tag);
    $('ergebnis-punkte').textContent = aus.richtig + ' von ' + aus.von;
    $('ergebnis-text').textContent = ergebnisSpruch(aus.richtig, aus.von);
    $('ergebnis-serie').textContent = serie + (serie === 1 ? ' Tag' : ' Tage') + ' in Serie';
    const gewinnZeile = $('ergebnis-gewinn');
    gewinnZeile.textContent = gewinn > 0 ? '+' + gewinn + ' Punkte' : '';
    gewinnZeile.hidden = !(gewinn > 0);
    ergebnisFreigabeZeigen();
    ergebnisWeiterZeigen();

    const liste = $('ergebnis-liste');
    liste.textContent = '';
    aus.eintraege.forEach((eintrag) => {
      const punkt = document.createElement('li');
      punkt.className = eintrag.richtig ? 'ok' : 'nein';
      const zeichen = document.createElement('span');
      zeichen.className = 'zeichen';
      zeichen.setAttribute('aria-hidden', 'true');
      zeichen.textContent = eintrag.richtig ? '✓' : '✗';
      const inhalt = document.createElement('span');
      const vorlesen = document.createElement('span');
      vorlesen.className = 'nur-vorlesen';
      vorlesen.textContent = eintrag.richtig ? 'Richtig beantwortet: ' : 'Falsch beantwortet: ';
      inhalt.append(vorlesen, eintrag.frage.frage);
      if (!eintrag.richtig) {
        const loesung = document.createElement('span');
        loesung.className = 'quelle';
        loesung.textContent = 'Richtig: ' + eintrag.frage.antworten[eintrag.frage.richtig];
        inhalt.append(document.createElement('br'), loesung);
      }
      punkt.append(zeichen, inhalt);
      liste.appendChild(punkt);
    });
    $('teilen-hinweis').textContent = '';
  }

  // ---------- Nachlesen ----------

  // Alle schon beantworteten Fragen (über alle Stufen), die zuletzt beantworteten zuerst.
  // richtig: Ergebnis der letzten Antwort. Die App merkt sich nicht, welche falsche Antwort gewählt wurde.
  function beantwortete() {
    return fragen
      .filter(istGesehen)
      .map((frage, platz) => {
        const eintrag = speicher.fragen[frage.id];
        return { frage: frage, platz: platz, tag: String(eintrag.tag), richtig: eintrag.richtig !== false };
      })
      .sort((a, b) => (a.tag < b.tag ? 1 : a.tag > b.tag ? -1 : a.platz - b.platz));
  }

  function themaVon(frage) {
    return frage.kategorie || 'Weitere Themen';
  }

  // Die Übersicht: ein Knopf je Thema, mit der Zahl der beantworteten Fragen. Themen ohne beantwortete Frage fehlen.
  function nachlesenUebersichtZeigen() {
    nachlesenThema = null;
    abschnittZeigen('nachlesen');
    const themen = {};
    beantwortete().forEach((eintrag) => {
      const name = themaVon(eintrag.frage);
      if (!themen[name]) themen[name] = { anzahl: 0, falsch: 0 };
      themen[name].anzahl += 1;
      if (!eintrag.richtig) themen[name].falsch += 1;
    });
    const namen = Object.keys(themen).sort((a, b) => a.localeCompare(b, 'de'));
    $('nachlesen-titel').textContent = 'Nachlesen';
    $('nachlesen-info').textContent =
      namen.length === 0
        ? 'Du hast noch keine Frage beantwortet. Sie erscheinen hier, sobald du ein Tagesquiz gespielt hast.'
        : 'Wähle ein Thema. Hier stehen nur Fragen, die du schon beantwortet hast.';
    $('nachlesen-zurueck').textContent = 'Zurück zum Start';
    $('nachlesen-liste').hidden = true;
    const box = $('nachlesen-themen');
    box.textContent = '';
    namen.forEach((name) => {
      const knopf = document.createElement('button');
      knopf.type = 'button';
      knopf.className = 'thema';
      knopf.dataset.thema = name;
      const titel = document.createElement('span');
      titel.className = 'thema-name';
      titel.textContent = name;
      const zahl = document.createElement('span');
      zahl.className = 'thema-zahl';
      const falsch = themen[name].falsch;
      zahl.textContent =
        themen[name].anzahl + (themen[name].anzahl === 1 ? ' Frage' : ' Fragen') + (falsch > 0 ? ', ' + falsch + ' zuletzt falsch' : '');
      knopf.append(titel, zahl);
      knopf.addEventListener('click', () => nachlesenThemaZeigen(name));
      box.appendChild(knopf);
    });
    box.hidden = false;
    $('nachlesen-titel').focus({ preventScroll: true });
  }

  // Ein Thema: die beantworteten Fragen mit Zeichen für die letzte Antwort. Antippen klappt Antwort, Erklärung und Quelle auf.
  function nachlesenThemaZeigen(name) {
    nachlesenThema = name;
    abschnittZeigen('nachlesen');
    $('nachlesen-titel').textContent = name;
    $('nachlesen-info').textContent = 'Tippe auf eine Frage für die richtige Antwort, die Erklärung und die Quelle. Das Zeichen zeigt deine letzte Antwort.';
    $('nachlesen-zurueck').textContent = 'Alle Themen';
    $('nachlesen-themen').hidden = true;
    const liste = $('nachlesen-liste');
    liste.textContent = '';
    beantwortete()
      .filter((eintrag) => themaVon(eintrag.frage) === name)
      .forEach((eintrag) => liste.appendChild(nachlesenEintrag(eintrag)));
    liste.hidden = false;
    $('nachlesen-titel').focus({ preventScroll: true });
  }

  function nachlesenEintrag(eintrag) {
    const frage = eintrag.frage;
    const punkt = document.createElement('li');
    punkt.className = eintrag.richtig ? 'ok' : 'nein';
    punkt.dataset.frage = frage.id;
    const box = document.createElement('details');
    box.className = 'nachlesen-frage';

    const kopf = document.createElement('summary');
    const zeichen = document.createElement('span');
    zeichen.className = 'zeichen';
    zeichen.setAttribute('aria-hidden', 'true');
    zeichen.textContent = eintrag.richtig ? '✓' : '✗';
    const inhalt = document.createElement('span');
    inhalt.className = 'nachlesen-inhalt';
    const vorlesen = document.createElement('span');
    vorlesen.className = 'nur-vorlesen';
    vorlesen.textContent = eintrag.richtig ? 'Zuletzt richtig beantwortet: ' : 'Zuletzt falsch beantwortet: ';
    const text = document.createElement('span');
    text.className = 'nachlesen-text';
    text.textContent = frage.frage;
    const stufe = document.createElement('span');
    stufe.className = 'nachlesen-stufe';
    stufe.textContent =
      STUFEN[stufeVon(frage) - 1].name + (/^\d{4}-\d{2}-\d{2}$/.test(eintrag.tag) ? ' · beantwortet am ' + datumKurz(eintrag.tag) : '');
    inhalt.append(vorlesen, text, stufe);
    kopf.append(zeichen, inhalt);

    const detail = document.createElement('div');
    detail.className = 'nachlesen-detail';
    const loesung = document.createElement('p');
    loesung.className = 'nachlesen-loesung';
    const etikett = document.createElement('strong');
    etikett.textContent = 'Richtig: ';
    loesung.append(etikett, frage.antworten[frage.richtig]);
    detail.appendChild(loesung);
    if (frage.erklaerung) {
      const erklaerung = document.createElement('p');
      erklaerung.className = 'nachlesen-erklaerung';
      erklaerung.textContent = frage.erklaerung;
      detail.appendChild(erklaerung);
    }
    const quelle = document.createElement('p');
    quelle.className = 'quelle';
    quelleFuellen(quelle, frage.quelle);
    detail.appendChild(quelle);

    box.append(kopf, detail);
    punkt.appendChild(box);
    return punkt;
  }

  // „Zurück“ führt aus einem Thema zur Übersicht und von der Übersicht zum Start.
  function nachlesenZurueck() {
    if (nachlesenThema !== null) nachlesenUebersichtZeigen();
    else startZeigen();
  }

  // Legt den Text in die Zwischenablage und schreibt in die Zeile „hinweis“, was jetzt zu tun ist.
  // Geht das nicht, steht der Text selbst dort, zum Kopieren von Hand.
  function kopieren(text, hinweis, erfolg) {
    hinweis.hidden = false;
    hinweis.style.whiteSpace = 'pre-line';
    const vonHand = 'Zum Teilen bitte von Hand kopieren:\n' + text;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => {
          hinweis.textContent = erfolg;
        },
        () => {
          hinweis.textContent = vonHand;
        }
      );
    } else {
      hinweis.textContent = vonHand;
    }
  }

  function teilen() {
    if (!ergebnisRunde) return;
    const aus = auswerten(ergebnisRunde);
    const quadrate = aus.eintraege.map((eintrag) => (eintrag.richtig ? '🟩' : '🟥')).join('');
    const kopf = 'Football Brain · ' + rundenName(ergebnisRunde.art) + ' ';
    const text = '🏈 ' + kopf + datumKurz(ergebnisRunde.tag) + '\n' + aus.richtig + '/' + aus.von + ' richtig\n' + quadrate;
    const adresse = window.location.origin + window.location.pathname;
    const kopiert = 'Ergebnis kopiert. Jetzt in eine Nachricht einfügen.';
    if (navigator.share) {
      navigator.share({ text: text, url: adresse }).catch((fehler) => {
        if (!fehler || fehler.name !== 'AbortError') kopieren(text + '\n' + adresse, $('teilen-hinweis'), kopiert);
      });
    } else {
      kopieren(text + '\n' + adresse, $('teilen-hinweis'), kopiert);
    }
  }

  function fehlerZeigen(fehler) {
    const meldung = fehler && fehler.message ? fehler.message : String(fehler);
    $('fehler-text').textContent = 'Prüfe die Internetverbindung und versuche es noch einmal. Technische Meldung: ' + meldung;
    abschnittZeigen('fehler');
  }

  // iPhone und iPad nehmen für den Startbildschirm kein SVG. Darum zeichnet die Seite das Symbol einmal als PNG und trägt es als Apple-Symbol ein.
  function symbolFuerIphone() {
    const bild = new Image();
    bild.onload = () => {
      try {
        const leinwand = document.createElement('canvas');
        leinwand.width = 180;
        leinwand.height = 180;
        leinwand.getContext('2d').drawImage(bild, 0, 0, 180, 180);
        const link = document.createElement('link');
        link.rel = 'apple-touch-icon';
        link.href = leinwand.toDataURL('image/png');
        document.head.appendChild(link);
      } catch (fehler) {
        // Zeichnen nicht erlaubt: dann bleibt es beim Standard des Geräts.
      }
    };
    bild.src = 'icon.svg';
  }

  // ---------- Start ----------

  // Die Vorschau nimmt die eigene fragen.json, falls sie eine hat. Sonst gilt die der echten App eine Ebene höher,
  // die Vorschau zeigt dann genau den Fragenstand, der gerade online ist.
  function fragenHolen() {
    const adressen = IN_VORSCHAU ? ['fragen.json', '../fragen.json'] : ['fragen.json'];
    const versuchen = (i) =>
      fetch(adressen[i], { cache: 'no-cache' }).then(
        (antwort) => {
          if (antwort.ok) return antwort.json();
          if (i + 1 < adressen.length) return versuchen(i + 1);
          throw new Error('Die Fragenliste antwortet mit Fehler ' + antwort.status + '.');
        },
        (fehler) => {
          if (i + 1 < adressen.length) return versuchen(i + 1);
          throw fehler;
        }
      );
    return versuchen(0);
  }

  function fragenLaden() {
    abschnittZeigen('laden');
    fragenHolen()
      .then((daten) => {
        const gueltige = [];
        const bekannt = {};
        const roh = istObjekt(daten) && Array.isArray(daten.fragen) ? daten.fragen : [];
        roh.forEach((frage) => {
          if (frageGueltig(frage) && !bekannt[frage.id]) {
            bekannt[frage.id] = true;
            gueltige.push(frage);
          }
        });
        if (gueltige.length === 0) throw new Error('In der Fragenliste steht keine brauchbare Frage.');
        fragen = gueltige;
        fragenNachId = {};
        gueltige.forEach((frage) => {
          fragenNachId[frage.id] = frage;
        });
        listenStand = typeof daten.stand === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(daten.stand) ? daten.stand : '';
        startZeigen();
      })
      .catch(fehlerZeigen);
  }

  function ereignisseAnmelden() {
    $('tag-starten').addEventListener('click', () => {
      const zustand = tagZustand();
      if (zustand === 'erledigt') {
        const tagesquiz = speicher.tage[heute()].tagesquiz;
        ergebnisZeigen({ art: 'tag', tag: heute(), ids: tagesquiz.ids, antworten: tagesquiz.antworten });
      } else if (zustand === 'laeuft') {
        rundeFortsetzen(aktiveRunde('tag'));
      } else if (zustand === 'offen') {
        rundeStarten('tag');
      }
    });

    $('mehr-starten').addEventListener('click', mehrStarten);
    $('weiter-spielen').addEventListener('click', mehrStarten);

    $('ueben-starten').addEventListener('click', () => {
      if (tagZustand() === 'laeuft' || aktiveRunde('mehr')) return;
      const laufend = aktiveRunde('ueben');
      if (laufend) rundeFortsetzen(laufend);
      else rundeStarten('ueben');
    });

    $('nachlesen-starten').addEventListener('click', nachlesenUebersichtZeigen);
    $('nachlesen-zurueck').addEventListener('click', nachlesenZurueck);

    $('abbrechen').addEventListener('click', startZeigen);
    $('weiter').addEventListener('click', weiter);
    $('teilen').addEventListener('click', teilen);
    $('zum-start').addEventListener('click', startZeigen);
    $('nochmal').addEventListener('click', fragenLaden);
    $('zuruecksetzen').addEventListener('click', zuruecksetzen);

    // Kommt die App aus dem Hintergrund zurück, stimmen Datum und Tagesstand wieder.
    // Nach längerer Pause lädt sie komplett neu und holt so auch eine ergänzte Fragenliste. Mitten in einer Runde passiert nichts.
    let versteckt = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        versteckt = Date.now();
      } else if (!$('start').hidden) {
        if (versteckt && Date.now() - versteckt > NEULADEN_NACH_MS) window.location.reload();
        else startZeigen();
      }
    });
  }

  function init() {
    speicher = speicherLaden();
    // Falls die Schwellen kleiner geworden sind, reichen die Punkte vielleicht schon für die nächste Stufe.
    freischaltenPruefen();
    speicherSichern();
    // In der Vorschau steht oben ein Schild, damit sie niemand mit der echten App verwechselt.
    if (IN_VORSCHAU) {
      $('vorschau-schild').hidden = false;
      document.title = 'Football Brain (Vorschau)';
    }
    $('datum').textContent = datumLang(new Date());
    const alsApp = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
    if (alsApp || window.navigator.standalone) $('installieren').hidden = true;
    stufenAufbauen();
    ergebnisZeilenAufbauen();
    einfuehrungAufbauen();
    mitnehmenAufbauen();
    meldenAufbauen();
    ereignisseAnmelden();
    fragenLaden();
    symbolFuerIphone();
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
      });
    }
  }

  init();
})();
