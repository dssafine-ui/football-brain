// Football Brain: lädt die Fragen aus fragen.json und merkt sich den Fortschritt auf diesem Gerät (localStorage).
// Kein Konto, kein Server: Wissensstufe, Punkte, Serie, gesehene Fragen und Ergebnisse bleiben im Browser.
// Das Tagesquiz hat fünf Fragen. Danach lassen sich ohne Obergrenze weitere neue Fragen spielen, immer zufällig aus allen Themen.
(function () {
  'use strict';

  const SPEICHER_KEY = 'football-tagesquiz-fortschritt-v1';
  const FRAGEN_PRO_RUNDE = 5;
  const BUCHSTABEN = ['A', 'B', 'C', 'D', 'E', 'F'];
  const ABSCHNITTE = ['laden', 'start', 'frage', 'ergebnis', 'fehler'];
  const NEULADEN_NACH_MS = 30 * 60 * 1000;
  // Die Wissensstufe sagt, wie schwer eine Frage ist. Mit dem Thema (Kategorie) hat sie nichts zu tun.
  const STUFEN = [
    { nummer: 1, name: 'Highschool', hinweis: 'leicht' },
    { nummer: 2, name: 'College', hinweis: 'mittel' },
    { nummer: 3, name: 'NFL', hinweis: 'schwer' },
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
    return { v: 1, fragen: {}, tage: {}, runde: null, stufe: START_STUFE, punkte: 0 };
  }

  function speicherLaden() {
    const frisch = leererSpeicher();
    try {
      const roh = window.localStorage.getItem(SPEICHER_KEY);
      const daten = roh ? JSON.parse(roh) : null;
      if (istObjekt(daten)) {
        if (istObjekt(daten.fragen)) frisch.fragen = daten.fragen;
        if (istObjekt(daten.tage)) frisch.tage = daten.tage;
        if (istObjekt(daten.runde)) frisch.runde = daten.runde;
        if (stufeGueltig(daten.stufe)) frisch.stufe = daten.stufe;
        if (Number.isFinite(daten.punkte) && daten.punkte >= 0) frisch.punkte = Math.floor(daten.punkte);
      }
    } catch (fehler) {
      // Lesen nicht erlaubt oder Daten kaputt: sauber von vorn anfangen.
    }
    return frisch;
  }

  function speicherSichern() {
    try {
      window.localStorage.setItem(SPEICHER_KEY, JSON.stringify(speicher));
      speicherGeht = true;
    } catch (fehler) {
      speicherGeht = false;
    }
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
    return ungeseheneInsgesamt() > 0
      ? 'Auf dieser Stufe sind alle Fragen durch. Wechsle die Stufe oder nutze die Übungsrunde.'
      : 'Alle Fragen sind durch. Neue gibt es, sobald die Fragenliste ergänzt wird. Bis dahin hilft die Übungsrunde.';
  }

  // Tage in Folge mit mindestens einer beendeten Runde. Ist heute noch nichts gespielt, zählt gestern noch.
  function serieBerechnen() {
    let tag = heute();
    if (!speicher.tage[tag]) tag = tagDavor(tag);
    let serie = 0;
    while (speicher.tage[tag] && serie < 3650) {
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
    runde = { art: art, tag: heute(), ids: ids, antworten: ids.map(() => -1), fertig: false };
    speicher.runde = runde;
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

  function antwortWaehlen(index) {
    if (!runde || runde.fertig || runde.antworten[position] !== -1) return;
    const frage = fragenNachId[runde.ids[position]];
    runde.antworten[position] = index;
    const alt = istObjekt(speicher.fragen[frage.id]) ? speicher.fragen[frage.id] : {};
    const richtig = index === frage.richtig;
    speicher.fragen[frage.id] = { tag: alt.tag || runde.tag, richtig: richtig };
    if (richtig) speicher.punkte += punkteJeFrage(runde.art);
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
    if (!window.confirm('Fortschritt wirklich löschen? Serie, Punkte, Ergebnisse und gesehene Fragen fangen wieder bei null an. Die gewählte Wissensstufe bleibt.')) return;
    const stufe = speicher.stufe;
    speicher = leererSpeicher();
    speicher.stufe = stufe;
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

    let heuteText = 'offen';
    let knopfText = '';
    if (zustand === 'erledigt') {
      const bilanz = heuteBilanz();
      heuteText = bilanz.richtig + '/' + bilanz.von;
      knopfText = 'Ergebnis vom Tagesquiz ansehen';
    } else if (zustand === 'laeuft') {
      heuteText = 'läuft';
      knopfText = 'Tagesquiz fortsetzen';
    } else if (zustand === 'offen') {
      knopfText = 'Tagesquiz starten';
      if (vorrat < FRAGEN_PRO_RUNDE) knopfText += ' (' + vorrat + (vorrat === 1 ? ' Frage)' : ' Fragen)');
    } else {
      heuteText = 'keine';
    }
    $('heute').textContent = heuteText;
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
    $('stand').textContent = stand + fragen.length + ' Fragen';
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
  }

  function stufeWaehlen(nummer) {
    if (!stufeGueltig(nummer) || nummer === speicher.stufe || rundeOffen()) return;
    speicher.stufe = nummer;
    speicherSichern();
    startZeigen();
  }

  function stufenZeigen() {
    const gesperrt = rundeOffen();
    document.querySelectorAll('#stufen .stufe').forEach((knopf) => {
      const aktiv = Number(knopf.dataset.stufe) === speicher.stufe;
      knopf.classList.toggle('aktiv', aktiv);
      knopf.setAttribute('aria-pressed', aktiv ? 'true' : 'false');
      knopf.disabled = gesperrt;
    });
    let info = '';
    if (gesperrt) info = 'Die Stufe lässt sich erst wechseln, wenn die laufende Runde beendet ist.';
    else if (tagZustand() === 'erledigt') info = 'Die gewählte Stufe gilt ab morgen, für weitere Fragen und für die Übungsrunde.';
    $('stufen-info').textContent = info;
    $('stufen-info').hidden = info === '';
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
    frage.antworten.forEach((text, index) => {
      const knopf = document.createElement('button');
      knopf.type = 'button';
      knopf.className = 'antwort';
      const buchstabe = document.createElement('span');
      buchstabe.className = 'buchstabe';
      buchstabe.textContent = BUCHSTABEN[index];
      const inhalt = document.createElement('span');
      inhalt.className = 'text';
      inhalt.textContent = text;
      const marke = document.createElement('span');
      marke.className = 'marke';
      marke.setAttribute('aria-hidden', 'true');
      knopf.append(buchstabe, inhalt, marke);
      knopf.addEventListener('click', () => antwortWaehlen(index));
      box.appendChild(knopf);
    });
    $('rueckmeldung').hidden = true;
  }

  function quelleZeigen(quelle) {
    const zeile = $('rueckmeldung-quelle');
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

  function rueckmeldungZeigen(frage, gewaehlt) {
    const richtig = gewaehlt === frage.richtig;
    const knoepfe = $('antworten').children;
    for (let i = 0; i < knoepfe.length; i++) {
      knoepfe[i].disabled = true;
      const marke = knoepfe[i].querySelector('.marke');
      if (i === frage.richtig) {
        knoepfe[i].classList.add('richtig');
        marke.textContent = '✓';
      } else if (i === gewaehlt) {
        knoepfe[i].classList.add('falsch');
        marke.textContent = '✗';
      }
    }

    const box = $('rueckmeldung');
    box.className = 'rueckmeldung ' + (richtig ? 'ok' : 'nein');
    $('rueckmeldung-titel').textContent = richtig ? 'Richtig!' : 'Leider falsch';
    const loesung = $('rueckmeldung-richtig');
    loesung.textContent = 'Richtig ist: ' + BUCHSTABEN[frage.richtig] + ') ' + frage.antworten[frage.richtig];
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

    // Direkt unter dem Ergebnis geht es mit der nächsten Runde neuer Fragen weiter, solange auf der Stufe welche übrig sind.
    const mehr = mehrZustand();
    const weiterKnopf = $('weiter-spielen');
    weiterKnopf.hidden = !mehrSichtbar(mehr);
    weiterKnopf.textContent = mehrKnopfText(mehr);
    $('teilen').className = weiterKnopf.hidden ? 'haupt' : 'neben';
    const leerText = mehr === 'leer' ? leerHinweis() : '';
    $('mehr-hinweis').textContent = leerText;
    $('mehr-hinweis').hidden = leerText === '';

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

  function kopieren(text) {
    const hinweis = $('teilen-hinweis');
    hinweis.style.whiteSpace = 'pre-line';
    const vonHand = 'Zum Teilen bitte von Hand kopieren:\n' + text;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => {
          hinweis.textContent = 'Ergebnis kopiert. Jetzt in eine Nachricht einfügen.';
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
    if (navigator.share) {
      navigator.share({ text: text, url: adresse }).catch((fehler) => {
        if (!fehler || fehler.name !== 'AbortError') kopieren(text + '\n' + adresse);
      });
    } else {
      kopieren(text + '\n' + adresse);
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

  function fragenLaden() {
    abschnittZeigen('laden');
    fetch('fragen.json', { cache: 'no-cache' })
      .then((antwort) => {
        if (!antwort.ok) throw new Error('Die Fragenliste antwortet mit Fehler ' + antwort.status + '.');
        return antwort.json();
      })
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
    speicherSichern();
    $('datum').textContent = datumLang(new Date());
    const alsApp = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
    if (alsApp || window.navigator.standalone) $('installieren').hidden = true;
    stufenAufbauen();
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
