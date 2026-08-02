/**
 * Durchlauf durch die Kernabläufe der App in einem echten Browser.
 *
 *   npm i playwright && node tools/smoke-test.mjs
 *
 * CHROMIUM_PATH kann gesetzt werden, wenn Chromium schon woanders liegt.
 */
import { chromium, devices } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('nicht gefunden');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(4321, r));

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
);
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});

const shots = [];
const shot = async (name) => {
  const f = `/tmp/trainingsplan-shot-${name}.png`;
  await page.screenshot({ path: f });
  shots.push(f);
};
const step = (msg) => console.log('▶ ' + msg);
const ok = (cond, msg) => {
  if (!cond) {
    errors.push('ASSERT: ' + msg);
    console.log('  ✗ ' + msg);
  } else console.log('  ✓ ' + msg);
};
const wait = (ms = 220) => page.waitForTimeout(ms);

const card = (i) => page.locator('[data-entry-card]').nth(i);
const fill = (i, field, value) => card(i).locator(`[data-set-field="${field}"]`).first().fill(value);
const check = async (i, n = 0) => {
  await card(i).locator('.set-check').nth(n).click();
  await wait(160);
};
const rowClass = (i, n = 0) => card(i).locator('.set-row').nth(n).getAttribute('class');
const tab = async (name) => {
  await page.locator(`.tab[data-tab="${name}"]`).click();
  await wait();
};

await page.goto('http://localhost:4321/');
await wait(400);

step('Leerzustand → eigener Plan');
await page.getByText('Meinen Plan anlegen').click();
await wait();
ok((await page.locator('[data-day]').count()) === 2, 'Tag A und Tag B angelegt');
await shot('plan');

step('Tag A: sieben Übungen, Seitheben einarmig');
await page.locator('[data-day]').first().click();
await wait(250);
ok((await page.locator('[data-slot]').count()) === 7, 'Tag A hat sieben Übungen');
ok(
  (await page.locator('[data-slot]').nth(4).innerText()).includes('einarmig'),
  'Seitheben Kabel ist als einarmig markiert'
);
await shot('plan-tag-a');

step('Einarmig lässt sich an- und wieder abschalten');
await page.locator('[data-slot]').nth(5).click();
await wait(250);
await page.getByText('Als einarmig markieren (L/R)').click();
await wait(300);
ok((await page.locator('[data-slot]').nth(5).innerText()).includes('einarmig'), 'eingeschaltet');
await page.locator('[data-slot]').nth(5).click();
await wait(250);
await page.getByText('Einarmig (L/R) ausschalten').click();
await wait(300);
ok(!(await page.locator('[data-slot]').nth(5).innerText()).includes('einarmig'), 'wieder ausgeschaltet');

step('Tag B: sechs Übungen, Klimmzugmaschine mit Unterstützungsgewicht');
await page.locator('[data-top="left"]').click();
await wait(250);
await page.locator('[data-day]').nth(1).click();
await wait(250);
ok((await page.locator('[data-slot]').count()) === 6, 'Tag B hat sechs Übungen');
await page.locator('[data-slot]').first().click();
await wait(250);
ok(
  await page.getByText('Unterstützungsgewicht aus').isVisible(),
  'Klimmzugmaschine ist als Unterstützungsgewicht hinterlegt'
);
await page.locator('[data-close]').first().click();
await wait();

step('Training starten — Tag A ist dran');
await tab('training');
ok((await page.locator('.next-name').innerText()).includes('Tag A'), 'Vorschlag: Tag A');
await page.locator('.next-card [data-start]').click();
await wait(300);
ok((await page.locator('[data-entry-card]').count()) === 7, 'sieben Übungen im Training');
ok((await card(0).locator('.set-row').count()) === 2, 'Bankdrückmaschine flach mit zwei Sätzen');
ok((await card(6).locator('.set-row').count()) === 3, 'Dips mit drei Sätzen');
ok((await page.locator('.set-row.uni').count()) === 2, 'Seitheben hat L/R-Felder');
await shot('session');

step('Sätze eintragen');
await fill(0, 'weight', '40');
await fill(0, 'reps', '10');
await check(0);
ok((await rowClass(0)).includes('done'), 'Satz abgehakt');

step('Ohne Wert und ohne Vorschlag ist Abhaken gesperrt');
await check(1);
ok(!(await rowClass(1)).includes('done'), 'leerer Satz nicht abhakbar');
await fill(1, 'weight', '55');
await fill(1, 'reps', '12');
await check(1);
ok((await rowClass(1)).includes('done'), 'nach Eingabe abhakbar');

step('Einseitige Übung: L und R getrennt');
await fill(4, 'weight', '7,5');
await fill(4, 'repsL', '12');
await fill(4, 'repsR', '14');
await check(4);
ok((await rowClass(4)).includes('done'), 'einseitiger Satz abgehakt');
await shot('sets');

step('Gerät besetzt → Ersatzübung nur für heute');
await card(6).locator('[data-entry-menu]').click();
await wait();
await page.getByText('Andere Übung — nur heute').click();
await wait();
await page.locator('[data-create]').click();
await wait(250);
await page.locator('#ex-name').fill('Trizepsdrücken Maschine');
await page.locator('[data-ok]').click();
await wait(300);
ok((await card(6).locator('.sub-note').innerText()).includes('Dips'), 'Ersatz nennt die ursprüngliche Übung');
await fill(6, 'weight', '30');
await fill(6, 'reps', '12');
await check(6);
await shot('substitute');

step('Satz hinzufügen');
const before = await card(0).locator('.set-row').count();
await card(0).locator('[data-add-set]').click();
await wait();
ok((await card(0).locator('.set-row').count()) === before + 1, 'Satz hinzugefügt');

step('Training beenden');
await page.locator('[data-finish]').click();
await wait();
await page.locator('[data-yes]').click();
await wait(300);

step('Rotation: nach Tag A wird Tag B vorgeschlagen');
ok((await page.locator('.next-name').innerText()).includes('Tag B'), 'Vorschlag: Tag B');
ok((await page.locator('.next-hint').innerText()).includes('Tag A'), 'Hinweis nennt das letzte Training');
await shot('rotation');

step('Verlauf: L/R sichtbar');
await tab('verlauf');
await page.locator('[data-mode="uebung"]').click();
await wait();
await page.getByText('Seitheben Kabel').first().click();
await wait(250);
ok((await page.locator('.hist-sets').first().innerText()).includes('12/14'), 'L/R im Verlauf');
await shot('history-uni');

step('Ersatzübung landet im Verlauf der Ersatzübung');
await page.locator('[data-top="left"]').click();
await wait();
await page.getByText('Trizepsdrücken Maschine').first().click();
await wait(250);
const ersatz = await page.locator('.view').innerText();
ok(ersatz.includes('als Ersatz'), 'Einsatz als Ersatz ist markiert');
ok(ersatz.includes('30'), 'Werte des Ersatz-Einsatzes sind da');

step('Zweites Training: Werte vom letzten Mal stehen als Vorschlag drin');
await tab('training');
await page.locator('.list [data-start]').first().click(); // bewusst wieder Tag A
await wait(300);
const weightInput = card(0).locator('[data-set-field="weight"]').first();
ok((await weightInput.inputValue()) === '', 'Feld ist leer (kein Zahlensalat)');
ok((await weightInput.getAttribute('placeholder')) === '40', 'Vorschlag steht blass im Feld');
ok(
  (await card(6).locator('.card-title').innerText()).includes('Dips'),
  'im Plan steht wieder die ursprüngliche Übung'
);
await shot('suggestion');

step('Abhaken übernimmt den Vorschlag');
await check(0);
ok((await weightInput.inputValue()) === '40', 'Vorschlag wurde übernommen');
ok((await rowClass(0)).includes('done'), 'Satz gilt als erledigt');

step('Höheres Gewicht → Bestwert');
await fill(0, 'weight', '42,5');
await fill(0, 'reps', '10');
await page.locator('[data-finish]').click();
await wait();
await page.locator('[data-yes]').click();
await wait(300);

step('Übungsverlauf: Graph, Bestwert, Veränderung');
await tab('verlauf');
await page.locator('[data-mode="uebung"]').click();
await wait();
await page.getByText('Bankdrückmaschine flach').first().click();
await wait(250);
ok((await page.locator('.spark').count()) === 1, 'Fortschrittsgraph vorhanden');
const verlauf = await page.locator('.view').innerText();
ok(verlauf.includes('Bestwert'), 'Bestwert markiert');
ok(
  verlauf.includes('+2,5 kg'),
  `Veränderung zum Vormal — gefunden: ${JSON.stringify(verlauf.match(/[+−][\d,]+ (kg|Wdh)/g))}`
);
ok(verlauf.includes('Volumen'), 'Volumen pro Eintrag');
await shot('history-progress');

step('Trainingsdetail: Kennzahlen und Sprung zur Übung');
await page.locator('[data-top="left"]').click();
await wait();
await page.locator('[data-mode="training"]').click();
await wait();
await page.locator('[data-session]').first().click();
await wait(250);
const detail = (await page.locator('.view').innerText()).toUpperCase();
ok(detail.includes('VOLUMEN') && detail.includes('DAUER'), 'Volumen und Dauer im Trainingsdetail');
await shot('session-detail');
await page.locator('.hist-entry.tappable').first().click();
await wait(250);
ok((await page.locator('.hist-entry').count()) > 0, 'Sprung in den Übungsverlauf klappt');

step('Unterstützungsgewicht: zweimal Tag B mit weniger Hilfe');
await tab('training');
await page.locator('.next-card [data-start]').click(); // Tag B
await wait(300);
ok((await card(0).locator('.card-title').innerText()).includes('Klimmzugmaschine'), 'Tag B beginnt mit der Klimmzugmaschine');
await fill(0, 'weight', '50');
await fill(0, 'reps', '8');
await check(0);
await page.locator('[data-finish]').click();
await wait();
await page.locator('[data-yes]').click();
await wait(300);

await page.locator('.list [data-start]').first().click(); // nochmal Tag B
await wait(300);
ok(
  (await card(0).locator('[data-set-field="weight"]').first().getAttribute('placeholder')) === '50',
  'Vorschlag vom letzten Mal steht drin'
);
await fill(0, 'weight', '45'); // weniger Hilfe = besser
await fill(0, 'reps', '8');
await check(0);
await page.locator('[data-finish]').click();
await wait();
await page.locator('[data-yes]').click();
await wait(300);

step('Weniger Gewicht zählt hier als Fortschritt');
await tab('verlauf');
await page.locator('[data-mode="uebung"]').click();
await wait();
await page.getByText('Klimmzugmaschine').first().click();
await wait(250);
const hilfe = await page.locator('.view').innerText();
ok(hilfe.includes('−5 kg'), `Veränderung ausgewiesen — gefunden: ${JSON.stringify(hilfe.match(/[+−][\d,]+ (kg|Wdh)/g))}`);
ok((await page.locator('.delta.up').count()) === 1, 'weniger Gewicht ist grün (= besser)');
ok((await page.locator('.badge-pr').count()) === 1, 'genau ein Bestwert — der leichtere Eintrag');
ok(
  (await page.locator('.hist-entry').first().innerText()).includes('Bestwert'),
  'der Bestwert sitzt beim neuesten (leichtesten) Eintrag'
);
ok(!hilfe.includes('Volumen'), 'kein Volumen — wäre hier die falsche Richtung');
ok((await page.locator('[data-top="left"]').isVisible()) && (await page.locator('.topbar .sub').innerText()).includes('weniger Gewicht = besser'), 'Hinweis in der Kopfzeile');
await shot('assisted');

step('Ersatz nach schon abgehaktem Satz: Sätze bleiben bei der alten Übung');
await tab('training');
await page.locator('.next-card [data-start]').click(); // Tag B
await wait(300);
const cardsBefore = await page.locator('[data-entry-card]').count();
await fill(0, 'weight', '100');
await fill(0, 'reps', '10');
await check(0);
await card(0).locator('[data-entry-menu]').click();
await wait();
await page.getByText('Andere Übung — nur heute').click();
await wait();
await page.locator('[data-pick]').first().click();
await wait(300);
ok((await page.locator('[data-entry-card]').count()) === cardsBefore + 1, 'Alternative kommt als eigener Eintrag dazu');
ok((await card(0).locator('.set-row').count()) === 1, 'alte Übung behält genau ihren abgehakten Satz');
ok((await card(0).locator('.set-row.done').count()) === 1, 'und der bleibt abgehakt');
ok(await card(1).locator('.sub-note').isVisible(), 'neuer Eintrag ist als Ersatz gekennzeichnet');
await shot('split');
await page.locator('[data-top="left"]').click();
await wait();
await page.getByText('Training verwerfen').click();
await wait();
await page.locator('[data-yes]').click();
await wait(300);

step('Plan: Übung ersetzen → neue Übung, alte archiviert');
await tab('plan');
await page.locator('[data-day]').first().click();
await wait();
await page.locator('[data-slot]').first().click();
await wait(250);
await page.getByText('Durch andere Übung ersetzen').click();
await wait();
await page.locator('[data-create]').click();
await wait(250);
await page.locator('#ex-name').fill('Bankdrücken Langhantel');
await page.locator('[data-ok]').click();
await wait(300);
ok((await page.locator('.view').innerText()).includes('Bankdrücken Langhantel'), 'neue Übung steht im Plan');
await shot('replaced');

step('Alte Übung archiviert, Verlauf erhalten');
await tab('mehr');
await page.locator('[data-exercises]').click();
await wait(250);
const exText = (await page.locator('.view').innerText()).toUpperCase();
ok(exText.includes('ARCHIVIERT'), 'Archiv-Bereich vorhanden');
const archiviert = exText.split('ARCHIVIERT')[1] || '';
ok(archiviert.includes('BANKDRÜCKMASCHINE FLACH'), 'alte Übung ist archiviert');
ok(/\d+ SÄTZE/.test(archiviert), 'Verlauf der archivierten Übung erhalten');
await shot('archived');

step('Umbenennen behält den Verlauf');
await page.getByText('Bankdrückmaschine flach').first().click();
await wait(250);
await page.getByText('Umbenennen').first().click();
await wait();
await page.locator('#prompt-input').fill('Bankdrückmaschine flach (Gerät 2)');
await page.locator('[data-ok]').click();
await wait(300);
const renamed = await page.locator('.view').innerText();
ok(renamed.includes('Bankdrückmaschine flach (Gerät 2)'), 'umbenannt');
ok(renamed.split('Bankdrückmaschine flach (Gerät 2)')[1].includes('Sätze'), 'Verlauf nach Umbenennen erhalten');

step('Export');
await page.locator('[data-top="left"]').click();
await wait(250);
await page.locator('[data-export]').click();
await wait();
ok(await page.locator('[data-download]').isVisible(), 'Export-Dialog offen');
await page.locator('[data-close]').first().click();

step('Neuladen: alles noch da');
await page.reload();
await wait(500);
ok((await page.locator('.next-name').innerText()).includes('Tag A'), 'Tagesvorschlag übersteht Neuladen');
await tab('verlauf');
ok((await page.locator('.view').innerText()).includes('Tag A'), 'Verlauf übersteht Neuladen');
await shot('reload');

console.log('\n' + (errors.length ? '❌ FEHLER:\n' + errors.join('\n') : '✅ Alles grün'));
console.log('Screenshots: ' + shots.join(' '));
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
