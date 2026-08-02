import { chromium, devices } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('nope');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(4321, r));

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const shots = [];
const shot = async (name) => {
  const f = `/tmp/trainingsplan-shot-${name}.png`;
  await page.screenshot({ path: f });
  shots.push(f);
};
const step = (msg) => console.log('▶ ' + msg);
const assert = (cond, msg) => { if (!cond) { errors.push('ASSERT: ' + msg); console.log('  ✗ ' + msg); } else console.log('  ✓ ' + msg); };

await page.goto('http://localhost:4321/');
await page.waitForTimeout(400);

step('Leerzustand + Beispielplan');
await page.getByText('Beispielplan zum Ausprobieren').click();
await page.waitForTimeout(200);
assert(await page.getByText('Tag A — Oberkörper').first().isVisible(), 'Beispielplan sichtbar');
await shot('plan');

step('Training starten');
await page.locator('.tab[data-tab="training"]').click();
await page.locator('[data-start]').first().click();
await page.waitForTimeout(200);
assert(await page.locator('[data-entry-card]').count() === 4, 'vier Übungen im Training');
assert(await page.locator('.set-row.uni').count() > 0, 'einseitige Übung hat L/R-Zeilen');
await shot('session');

step('Sätze eintragen (beidseitig)');
const first = page.locator('[data-entry-card]').first();
await first.locator('[data-set-field="weight"]').first().fill('42,5');
await first.locator('[data-set-field="reps"]').first().fill('12');
await first.locator('.set-check').first().click();
await page.waitForTimeout(150);
assert(await first.locator('.set-row').first().getAttribute('class').then((c) => c.includes('done')), 'Satz abgehakt');

step('Abhaken ohne Eingabe wird blockiert');
const second = page.locator('[data-entry-card]').nth(1);
await second.locator('[data-set-field="weight"]').first().fill('');
await second.locator('[data-set-field="reps"]').first().fill('');
await second.locator('.set-check').first().click();
await page.waitForTimeout(150);
assert(!(await second.locator('.set-row').first().getAttribute('class')).includes('done'), 'leerer Satz nicht abhakbar');
await second.locator('[data-set-field="weight"]').first().fill('55');
await second.locator('[data-set-field="reps"]').first().fill('10');
await second.locator('.set-check').first().click();

step('Einseitige Übung: L/R getrennt');
const uni = page.locator('[data-entry-card]').nth(2);
await uni.locator('[data-set-field="weight"]').first().fill('16');
await uni.locator('[data-set-field="repsL"]').first().fill('10');
await uni.locator('[data-set-field="repsR"]').first().fill('12');
await uni.locator('.set-check').first().click();
await page.waitForTimeout(150);
assert((await uni.locator('.set-row').first().getAttribute('class')).includes('done'), 'einseitiger Satz abgehakt');
await shot('sets');

step('Gerät besetzt -> Ersatzübung nur für heute');
await page.locator('[data-entry-card]').nth(3).locator('[data-entry-menu]').click();
await page.waitForTimeout(200);
await page.getByText('Andere Übung — nur heute').click();
await page.waitForTimeout(200);
await page.locator('#picker-search').fill('Latzug');
await page.waitForTimeout(150);
await page.locator('[data-pick]').first().click();
await page.waitForTimeout(250);
assert(await page.locator('.badge-sub').first().isVisible(), 'Ersatz-Kennzeichnung sichtbar');
await shot('substitute');
const subCard = page.locator('[data-entry-card]').nth(3);
await subCard.locator('[data-set-field="weight"]').first().fill('60');
await subCard.locator('[data-set-field="reps"]').first().fill('8');
await subCard.locator('.set-check').first().click();

step('Satz hinzufügen');
const before = await first.locator('.set-row').count();
await first.locator('[data-add-set]').click();
await page.waitForTimeout(200);
assert(await page.locator('[data-entry-card]').first().locator('.set-row').count() === before + 1, 'Satz hinzugefügt');

step('Training beenden');
await page.locator('[data-finish]').click();
await page.waitForTimeout(200);
await page.locator('[data-yes]').click();
await page.waitForTimeout(300);
assert(await page.getByText('Letzte Trainings').isVisible(), 'zurück auf Trainingsübersicht');
await shot('after-finish');

step('Verlauf nach Übung');
await page.locator('.tab[data-tab="verlauf"]').click();
await page.waitForTimeout(200);
await page.locator('[data-mode="uebung"]').click();
await page.waitForTimeout(200);
await page.getByText('Schulterdrücken Kurzhantel').first().click();
await page.waitForTimeout(250);
assert((await page.locator('.hist-sets').first().innerText()).includes('10/12'), 'L/R im Verlauf sichtbar');
await shot('history-exercise');

step('Ersatzübung taucht im eigenen Verlauf auf');
await page.locator('[data-top="left"]').click();
await page.waitForTimeout(200);
await page.getByText('Latzug').first().click();
await page.waitForTimeout(250);
const latzugText = await page.locator('.view').innerText();
assert(latzugText.includes('als Ersatz') || latzugText.includes('60'), 'Latzug-Verlauf enthält den Ersatz-Einsatz');
await shot('history-latzug');

step('Zweites Training: Vorschlag vom letzten Mal');
await page.locator('.tab[data-tab="training"]').click();
await page.waitForTimeout(200);
await page.locator('[data-start]').first().click();
await page.waitForTimeout(300);
const w = await page.locator('[data-entry-card]').first().locator('[data-set-field="weight"]').first().inputValue();
assert(w === '42,5', `Gewicht vorgefüllt (bekommen: "${w}")`);
const plannedName = await page.locator('[data-entry-card]').nth(3).locator('.card-title').innerText();
assert(plannedName.includes('Rudern einarmig'), `Plan wieder auf Originalübung (bekommen: "${plannedName.split('\n')[0]}")`);
await shot('second-session');

step('Plan: Übung ersetzen (neuer Verlauf, alte archiviert)');
await page.locator('[data-top="left"]').click();
await page.waitForTimeout(200);
await page.getByText('Training verwerfen').click();
await page.waitForTimeout(200);
await page.locator('[data-yes]').click();
await page.waitForTimeout(250);
await page.locator('.tab[data-tab="plan"]').click();
await page.waitForTimeout(200);
await page.locator('[data-day]').first().click();
await page.waitForTimeout(200);
await page.locator('[data-slot]').first().click();
await page.waitForTimeout(250);
await page.getByText('Durch andere Übung ersetzen').click();
await page.waitForTimeout(200);
await page.locator('[data-create]').click();
await page.waitForTimeout(250);
await page.locator('#ex-name').fill('Schrägbankdrücken');
await page.locator('[data-ok]').click();
await page.waitForTimeout(300);
assert((await page.locator('.view').innerText()).includes('Schrägbankdrücken'), 'neue Übung im Plan');
await shot('replaced');

step('Alte Übung ist archiviert, Verlauf erhalten');
await page.locator('.tab[data-tab="mehr"]').click();
await page.waitForTimeout(200);
await page.locator('[data-exercises]').click();
await page.waitForTimeout(250);
const exText = (await page.locator('.view').innerText()).toUpperCase();
assert(exText.includes('ARCHIVIERT'), 'Archiv-Bereich vorhanden');
const archivedBlock = exText.split('ARCHIVIERT')[1] || '';
assert(archivedBlock.includes('BRUSTPRESSE'), 'Brustpresse archiviert');
assert(/\d+ SÄTZE/.test(archivedBlock), 'Verlauf der archivierten Übung erhalten');
await shot('archived');

step('Umbenennen behält den Verlauf');
await page.getByText('Brustpresse').first().click();
await page.waitForTimeout(250);
await page.getByText('Umbenennen').first().click();
await page.waitForTimeout(200);
await page.locator('#prompt-input').fill('Brustpresse (Gerät 3)');
await page.locator('[data-ok]').click();
await page.waitForTimeout(300);
const renamed = await page.locator('.view').innerText();
assert(renamed.includes('Brustpresse (Gerät 3)'), 'umbenannt');
assert(renamed.split('Brustpresse (Gerät 3)')[1].includes('Sätze'), 'Verlauf nach Umbenennen noch da');

step('Export');
await page.locator('[data-top="left"]').click();
await page.waitForTimeout(250);
await page.locator('[data-export]').click();
await page.waitForTimeout(200);
assert(await page.locator('[data-download]').isVisible(), 'Export-Dialog offen');
await page.locator('[data-close]').first().click();

step('Neuladen: Daten überleben');
await page.reload();
await page.waitForTimeout(500);
await page.locator('.tab[data-tab="verlauf"]').click();
await page.waitForTimeout(250);
assert((await page.locator('.view').innerText()).includes('Tag A'), 'Verlauf nach Reload vorhanden');
await shot('reload');

console.log('\n' + (errors.length ? '❌ FEHLER:\n' + errors.join('\n') : '✅ Alles grün'));
console.log('Screenshots: ' + shots.join(' '));
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
