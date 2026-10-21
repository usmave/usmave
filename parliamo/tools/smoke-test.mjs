/**
 * Durchlauf durch die Kernabläufe in einem echten Browser (iPhone-Profil).
 * Vorlesen und Spracherkennung werden simuliert.
 *
 *   node tools/smoke-test.mjs            (Screenshots nach $SHOTS oder /tmp)
 *   MIC=1 node tools/smoke-test.mjs      mit simulierter Spracherkennung
 */
import { chromium, devices } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const SHOTS = process.env.SHOTS || '/tmp/parliamo-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (!p.startsWith('/parliamo/')) {
    res.writeHead(404);
    return res.end();
  }
  p = p.slice('/parliamo'.length);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('nicht gefunden');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(4322, r));
const URL0 = 'http://localhost:4322/parliamo/';

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
const MIC = !!process.env.MIC;
await ctx.addInitScript((mic) => {
  const voices = [
    { lang: 'it-IT', name: 'Alice', voiceURI: 'alice', localService: true },
    { lang: 'it-IT', name: 'Luca (verbessert)', voiceURI: 'luca', localService: true },
  ];
  window.__spoken = [];
  const synth = {
    speaking: false,
    paused: false,
    getVoices: () => voices,
    speak(u) {
      window.__spoken.push(u.text);
      setTimeout(() => u.onend && u.onend(), 20);
    },
    cancel() {},
    resume() {},
    onvoiceschanged: null,
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = function (t) {
    this.text = t;
  };
  delete window.webkitSpeechRecognition;
  delete window.SpeechRecognition;
  if (mic) {
    class FakeSR {
      start() {
        setTimeout(() => {
          const text = window.__say || 'ciao';
          const alt = { transcript: text };
          const res = [alt];
          res.isFinal = true;
          this.onresult && this.onresult({ results: [res] });
          this.onend && this.onend();
        }, 60);
      }
      stop() {}
      abort() {}
    }
    window.webkitSpeechRecognition = FakeSR;
  }
}, MIC);

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});

let shotNo = 0;
const shot = async (name) => {
  const f = path.join(SHOTS, `${String(++shotNo).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: f });
};
const step = (m) => console.log('▶ ' + m);
const ok = (cond, msg) => {
  if (!cond) errors.push('ASSERT: ' + msg);
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`);
};
const wait = (ms) => page.waitForTimeout(ms);

async function clickText(text, sel = 'button') {
  // Ist eine Übung offen, nur darin suchen – darunter liegt die Startseite mit eigenen Knöpfen
  const scope = (await page.$('.sheet-wrap.open')) ? '.sheet-wrap.open ' : (await page.$('#flow-host .flow.open')) ? '#flow-host .flow.open ' : '#app ';
  const loc = page.locator(scope + sel, { hasText: text }).filter({ visible: true }).first();
  await loc.click({ timeout: 4000 });
  await wait(120);
}

/** Klickt sich durch jede Übungsfolge, bis sie zu ist. Liefert die Zahl der Aktionen. */
async function autopilot(max = 500, { shotsAt = {} } = {}) {
  let n = 0;
  for (; n < max; n++) {
    if (!(await page.$('#flow-host .flow.open'))) return n;
    await wait(70);
    const cls = await page.evaluate(() => {
      const ex = document.querySelector('#flow-host .flow.open .ex');
      return ex ? ex.className : '';
    });
    for (const [k, name] of Object.entries(shotsAt)) {
      if (cls.includes(k) && !shotsAt['_' + k]) {
        shotsAt['_' + k] = true;
        await shot(name);
      }
    }
    // Paare finden
    const lefts = await page.$$('.flow.open .pairs-col:first-child .pair:not(.done)');
    if (lefts.length) {
      for (const l of lefts) {
        const rights = await page.$$('.flow.open .pairs-col:last-child .pair:not(.done)');
        for (const r of rights) {
          await l.click();
          await r.click();
          await wait(40);
          if (await l.evaluate((e) => e.classList.contains('done'))) break;
        }
      }
      await wait(800);
      continue;
    }
    // Satzbau
    const tiles = await page.$$('.flow.open .order-pool .tile:not(.used)');
    if (tiles.length) {
      for (const t of tiles) await t.click();
      await clickText('Prüfen');
      continue;
    }
    // Auswahl
    const choice = await page.$('.flow.open .choice:not([disabled]), .flow.open .mq-opt:not([disabled]):not(.gone)');
    if (choice) {
      await choice.click();
      await wait(isStage() ? 1400 : 80);
      continue;
    }
    // Eingabe
    const input = await page.$('.flow.open .answer-input');
    if (input && (await input.isVisible()) && !(await input.inputValue())) {
      await input.fill(await page.evaluate(() => (window.__say = 'vorrei una camera doppia per favore')) && 'ciao');
      const check = page.locator('.flow.open .ex-foot button', { hasText: 'Prüfen' }).first();
      if (await check.isVisible()) await check.click();
      await wait(80);
      continue;
    }
    // Mikrofon
    const mic = await page.$('.flow.open .mic:not(.on)');
    if (mic && (await mic.isVisible())) {
      await mic.click();
      await wait(250);
      continue;
    }
    // Knöpfe unten: „Fertig“ vor allem anderen, sonst der Hauptknopf
    const clicked = await page.evaluate(() => {
      const foot = [...document.querySelectorAll('#flow-host .flow.open .ex-foot button')].filter((b) => b.offsetParent && !b.disabled);
      const fertig = foot.find((b) => b.textContent.trim() === 'Fertig');
      const main = fertig || foot.find((b) => b.classList.contains('primary') || b.classList.contains('gold')) || foot[foot.length - 1];
      if (main) {
        main.click();
        return main.textContent.trim();
      }
      return null;
    });
    if (!clicked) await wait(200);
    else await wait(clicked.startsWith('Weiter zur Frage') ? 80 : 60);
  }
  return n;
}
let stageFlag = false;
const isStage = () => stageFlag;

// ---------------------------------------------------------------- Ablauf

step('Erster Start mit Installationshilfe');
await page.goto(URL0);
await wait(600);
await shot('install');
ok(await page.locator('text=Home-Bildschirm holen').isVisible(), 'Installationshilfe sichtbar');
await clickText('Erst einmal im Browser ausprobieren');
await shot('welcome');
await clickText('Los geht’s');
await page.fill('.flow.open input.text', 'Anna');
await clickText('Weiter');
await clickText('Sono stanca.');
await clickText('Antippen');
await clickText('Ja, ich höre sie');
await shot('level');
await clickText('A2 – Grundlagen');
await wait(500);
ok(!(await page.$('#flow-host .flow.open')), 'Einrichtung abgeschlossen');
await shot('home');
ok(await page.locator('.hello-it', { hasText: 'Anna' }).isVisible(), 'Begrüßung mit Namen');

step('Heute lernen (15 Min)');
await page.click('.today .btn.primary');
await wait(300);
const n1 = await autopilot(600, { shotsAt: { intro: 'intro', pairs: 'pairs', summary: 'summary' } });
ok(n1 > 20, `Tagesprogramm durchlaufen (${n1} Aktionen)`);
await wait(400);
await shot('home-after');
const cards = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('parliamo.v1')).cards).length);
ok(cards >= 8, `Lernstand gespeichert (${cards} Einträge)`);

step('Bereich öffnen');
await page.click('.tab[data-tab="bereiche"]');
await wait(200);
await shot('areas');
await page.click('.area-tile:has-text("Kennenlernen")');
await wait(200);
await shot('area');
ok(await page.locator('.stage-path').isVisible(), 'Lernkurve des Bereichs sichtbar');

step('Dialog');
await page.click('.act:has-text("Kennenlernen auf einer Party")');
await wait(300);
const nd = await autopilot(80, { shotsAt: { 'dlg-play': 'dialog', 'dlg-text': 'dialog-text' } });
ok(nd > 4, `Dialog durchlaufen (${nd})`);

step('Rollenspiel');
await page.click('.act:has-text("Sich beim Abendessen vorstellen")');
await wait(300);
const nr = await autopilot(120, { shotsAt: { role: 'role' } });
ok(nr > 4, `Rollenspiel durchlaufen (${nr})`);

step('Wortliste und Eintrag');
await page.click('.act:has-text("Wörter & Sätze")');
await wait(200);
await shot('list');
await page.click('.item-row');
await wait(400);
await shot('item-sheet');
await page.click('.sheet-wrap .btn:has-text("Schließen")');
await wait(300);

step('Quiz: Il Milione');
await page.click('.tab[data-tab="quiz"]');
await wait(200);
await shot('quiz-tab');
stageFlag = true;
await clickText('Spielen – alle Bereiche');
await wait(300);
const nq = await autopilot(120, { shotsAt: { mq: 'quiz' } });
stageFlag = false;
ok(nq > 3, `Quiz gespielt (${nq})`);
const qz = await page.evaluate(() => JSON.parse(localStorage.getItem('parliamo.v1')).quiz);
ok(qz.games >= 1, `Quiz-Statistik (${qz.games} Spiel, ${qz.bank} €)`);

step('Üben: Zahlen, Aussprache, Diktat');
await page.click('.tab[data-tab="ueben"]');
await wait(200);
await shot('practice');
await clickText('Zahlen, Preise & Uhrzeiten');
await page.click('.drill-row:has-text("Preise") .chip:has-text("Hören")');
await wait(200);
ok((await autopilot(80)) > 5, 'Preise geübt');
await page.click('.back');
await clickText('Aussprache');
await page.click('.row:has-text("Doppelte Konsonanten")');
await wait(200);
ok((await autopilot(80)) > 5, 'Aussprache geübt');
await page.click('.back');
await clickText('Diktat');
ok((await autopilot(80)) > 3, 'Diktat geübt');
await clickText('Einstufungstest');
ok((await autopilot(120, { shotsAt: { placement: 'placement' } })) > 5, 'Einstufungstest durchlaufen');

step('Mehr: Statistik und Einstellungen');
await page.click('.tab[data-tab="mehr"]');
await clickText('Statistik');
await wait(200);
await shot('stats');
await page.click('.back');
await clickText('Einstellungen');
await wait(200);
await shot('settings');

step('Neu laden – Lernstand bleibt');
await page.reload();
await wait(600);
ok(await page.locator('.hello-it').isVisible(), 'Startseite nach Neuladen');
ok(!(await page.$('#flow-host .flow.open')), 'keine erneute Einrichtung');

await browser.close();
server.close();
console.log(`\nScreenshots: ${SHOTS}`);
if (errors.length) {
  console.log(`\n${errors.length} Probleme:\n` + errors.map((e) => '  ✗ ' + e).join('\n'));
  process.exit(1);
}
console.log('Alles in Ordnung.');
