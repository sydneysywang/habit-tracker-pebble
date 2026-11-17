// DOM rendering. It takes the state plus some short-lived UI flags and redraws
// the pocket, the 7-day grid and the labels around the jar. All user text is
// set with textContent; the only innerHTML is static icon markup.

import { WEIGHTS, WEIGHT_KEYS, NAME_MAX, POCKET_BUDGET, pocketLoad, isDone } from './habits.js';
import { lastNDays, keyToDate, longDayLabel } from './dates.js';
import { chipRadius } from './stones.js';

const ICON_EDIT =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m13.5 6.5 4 4" stroke="currentColor" stroke-width="1.8"/></svg>';
const ICON_X =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

export const PLACEHOLDERS = [
  'Drink a glass of water',
  'Stretch for one minute',
  'Read two pages',
  'Step outside for fresh air',
  'Text a friend',
  'Tidy one small thing',
  'Write one line in a journal',
  'Eat something green',
];

function h(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value; // static icon strings only
    else if (key === 'style') node.style.cssText = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid);
  return node;
}

function chip(habit, extra = '') {
  return h('span', {
    class: `chip chip--${habit.weight} ${extra}`.trim(),
    style: `border-radius:${chipRadius(habit.seed)}`,
    'aria-hidden': 'true',
  });
}

// ------------------------------------------------------------------ pocket

function normalRow(habit, done, editMode) {
  const { id, name } = habit;
  return h(
    'li',
    { class: `habit-row${done ? ' is-done' : ''}`, dataset: { id } },
    h(
      'label',
      { class: 'tick' },
      h('input', {
        type: 'checkbox',
        class: 'tick-input',
        checked: done,
        dataset: { action: 'toggle', id, focus: `toggle:${id}` },
      }),
      h('span', { class: 'tick-box', 'aria-hidden': 'true' }),
      h('span', { class: 'sr-only', text: `${name}, done today` }),
    ),
    chip(habit),
    h(
      'span',
      { class: 'habit-text' },
      h('span', { class: 'habit-name', text: name }),
      h('span', { class: 'habit-weight', text: WEIGHTS[habit.weight].label }),
    ),
    editMode && h('button', {
      type: 'button',
      class: 'icon-btn',
      'aria-label': `Edit ${name}`,
      title: 'Edit',
      dataset: { action: 'edit', id, focus: `edit:${id}` },
      html: ICON_EDIT,
    }),
    editMode && h('button', {
      type: 'button',
      class: 'icon-btn icon-btn--danger',
      'aria-label': `Remove ${name}`,
      title: 'Remove',
      dataset: { action: 'delete', id, focus: `delete:${id}` },
      html: ICON_X,
    }),
  );
}

function editRow(habit, error) {
  const { id } = habit;
  return h(
    'li',
    { class: 'habit-row is-editing', dataset: { id } },
    h(
      'form',
      { class: 'edit-form', dataset: { id }, autocomplete: 'off' },
      h('label', { class: 'sr-only', for: `edit-${id}`, text: 'Habit name' }),
      h('input', {
        id: `edit-${id}`,
        name: 'name',
        type: 'text',
        class: 'text-input',
        maxlength: String(NAME_MAX),
        value: habit.name,
        enterkeyhint: 'done',
        dataset: { focus: `editname:${id}` },
      }),
      h('label', { class: 'sr-only', for: `edit-weight-${id}`, text: 'Stone weight' }),
      h(
        'select',
        { id: `edit-weight-${id}`, name: 'weight', class: 'select-input' },
        WEIGHT_KEYS.map((k) => h('option', { value: k, selected: k === habit.weight, text: WEIGHTS[k].label })),
      ),
      h(
        'div',
        { class: 'edit-actions' },
        h('button', { type: 'submit', class: 'btn btn-primary btn-small', text: 'Save' }),
        h('button', {
          type: 'button',
          class: 'btn btn-ghost btn-small',
          dataset: { action: 'cancel-edit', id },
          text: 'Cancel',
        }),
      ),
      error ? h('p', { class: 'soft-msg edit-msg', role: 'status', text: error }) : null,
    ),
  );
}

function confirmRow(habit) {
  const { id } = habit;
  return h(
    'li',
    { class: 'habit-row is-confirming', dataset: { id } },
    h(
      'p',
      { class: 'confirm-text' },
      'Let go of ',
      h('strong', { text: `“${habit.name}”` }),
      '? ',
      h('span', { class: 'muted', text: 'Its little history goes with it.' }),
    ),
    h(
      'div',
      { class: 'confirm-actions' },
      h('button', {
        type: 'button',
        class: 'btn btn-danger btn-small',
        dataset: { action: 'confirm-delete', id, focus: `confirm-yes:${id}` },
        text: 'Let go',
      }),
      h('button', {
        type: 'button',
        class: 'btn btn-ghost btn-small',
        dataset: { action: 'cancel-delete', id, focus: `confirm-no:${id}` },
        text: 'Keep',
      }),
    ),
  );
}

function row(habit, done, ui) {
  if (ui.editingId === habit.id) return editRow(habit, ui.editError);
  if (ui.confirmingId === habit.id) return confirmRow(habit);
  return normalRow(habit, done, ui.editMode);
}

/** Unticked stones out of all habits, e.g. "3/5". */
function renderMeter(meter, state, pendingCount) {
  const total = state.habits.length;
  meter.replaceChildren(
    h('span', { class: 'meter-num', 'aria-hidden': 'true', text: `${pendingCount}/${total}` }),
  );
  meter.setAttribute('role', 'img');
  meter.setAttribute('aria-label', `${pendingCount} of ${total} stones still in your pocket`);
}

function renderPocketState(box, state, pendingCount) {
  if (!state.habits.length) {
    box.hidden = false;
    box.className = 'pocket-state is-new';
    box.replaceChildren(
      h('p', { class: 'state-title', text: 'Your pocket is light as air.' }),
      h('p', {
        class: 'muted',
        text: 'Pick up a first stone, something small like “stretch for one minute”, and watch it land in the jar.',
      }),
    );
  } else if (pendingCount === 0) {
    box.hidden = false;
    box.className = 'pocket-state is-complete';
    box.replaceChildren(
      h('span', { class: 'state-art', 'aria-hidden': 'true' }),
      h(
        'div',
        {},
        h('p', { class: 'state-title', text: 'Your pocket is empty.' }),
        h('p', { class: 'muted', text: 'Nothing left to carry today. Everything you did is resting in the jar.' }),
      ),
    );
  } else {
    box.hidden = true;
    box.className = 'pocket-state';
    box.replaceChildren();
  }
}

// ------------------------------------------------------------------ week

function renderWeek(wrap, state, today) {
  if (!state.habits.length) {
    wrap.replaceChildren(h('p', { class: 'week-empty muted', text: 'Your week will fill in here, one stone at a time.' }));
    return;
  }
  const days = lastNDays(7, keyToDate(today));

  const head = h(
    'tr',
    {},
    h('th', { scope: 'col', class: 'wk-corner' }, h('span', { class: 'sr-only', text: 'Habit' })),
    days.map(({ key, date }) =>
      h(
        'th',
        { scope: 'col', class: key === today ? 'is-today' : null },
        h('span', { class: 'wk-dow', 'aria-hidden': 'true', text: date.toLocaleDateString(undefined, { weekday: 'narrow' }) }),
        h('span', { class: 'wk-num', 'aria-hidden': 'true', text: String(date.getDate()) }),
        h('span', { class: 'sr-only', text: key === today ? `Today, ${longDayLabel(date)}` : longDayLabel(date) }),
      ),
    ),
  );

  const rows = state.habits.map((habit) =>
    h(
      'tr',
      {},
      h(
        'th',
        { scope: 'row', class: 'wk-name' },
        h('span', { class: 'wk-name-inner' }, chip(habit, 'chip--sm'), h('span', { class: 'wk-name-text', title: habit.name, text: habit.name })),
      ),
      days.map(({ key }) => {
        const done = isDone(state, habit.id, key);
        const dot = h('span', {
          class: `dot${done ? ` is-done dot--${habit.weight}` : ''}`,
          style: done ? `border-radius:${chipRadius(habit.seed)}` : null,
          'aria-hidden': 'true',
        });
        if (key === today) {
          return h(
            'td',
            { class: 'is-today' },
            h(
              'button',
              {
                type: 'button',
                class: 'cell-btn',
                'aria-pressed': done ? 'true' : 'false',
                'aria-label': `${habit.name}, today`,
                title: done ? 'Take it back out' : 'Drop it in the jar',
                dataset: { action: 'toggle-today', id: habit.id, focus: `week:${habit.id}` },
              },
              dot,
            ),
          );
        }
        return h('td', {}, dot, h('span', { class: 'sr-only', text: done ? 'collected' : 'not collected' }));
      }),
    ),
  );

  wrap.replaceChildren(
    h(
      'table',
      { class: 'week-grid' },
      h('caption', { class: 'sr-only', text: 'Stones collected over the last 7 days' }),
      h('colgroup', {}, h('col', { class: 'wk-name-col' }), days.map(() => h('col', { class: 'wk-day-col' }))),
      h('thead', {}, head),
      h('tbody', {}, rows),
    ),
  );
}

// ------------------------------------------------------------------ main

export function renderApp(refs, state, today, ui) {
  const activeKey = document.activeElement?.dataset?.focus;

  const pending = state.habits.filter((x) => !isDone(state, x.id, today));
  const done = state.habits.filter((x) => isDone(state, x.id, today));

  refs.pocketList.replaceChildren(...pending.map((x) => row(x, false, ui)));
  refs.pocketList.hidden = pending.length === 0;
  refs.doneList.replaceChildren(...done.map((x) => row(x, true, ui)));
  refs.doneWrap.hidden = done.length === 0;
  renderPocketState(refs.pocketState, state, pending.length);
  renderMeter(refs.pocketMeter, state, pending.length);
  refs.budgetLoad.textContent = pocketLoad(state.habits);
  for (const el of refs.budgetMax) el.textContent = POCKET_BUDGET;
  renderWeek(refs.weekWrap, state, today);

  // Edit mode: the pencil in the pocket header reveals edit/remove on each row.
  if (!state.habits.length) ui.editMode = false;
  refs.editModeBtn.hidden = !state.habits.length;
  refs.editModeBtn.setAttribute('aria-pressed', String(ui.editMode));
  refs.editModeBtn.classList.toggle('is-on', ui.editMode);
  refs.editModeBtn.title = ui.editMode ? 'Done editing' : 'Edit habits';
  refs.editModeBtn.querySelector('.sr-only').textContent = ui.editMode ? 'Done editing habits' : 'Edit habits';
  refs.pocketCard.classList.toggle('is-edit-mode', ui.editMode);

  // Labels around the jar
  refs.todayLabel.textContent = longDayLabel(keyToDate(today));
  refs.jarEmpty.hidden = state.habits.length > 0;
  refs.jarHint.textContent = !state.habits.length
    ? ''
    : done.length
      ? 'Drag the stones around. They like it.'
      : 'Tick a habit and its stone drops in here.';
  refs.jarCanvas.setAttribute(
    'aria-label',
    done.length
      ? `A glass jar holding ${done.length} ${done.length === 1 ? 'stone' : 'stones'}: ${done.map((x) => x.name).join(', ')}`
      : 'An empty glass jar',
  );

  // Put focus back where it was, so re-rendering doesn't lose the keyboard user's place.
  const want = ui.pendingFocus ?? activeKey;
  ui.pendingFocus = null;
  if (want) {
    const target = want === 'add' ? refs.input : document.querySelector(`[data-focus="${CSS.escape(want)}"]`);
    if (target && target !== document.activeElement) {
      target.focus({ preventScroll: true });
      if (want.startsWith('editname:')) target.select();
    }
  }
}
