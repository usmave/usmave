/**
 * Sprechen: Rollenspiele mit Inhaltspunkten und Nachsprechen (Shadowing).
 */
import { h, ico, spk, say, rich, shuffle, pick, sfx, sleep, stopSpeaking } from '../ui.js';
import { frame, prompt, verdict, next, tapOnce, speakAnswer, micUsable, alignView, runFlow, playButton, slowButton } from '../flow.js';
import { items, areaById, levelRank } from '../content.js';
import { S, save } from '../store.js';
import { matchNeeds, alignWords, g } from '../text.js';
import { userLevel } from '../session.js';
import { unlock, listen, FATAL_STT } from '../speech.js';
import { summaryStep } from './vocab.js';

const G = (t) => g(t, S().profile.sex);

function partnerBubble(text, de, { auto = true } = {}) {
  const deEl = h('p.bub-de.hidden', de || '');
  const tr = h('button.chip.tiny', { type: 'button' }, 'Übersetzung');
  tr.addEventListener('click', () => deEl.classList.toggle('hidden'));
  const b = h(
    'div.bub.partner',
    h('span.avatar.v0', '🙂'),
    h('div.bub-body', h('p.bub-it', G(text)), deEl, h('div.bub-tools', spk(text), spk(text, { slow: true }), de ? tr : null)),
  );
  if (auto) setTimeout(() => say(text), 250);
  return b;
}

export function roleStep(role) {
  return async (flow) => {
    const area = areaById.get(role.area);
    {
      const { body, foot } = frame(flow, 'role-intro');
      body.append(
        h('p.ex-prompt', `Rollenspiel, Niveau ${role.lvl}`),
        h('h2.dlg-title', role.title),
        area ? h('p.small.muted', `${area.icon} ${area.title}`) : null,
        h('p.dlg-situation', rich(role.intro)),
        h(
          'div.tipbox',
          ico('bulb'),
          h(
            'span',
            micUsable()
              ? 'Dein Gegenüber spricht zuerst. Tippe dann auf das Mikrofon und antworte auf Italienisch. Danach siehst du, was schon drin war, und eine Musterantwort.'
              : 'Dein Gegenüber spricht zuerst. Tippe deine Antwort auf Italienisch – oder sprich sie über die Mikrofon-Taste der Tastatur. Danach siehst du eine Musterantwort.',
          ),
        ),
      );
      await next(foot, 'Los geht’s');
    }
    let full = 0;
    for (let si = 0; si < role.steps.length; si++) {
      const st = role.steps[si];
      let tries = 0;
      for (;;) {
        tries++;
        const { body, foot } = frame(flow, 'role');
        const hintOut = h('p.hint-out');
        body.append(
          h('p.ex-prompt', `Schritt ${si + 1} von ${role.steps.length}`),
          partnerBubble(st.p, st.pde, { auto: tries === 1 }),
          h('div.task', h('div.task-head', 'Deine Aufgabe'), h('p', rich(st.task)), hintOut),
        );
        const tip = h('button.chip', { type: 'button' }, 'Tipp');
        tip.addEventListener('click', () => {
          const words = G(st.model).split(' ');
          hintOut.textContent = `So könnte es anfangen: ${words.slice(0, Math.min(3, words.length)).join(' ')} …`;
          tip.disabled = true;
        });
        body.append(h('div.chips.center', tip));
        const r = await speakAnswer(body, foot, { placeholder: 'Deine Antwort auf Italienisch …' });
        const model = G(st.model);
        let res = matchNeeds(r.gaveUp ? '' : r.text, st.need);
        for (const alt of r.alts || []) {
          const m = matchNeeds(alt, st.need);
          if (m.score > res.score) res = m;
        }
        const ok = res.all ? true : res.score >= 0.5 ? 'hard' : false;
        if (ok === true) full++;
        say(model);
        const chips = h(
          'div.need-list',
          res.res.map((x) => h('span.need' + (x.ok ? '.ok' : '.miss'), ico(x.ok ? 'check' : 'cross'), x.h)),
        );
        const modelBox = h(
          'div.model',
          h('div.model-head', 'So könntest du es sagen'),
          h('p.model-it', model, ' ', spk(model)),
          st.mde ? h('p.small.muted', st.mde) : null,
          st.alts.length ? h('p.small', 'Auch möglich: ', h('i', G(st.alts[0]))) : null,
        );
        const heard = !r.gaveUp && r.text ? h('p.small', r.typed ? 'Deine Antwort: „' : 'Verstanden: „', h('i', r.text), '“') : null;
        const retry = h('button.btn.ghost', { type: 'button' }, 'Nochmal versuchen');
        let again = false;
        retry.addEventListener('click', () => {
          again = true;
        });
        const title = r.gaveUp ? 'Musterantwort' : ok === true ? G(pick(['Perfetto!', 'Bravo!', 'Benissimo!', 'Ottimo!'])) : ok === 'hard' ? 'Teilweise drin' : 'Da fehlt noch etwas';
        const panelBody = [heard, r.gaveUp ? null : chips, modelBox];
        const verdictP = verdict(foot, { ok: r.gaveUp ? false : ok, title, body: panelBody, extra: ok === true || tries >= 3 ? null : retry });
        await Promise.race([verdictP, tapOnce(retry)]);
        if (again) continue;
        break;
      }
    }
    const pct = role.steps.length ? Math.round((full / role.steps.length) * 100) : 100;
    {
      const { body, foot } = frame(flow, 'role-end');
      body.append(
        role.end ? partnerBubble(role.end, role.endde) : null,
        h(
          'div.summary',
          h('div.summary-badge', '🎭'),
          h('h2.summary-title', G(pct >= 80 ? 'Bravissim{o|a}!' : 'Geschafft!')),
          h('p', `${full} von ${role.steps.length} Aufgaben ganz erfüllt.`),
          h('p.small.muted', 'Spiel es ruhig nochmal – beim zweiten Mal geht es schon flüssiger.'),
        ),
      );
      const prev = S().done.role[role.id];
      S().done.role[role.id] = { best: Math.max(pct, (prev && prev.best) || 0), at: Date.now(), n: ((prev && prev.n) || 0) + 1 };
      save();
      await next(foot, 'Fertig');
    }
    return { role: role.id, pct };
  };
}

export function startRole(role) {
  return runFlow({ steps: [roleStep(role)], bar: false, label: role.title });
}

/* ---------------- Nachsprechen ---------------- */

function shadowPool() {
  const L = levelRank(userLevel());
  const sentenceOf = (x) => (x.kind === 'p' ? x.alts[0] : x.ex);
  const ok = (x) => {
    const s = sentenceOf(x);
    const n = s ? s.split(/\s+/).length : 0;
    return n >= 3 && n <= 12 && levelRank(x.lvl) <= L;
  };
  const seen = items.filter((x) => S().cards[x.id] && ok(x));
  const pool = seen.length >= 10 ? seen : items.filter(ok);
  return pool.map((x) => ({ item: x, it: sentenceOf(x), de: x.kind === 'p' ? x.de : x.exde }));
}

export function shadowStep(entry) {
  return async (flow) => {
    const target = G(entry.it);
    let tries = 0;
    for (;;) {
      tries++;
      const { body, foot } = frame(flow, 'shadow');
      body.append(
        prompt('Hör zu und sprich nach'),
        h('div.shadow-card', h('p.shadow-it', target), entry.de ? h('p.small.muted', entry.de) : null),
        h('div.listen-box', playButton(target, { auto: tries === 1 }), slowButton(target)),
      );
      if (!micUsable()) {
        body.append(h('p.small.muted.center', 'Sprich den Satz laut nach – am besten zwei-, dreimal, bis er flüssig klingt.'));
        await next(foot, 'Nachgesprochen');
        return { shadow: true };
      }
      const mic = h('button.mic', { type: 'button', 'aria-label': 'Nachsprechen' }, ico('mic'));
      const live = h('p.live', ' ');
      const status = h('p.small.muted.center', 'Tippe auf das Mikrofon und sprich den Satz nach.');
      body.append(mic, live, status);
      const skip = h('button.btn.ghost', { type: 'button' }, 'Überspringen');
      foot.replaceChildren(skip);
      const result = await new Promise((resolve) => {
        skip.addEventListener('click', () => resolve(null));
        mic.addEventListener('click', async () => {
          unlock();
          stopSpeaking();
          mic.classList.add('on');
          status.textContent = 'Ich höre zu …';
          try {
            const r = await listen({ onPartial: (t) => (live.textContent = t) });
            mic.classList.remove('on');
            resolve(r);
          } catch (e) {
            mic.classList.remove('on');
            if (FATAL_STT.includes(e && e.code)) {
              S().profile.speechOk = false;
              save();
              resolve(null);
            } else status.textContent = 'Nichts verstanden – versuch es nochmal.';
          }
        });
      });
      if (!result) return { shadow: true, skipped: true };
      let best = null;
      for (const t of result.alts) {
        const a = alignWords(target, t);
        if (!best || a.score > best.score) best = a;
      }
      const pct = Math.round(best.score * 100);
      const ok = pct >= 90 ? true : pct >= 65 ? 'hard' : false;
      const retry = h('button.btn.ghost', { type: 'button' }, 'Nochmal');
      let again = false;
      retry.addEventListener('click', () => (again = true));
      await Promise.race([
        verdict(foot, {
          ok,
          title: ok === true ? `${G('Perfetto!')} ${pct} %` : `${pct} % verstanden`,
          body: [alignView(best), h('p.small.muted', ok === true ? 'Klingt sehr gut.' : 'Grau markierte Wörter hat das iPhone nicht erkannt – hör sie dir nochmal an.')],
          extra: tries < 3 ? retry : null,
        }),
        tapOnce(retry),
      ]);
      if (again) continue;
      return { shadow: true, score: best.score };
    }
  };
}

export function shadowSteps(n = 5) {
  return shuffle(shadowPool()).slice(0, n).map(shadowStep);
}

export function startShadowing(n = 8) {
  return runFlow({ steps: [...shadowSteps(n), summaryStep({ title: 'Gut gesprochen!' })] });
}
