/** Kleine UI-Bausteine: Escaping, Sheets (Bottom-Dialoge), Toasts. */

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function html(strings, ...values) {
  return strings.reduce((out, s, i) => out + s + (i < values.length ? values[i] : ''), '');
}

export function toast(message) {
  const host = document.getElementById('toast-host');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 260);
  }, 2200);
}

let openSheet = null;

/**
 * Zeigt ein Bottom-Sheet.
 * @param {{title:string, body:string, onMount?:(root:HTMLElement, close:Function)=>void}} opts
 */
export function sheet({ title, body, onMount }) {
  closeSheet();
  const host = document.getElementById('sheet-host');
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = html`
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-head">
        <h2>${esc(title)}</h2>
        <button class="icon-btn" data-close type="button" aria-label="Schließen">✕</button>
      </div>
      <div class="sheet-body">${body}</div>
    </div>
  `;
  host.appendChild(backdrop);
  openSheet = backdrop;

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.closest('[data-close]')) closeSheet();
  });
  if (onMount) onMount(backdrop, closeSheet);
  return backdrop;
}

export function closeSheet() {
  if (openSheet) openSheet.remove();
  openSheet = null;
}

/** Bestätigungsdialog mit eigener Beschriftung. */
export function confirmSheet({ title, text, confirmLabel = 'Ja', danger = false, onConfirm }) {
  sheet({
    title,
    body: html`
      <p class="muted" style="margin-top:0">${esc(text)}</p>
      <button class="btn ${danger ? 'danger' : 'primary'}" data-yes type="button">${esc(confirmLabel)}</button>
      <button class="btn quiet" data-close type="button">Abbrechen</button>
    `,
    onMount(root, close) {
      root.querySelector('[data-yes]').addEventListener('click', () => {
        close();
        onConfirm();
      });
    },
  });
}

/** Einzelnes Textfeld abfragen. */
export function promptSheet({ title, label, value = '', placeholder = '', confirmLabel = 'Speichern', hint = '', onSubmit }) {
  sheet({
    title,
    body: html`
      <div class="field">
        <label for="prompt-input">${esc(label)}</label>
        <input id="prompt-input" type="text" value="${esc(value)}" placeholder="${esc(placeholder)}"
               autocomplete="off" autocapitalize="sentences" enterkeyhint="done">
        ${hint ? `<div class="hint">${esc(hint)}</div>` : ''}
      </div>
      <button class="btn primary" data-ok type="button">${esc(confirmLabel)}</button>
    `,
    onMount(root, close) {
      const input = root.querySelector('#prompt-input');
      const submit = () => {
        const v = input.value.trim();
        if (!v) {
          input.focus();
          return;
        }
        close();
        onSubmit(v);
      };
      root.querySelector('[data-ok]').addEventListener('click', submit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
      });
      setTimeout(() => input.focus(), 60);
    },
  });
}

/** Liste zum Auswählen, mit Suchfeld und optionaler "Neu anlegen"-Zeile. */
export function pickerSheet({ title, items, emptyText = 'Nichts gefunden.', onPick, onCreate, createLabel = 'Neu anlegen' }) {
  const render = (root, term) => {
    const list = root.querySelector('[data-list]');
    const t = term.trim().toLowerCase();
    const hits = t ? items.filter((i) => i.label.toLowerCase().includes(t)) : items;
    list.innerHTML =
      hits
        .map(
          (i) => html`
            <button class="row" data-pick="${esc(i.id)}" type="button">
              <div class="row-main">
                <div class="row-title">${esc(i.label)}</div>
                ${i.sub ? `<div class="row-sub">${esc(i.sub)}</div>` : ''}
              </div>
              ${i.badge ? `<span class="row-badge">${esc(i.badge)}</span>` : ''}
            </button>
          `
        )
        .join('') || `<div class="empty tiny">${esc(emptyText)}</div>`;
  };

  sheet({
    title,
    body: html`
      <div class="field">
        <input id="picker-search" type="text" placeholder="Suchen…" autocomplete="off" autocapitalize="none" enterkeyhint="search">
      </div>
      <div class="list" data-list></div>
      ${onCreate ? `<button class="btn quiet" data-create type="button">＋ ${esc(createLabel)}</button>` : ''}
    `,
    onMount(root, close) {
      const search = root.querySelector('#picker-search');
      render(root, '');
      search.addEventListener('input', () => render(root, search.value));
      root.querySelector('[data-list]').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-pick]');
        if (!btn) return;
        close();
        onPick(btn.dataset.pick);
      });
      const createBtn = root.querySelector('[data-create]');
      if (createBtn) {
        createBtn.addEventListener('click', () => {
          close();
          onCreate(search.value.trim());
        });
      }
    },
  });
}

/** Aktionsliste (Kontextmenü). */
export function actionSheet({ title, actions }) {
  sheet({
    title,
    body: html`
      <div class="list">
        ${actions
          .map(
            (a, i) => html`
              <button class="row" data-action="${i}" type="button">
                <div class="row-main">
                  <div class="row-title" ${a.danger ? 'style="color:var(--bad)"' : ''}>${esc(a.label)}</div>
                  ${a.sub ? `<div class="row-sub">${esc(a.sub)}</div>` : ''}
                </div>
              </button>
            `
          )
          .join('')}
      </div>
      <button class="btn quiet" data-close type="button">Abbrechen</button>
    `,
    onMount(root, close) {
      root.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        close();
        actions[Number(btn.dataset.action)].run();
      });
    },
  });
}
