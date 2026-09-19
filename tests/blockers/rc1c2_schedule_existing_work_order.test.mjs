import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

const source = fs.readFileSync(new URL('../../src/legacy/ZiisTecApp.jsx', import.meta.url), 'utf8');
const modalStart = source.indexOf('function AgendarModal(');
const modalSource = source.slice(modalStart, source.indexOf('\n/*', modalStart));
const modalCode = transformSync(`${modalSource}\nAgendarModal;`, { loader: 'jsx' }).code;
const scheduleStart = source.indexOf('  const agendarOS = async');
const scheduleSource = source.slice(scheduleStart, source.indexOf('  const desagendarOS', scheduleStart));
const copy = (value) => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

// Execute the actual JSX component and its handlers with a small hook host.
// No copy of the submission logic and no database/browser connection is used.
function mountModal(onSalvar, os = { id: 'os-4', numero: 'OS-0004', data: '', hora: '' }) {
  const slots = [];
  let cursor = 0;
  let dirty = false;
  let effects = [];
  let closes = 0;
  const props = { os, onSalvar, onClose: () => { closes += 1; },
    empresa: { responsavel: 'Owner', temEquipe: true }, diaSugerido: '2026-09-20' };
  const component = vm.runInNewContext(modalCode, {
    React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: 'Fragment' },
    Modal: 'Modal', Btn: 'Btn', Field: 'Field', Input: 'Input', Select: 'Select', HOJE: '2026-09-19',
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; dirty = true; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index][i]))) {
        slots[index] = deps;
        effects.push(effect);
      }
    },
  });
  function render() {
    let tree;
    do {
      dirty = false;
      cursor = 0;
      effects = [];
      tree = component(props);
      effects.forEach((effect) => effect());
    } while (dirty);
    return tree;
  }
  return { render, get closes() { return closes; } };
}

function nodes(tree, type) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap((child) => nodes(child, type));
  return [ ...(tree.type === type ? [tree] : []), ...nodes(tree.props?.children, type), ...nodes(tree.props?.footer, type) ];
}
const submit = (tree) => nodes(tree, 'Btn').at(-1);
const input = (tree, type) => nodes(tree, 'Input').find((node) => node.props.type === type);

test('schedule submit waits for persistence, blocks duplicate clicks and closes only on success', async () => {
  const pending = deferred();
  const calls = [];
  const modal = mountModal((...args) => { calls.push(copy(args)); return pending.promise; });
  const initial = modal.render();
  const first = submit(initial).props.onClick();
  await submit(initial).props.onClick(); // Same-render second click must also be blocked.
  const saving = modal.render();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'os-4');
  assert.equal(modal.closes, 0);
  assert.equal(submit(saving).props.disabled, true);
  assert.deepEqual(copy(submit(saving).props.children), ['Agendando...']);
  assert.equal(input(saving, 'date').props.disabled, true);
  assert.equal(input(saving, 'time').props.disabled, true);
  assert.equal(nodes(saving, 'Select')[0].props.disabled, true);
  saving.props.onClose();
  nodes(saving, 'Btn')[0].props.onClick();
  assert.equal(modal.closes, 0);
  pending.resolve(true);
  await first;
  assert.equal(modal.closes, 1);
  assert.equal(submit(modal.render()).props.disabled, false);
});

test('failed scheduling keeps edited date/time and allows retry of the same OS', async () => {
  const pending = deferred();
  const calls = [];
  const modal = mountModal((...args) => { calls.push(copy(args)); return calls.length === 1 ? pending.promise : Promise.resolve(true); });
  input(modal.render(), 'date').props.onChange({ target: { value: '2026-10-02' } });
  input(modal.render(), 'time').props.onChange({ target: { value: '14:30' } });
  const first = submit(modal.render()).props.onClick();
  pending.resolve(false);
  await first;
  const failed = modal.render();
  assert.equal(modal.closes, 0);
  assert.equal(input(failed, 'date').props.value, '2026-10-02');
  assert.equal(input(failed, 'time').props.value, '14:30');
  assert.equal(submit(failed).props.disabled, false);
  assert.deepEqual(copy(submit(failed).props.children), ['Confirmar agendamento']);
  await submit(failed).props.onClick();
  assert.equal(modal.closes, 1);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], calls[0]);
});

test('an already scheduled OS retains its identity when resubmitted', async () => {
  const calls = [];
  const modal = mountModal(async (...args) => { calls.push(copy(args)); return true; },
    { id: 'os-4', numero: 'OS-0004', data: '2026-09-21', hora: '10:00', status: 'agendada' });
  assert.equal(input(modal.render(), 'date').props.value, '2026-09-21');
  input(modal.render(), 'date').props.onChange({ target: { value: '2026-09-22' } });
  await submit(modal.render()).props.onClick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'os-4');
  assert.equal(calls[0][1].data, '2026-09-22');
  assert.equal(modal.closes, 1);
});

test('empty date disables confirmation and never saves or closes', async () => {
  const modal = mountModal(() => assert.fail('must not save'));
  input(modal.render(), 'date').props.onChange({ target: { value: '' } });
  const tree = modal.render();
  assert.equal(submit(tree).props.disabled, true);
  await submit(tree).props.onClick();
  assert.equal(modal.closes, 0);
});

function scheduling({ status = 'aguardando', real = true, update } = {}) {
  const original = { id: 'os-4', status, data: '', hora: '', historico: [], itens: [{ id: 'item-1' }] };
  const other = { id: 'os-5', status: 'aguardando' };
  let orders = [original, other];
  const calls = [];
  const notices = [];
  const forbiddenCalls = [];
  const forbidden = (name) => () => { forbiddenCalls.push(name); throw new Error(`Forbidden: ${name}`); };
  const schedule = vm.runInNewContext(`${scheduleSource}\nagendarOS;`, {
    real, HOJE: '2026-09-19', uid: () => 'history-1', dataBR: (date) => date,
    mensagemErro: (error) => error.message, aviso: (text) => notices.push(text),
    setOrdens: (apply) => { orders = apply(orders); },
    atualizarOSDB: async (id, patch) => {
      calls.push({ id, patch: copy(patch) });
      return update ? update(id, patch) : { ...original, data: patch.scheduled_date, hora: patch.scheduled_time, status: 'agendada' };
    },
    salvarOSDB: forbidden('create'), criarOSDeOrcamentoDB: forbidden('quote conversion'),
    carregarDadosEmpresa: forbidden('tenant load'), recarregarDados: forbidden('tenant reload'), recarregarSeguro: forbidden('tenant reload'),
  });
  return { schedule, calls, notices, forbiddenCalls, original, other, get orders() { return orders; } };
}
const form = { data: '2026-10-02', hora: '14:30', responsavel: 'Owner', responsavelId: 'owner-1' };

for (const status of ['aguardando', 'agendada']) {
  test(`agendarOS returns true and updates only the existing ${status} OS without creating or reloading`, async () => {
    const state = scheduling({ status });
    assert.equal(await state.schedule('os-4', form), true);
    assert.deepEqual(state.calls, [{ id: 'os-4', patch: { scheduled_date: form.data, scheduled_time: form.hora, assigned_to: 'owner-1', status: 'scheduled' } }]);
    assert.equal(state.orders.length, 2);
    assert.equal(state.orders[0].id, 'os-4');
    assert.equal(state.orders[0].status, 'agendada');
    assert.equal(state.orders[0].data, form.data);
    assert.equal(state.orders[1], state.other);
    assert.deepEqual(state.forbiddenCalls, []);
    assert.equal(state.notices.length, 1);
  });
}

test('agendarOS awaits update and returns false on backend failure without changing orders or showing success', async () => {
  const pending = deferred();
  const state = scheduling({ update: () => pending.promise });
  let settled = false;
  const result = state.schedule('os-4', form).then((value) => { settled = true; return value; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(state.orders[0], state.original);
  assert.equal(state.notices.length, 0);
  pending.reject(new Error('Agendamento negado pelo backend'));
  assert.equal(await result, false);
  assert.equal(state.orders[0], state.original);
  assert.deepEqual(state.notices, ['Agendamento negado pelo backend']);
  assert.deepEqual(state.forbiddenCalls, []);
});

test('agendarOS returns false for missing date without any write', async () => {
  const state = scheduling();
  assert.equal(await state.schedule('os-4', { ...form, data: '' }), false);
  assert.equal(state.calls.length, 0);
  assert.equal(state.notices.length, 0);
});

test('local scheduling also returns explicit success and preserves the existing OS', async () => {
  const state = scheduling({ real: false });
  assert.equal(await state.schedule('os-4', form), true);
  assert.equal(state.calls.length, 0);
  assert.equal(state.orders.length, 2);
  assert.equal(state.orders[0].id, 'os-4');
  assert.equal(state.orders[0].status, 'agendada');
  assert.equal(state.orders[1], state.other);
});
