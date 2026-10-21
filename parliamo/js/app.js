/**
 * Start der App: Reiter, Navigation, Installationshilfe, erster Start, Offline-Betrieb.
 */
import { h, ico, say, sheet, toast, closeSheets } from './ui.js';
import { load, S, save } from './store.js';
import { runFlow, frame, next, inFlow, tapOnce } from './flow.js';
import { unlock, ttsAvailable } from './speech.js';
import { placementStep } from './ex/placement.js';
import { LEVELS, LEVEL_NAMES, problems } from './content.js';
import * as V from './views.js';

load();

const ROOTS = {
  heute: V.renderHome,
  bereiche: V.renderAreas,
  quiz: V.renderQuiz,
  ueben: V.renderPractice,
  mehr: V.renderMore,
};

let tab = 'heute';
const stacks = { heute: [], bereiche: [], quiz: [], ueben: [], mehr: [] };
const scrollPos = new Map();

function current() {
  const st = stacks[tab];
  return st[st.length - 1] || ROOTS[tab];
}

function paint({ keepScroll = false } = {}) {
  const view = document.getElementById('view');
  const y = view.scrollTop;
  view.replaceChildren();
  view.dataset.tab = tab;
  try {
    current()(view);
  } catch (e) {
    console.error(e);
    view.append(h('div.warn', 'Hier ist etwas schiefgelaufen. Tippe unten auf einen Reiter, um weiterzumachen.'));
  }
  view.scrollTop = keepScroll ? y : 0;
  for (const b of document.querySelectorAll('.tab')) b.classList.toggle('on', b.dataset.tab === tab);
}

const nav = {
  show(render) {
    scrollPos.set(current(), document.getElementById('view').scrollTop);
    stacks[tab].push(render);
    paint();
  },
  back() {
    stacks[tab].pop();
    paint();
    const y = scrollPos.get(current());
    if (y) document.getElementById('view').scrollTop = y;
  },
  refresh() {
    paint({ keepScroll: true });
  },
  tab(name) {
    if (tab === name) stacks[name] = [];
    tab = name;
    paint();
  },
};
V.setNav(nav);

function buildShell() {
  const tabs = [
    ['heute', 'home', 'Heute'],
    ['bereiche', 'areas', 'Bereiche'],
    ['quiz', 'trophy', 'Quiz'],
    ['ueben', 'practice', 'Üben'],
    ['mehr', 'more', 'Mehr'],
  ];
  const bar = document.getElementById('tabbar');
  bar.replaceChildren(
    ...tabs.map(([id, icon, label]) =>
      h('button.tab', { type: 'button', 'data-tab': id, onClick: () => nav.tab(id) }, ico(icon), h('span.tab-label', label)),
    ),
  );
}

/* ---------------- Installationshilfe ---------------- */

const ua = navigator.userAgent || '';
const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
const isOtherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);

function installStep() {
  return async (flow) => {
    const { body, foot } = frame(flow, 'install');
    const step = (n, title, text, art) =>
      h('li.inst-step', h('span.inst-n', String(n)), h('div', h('b', title), text ? h('p.small.muted', text) : null), art || null);
    const steps = [];
    let n = 1;
    if (isOtherBrowser) steps.push(step(n++, 'In Safari öffnen', 'Kopiere den Link unten und füge ihn in Safari ein – nur Safari kann Apps auf den Home-Bildschirm legen.'));
    else steps.push(step(n++, 'Kommst du aus WhatsApp?', 'Dann tippe zuerst auf „⋯“ oder das Kompass-Symbol und wähle „In Safari öffnen“.'));
    steps.push(step(n++, 'Teilen-Symbol antippen', 'Das Quadrat mit dem Pfeil nach oben – unten in der Leiste. Bei neueren iPhones steckt es hinter „⋯“ unten rechts.', h('span.inst-art', ico('share'))));
    steps.push(step(n++, '„Zum Home-Bildschirm“ wählen', 'Dafür in der Liste eventuell etwas nach unten wischen.', h('span.inst-art', ico('plusSquare'))));
    steps.push(step(n++, 'Oben rechts „Hinzufügen“ tippen', 'Dann Parliamo über das neue Symbol auf dem Home-Bildschirm öffnen.'));
    const copy = h('button.chip', { type: 'button' }, ico('copy'), ' Link kopieren');
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(location.href.split('#')[0]);
        toast('Link kopiert.');
      } catch {
        toast(location.href.split('#')[0], 5000);
      }
    });
    body.append(
      h('div.inst-hero', h('img.inst-icon', { src: 'icons/apple-touch-icon.png', alt: '' }), h('h1', 'Parliamo auf den Home-Bildschirm holen'), h('p', 'Dann startet die App wie jede andere: mit eigenem Symbol, auch ohne Internet – und dein Lernstand bleibt sicher gespeichert.')),
      h('ol.inst-steps', steps),
      h('div.center', copy),
    );
    const skip = h('button.btn.ghost', { type: 'button' }, 'Erst einmal im Browser ausprobieren');
    foot.replaceChildren(skip);
    await tapOnce(skip);
    S().profile.installSkipped = true;
    save();
    return { install: 'skipped' };
  };
}

/* ---------------- Erster Start ---------------- */

function welcomeStep() {
  return async (flow) => {
    const { body, foot } = frame(flow, 'welcome');
    body.append(
      h(
        'div.welcome',
        h('div.awning.mini', { 'aria-hidden': 'true' }, h('div.awning-stripes'), h('div.awning-edge')),
        h('h1.welcome-it', 'Benvenuti!'),
        h('p.welcome-lead', 'Italienisch für Reisen und Alltag – mit Wörtern, typischen Sätzen, Dialogen, Rollenspielen und einem Quiz um die Million.'),
        h('p.small.muted', 'Ein paar kurze Fragen, dann geht es los.'),
      ),
    );
    await next(foot, 'Los geht’s');
    return {};
  };
}

function nameStep() {
  return async (flow) => {
    const { body, foot } = frame(flow, 'ob');
    const inp = h('input.text.big', { type: 'text', placeholder: 'Dein Vorname', autocomplete: 'given-name', value: S().profile.name || '' });
    body.append(h('p.ex-prompt', 'Kurz vorgestellt'), h('h2.ob-it', 'Come ti chiami?'), h('p.muted', 'Wie heißt du? Dann begrüßt dich die App mit Namen.'), inp);
    return new Promise((resolve) => {
      const done = () => {
        S().profile.name = inp.value.trim().slice(0, 30);
        save();
        resolve({});
      };
      inp.addEventListener('keydown', (e) => e.key === 'Enter' && done());
      foot.replaceChildren(h('button.btn.ghost', { type: 'button', onClick: () => resolve({}) }, 'Überspringen'), h('button.btn.big.primary', { type: 'button', onClick: done }, 'Weiter'));
    });
  };
}

function sexStep() {
  return async (flow) => {
    const { body, foot } = frame(flow, 'ob');
    body.append(
      h('p.ex-prompt', 'Eine Sache zur Grammatik'),
      h('h2.ob-title', 'Welche Form passt zu dir?'),
      h('p.muted', 'Im Italienischen ändern sich manche Wörter je nachdem, wer spricht: «Sono stanco» sagt ein Mann, «Sono stanca» eine Frau. So passen die Mustersätze zu dir.'),
    );
    return new Promise((resolve) => {
      const choose = (v) => {
        S().profile.sex = v;
        save();
        resolve({});
      };
      body.append(
        h(
          'div.choices',
          h('button.choice.it', { type: 'button', onClick: () => choose('m') }, h('span.choice-text', 'Sono stanco.'), h('small', 'männliche Form')),
          h('button.choice.it', { type: 'button', onClick: () => choose('f') }, h('span.choice-text', 'Sono stanca.'), h('small', 'weibliche Form')),
        ),
      );
      foot.replaceChildren();
    });
  };
}

function soundStep() {
  return async (flow) => {
    const { body, foot } = frame(flow, 'ob');
    const big = h('button.play-big.huge', { type: 'button' }, ico('speaker'), h('span', 'Antippen'));
    big.addEventListener('click', async () => {
      unlock();
      big.classList.add('on');
      await say(S().profile.sex === 'f' ? 'Ciao! Benvenuta su Parliamo.' : 'Ciao! Benvenuto su Parliamo.');
      big.classList.remove('on');
    });
    body.append(h('p.ex-prompt', 'Ton-Test'), h('h2.ob-title', 'Hörst du mich?'), h('p.muted', 'Tippe auf den Lautsprecher. Du solltest eine italienische Stimme hören.'), h('div.center', big));
    if (!ttsAvailable) body.append(h('p.warn', 'Dieses Gerät kann leider nicht vorlesen.'));
    return new Promise((resolve) => {
      foot.replaceChildren(
        h(
          'div.row2',
          h(
            'button.btn.ghost',
            {
              type: 'button',
              onClick: async () => {
                S().profile.soundOk = false;
                save();
                await sheet({
                  title: 'Kein Ton?',
                  body: h(
                    'ol.help-steps',
                    h('li', 'Mach das iPhone lauter (Taste links am Gerät).'),
                    h('li', 'Prüfe den Stummschalter bzw. die Aktionstaste.'),
                    h('li', 'Ist ein Bluetooth-Kopfhörer verbunden? Dann kommt der Ton dort heraus.'),
                    h('li', 'Danach nochmal auf den Lautsprecher tippen.'),
                  ),
                  actions: [{ label: 'Nochmal probieren', value: 'retry', primary: true }, { label: 'Trotzdem weiter', value: 'go' }],
                }).then((v) => v === 'go' && resolve({}));
              },
            },
            'Ich höre nichts',
          ),
          h(
            'button.btn.primary',
            {
              type: 'button',
              onClick: () => {
                S().profile.soundOk = true;
                save();
                resolve({});
              },
            },
            'Ja, ich höre sie',
          ),
        ),
      );
    });
  };
}

function levelStep() {
  return async (flow) => {
    const { body, foot } = frame(flow, 'ob');
    body.append(
      h('p.ex-prompt', 'Fast fertig'),
      h('h2.ob-title', 'Wie gut ist dein Italienisch schon?'),
      h('p.muted', 'Der kurze Test dauert etwa fünf Minuten. Danach weiß die App, womit du anfangen solltest.'),
    );
    return new Promise((resolve) => {
      body.append(
        h(
          'div.choices',
          h('button.choice.primary-choice', { type: 'button', onClick: () => { flow.add(placementStep()); resolve({}); } }, h('span.choice-text', 'Kurzen Test machen'), h('small', 'empfohlen')),
          LEVELS.map((l) =>
            h(
              'button.choice',
              {
                type: 'button',
                onClick: () => {
                  S().profile.level = l;
                  save();
                  resolve({});
                },
              },
              h('span.choice-text', `${l} – ${LEVEL_NAMES[l]}`),
              h('small', { A2: 'Grundgrammatik sitzt, Wortschatz ausbaufähig', B1: 'Alltagssituationen klappen meist', B2: 'Fast alles verständlich, Feinschliff' }[l]),
            ),
          ),
        ),
      );
      foot.replaceChildren();
    });
  };
}

async function onboarding() {
  const steps = [];
  if (isIOS && !isStandalone && !S().profile.installSkipped) steps.push(installStep());
  steps.push(welcomeStep(), nameStep(), sexStep(), soundStep(), levelStep());
  await runFlow({ steps, closable: false, confirmClose: false });
  if (!S().profile.level) S().profile.level = 'A2';
  if (!S().profile.sex) S().profile.sex = 'm';
  S().profile.onboarded = true;
  save(true);
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  } catch {
    /* nicht überall verfügbar */
  }
}

/* ---------------- Start ---------------- */

document.addEventListener('pointerdown', unlock, { once: true, capture: true });

async function start() {
  buildShell();
  paint();
  if (problems.length) console.warn('Inhaltsprobleme:', problems);
  if (!S().profile.onboarded) {
    await onboarding();
    paint();
  } else if (isIOS && !isStandalone && !S().profile.installSkipped) {
    // Im Browser geöffnet, obwohl schon eingerichtet: freundlich auf die Installation hinweisen
    toast('Tipp: Über Teilen → „Zum Home-Bildschirm“ wird Parliamo zur App.', 4200);
  }
}

start();

/* ---------------- Offline & Updates ---------------- */

if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let pending = false;
  navigator.serviceWorker
    .register('sw.js')
    .then((reg) => {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    })
    .catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    if (inFlow() || document.querySelector('.sheet-wrap')) {
      pending = true;
      return;
    }
    location.reload();
  });
  // Steht ein Update aus, beim nächsten Wechsel zurück auf die Startseite neu laden
  document.addEventListener('visibilitychange', () => {
    if (pending && document.visibilityState === 'hidden' && !inFlow()) location.reload();
  });
}
