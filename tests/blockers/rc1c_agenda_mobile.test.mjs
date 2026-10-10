import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { filterOwnerAgenda, groupAgendaOrders, technicianDayAgenda } from '../../src/lib/agendaMobile.js';

const TODAY = '2026-09-14';
const orders = [
  { id: 'today-open', numero: 'OS-1', status: 'agendada', data: TODAY, hora: '10:00', responsavelId: 'tech-1' },
  { id: 'today-done', numero: 'OS-2', status: 'concluida', data: TODAY, concluidaEm: TODAY, hora: '09:00', responsavelId: 'tech-1' },
  { id: 'tomorrow', numero: 'OS-3', status: 'agendada', data: '2026-09-15', hora: '08:00', responsavelId: 'tech-1' },
  { id: 'later', numero: 'OS-4', status: 'agendada', data: '2026-09-16', hora: '14:00', responsavelId: 'tech-2' },
  { id: 'undated', numero: 'OS-5', status: 'aguardando', data: '', hora: '', responsavelId: 'tech-1' },
  { id: 'overdue', numero: 'OS-6', status: 'agendada', data: '2026-09-13', hora: '16:00', responsavelId: 'tech-1' },
  { id: 'other-tech', numero: 'OS-7', status: 'agendada', data: TODAY, hora: '07:00', responsavelId: 'tech-2' },
  { id: 'cancelled', numero: 'OS-8', status: 'cancelada', data: TODAY, hora: '11:00', responsavelId: 'tech-1' },
];
const ids = (items) => items.map((item) => item.id);

test('owner Hoje, Sem data and Concluídos filters are explicit', () => {
  assert.deepEqual(ids(filterOwnerAgenda(orders, { filter: 'hoje', today: TODAY })), ['today-open', 'today-done', 'other-tech']);
  assert.deepEqual(ids(filterOwnerAgenda(orders, { filter: 'semdata', today: TODAY })), ['undated']);
  assert.deepEqual(ids(filterOwnerAgenda(orders, { filter: 'concluidos', today: TODAY })), ['today-done']);
});

test('owner Próximos returns every future authorized service, not only one selected day', () => {
  assert.deepEqual(ids(filterOwnerAgenda(orders, { filter: 'proximos', today: TODAY })), ['today-open', 'tomorrow', 'later', 'other-tech']);
  const groups = groupAgendaOrders(filterOwnerAgenda(orders, { filter: 'proximos', today: TODAY }), 'proximos');
  assert.deepEqual(groups.map((group) => group.date), [TODAY, '2026-09-15', '2026-09-16']);
  assert.deepEqual(ids(groups[0].orders), ['other-tech', 'today-open']);
});

test('owner technician filter narrows only the authorized owner projection', () => {
  assert.deepEqual(ids(filterOwnerAgenda(orders, { filter: 'proximos', today: TODAY, technicianId: 'tech-1' })), ['today-open', 'tomorrow']);
});

test('technician Meu dia keeps assigned-only scope and overdue first', () => {
  const result = technicianDayAgenda(orders, { userId: 'tech-1', day: TODAY, today: TODAY });
  assert.deepEqual(ids(result.overdue), ['overdue']);
  assert.deepEqual(ids(result.scheduled), ['today-done', 'today-open']);
  assert.equal([...result.overdue, ...result.scheduled].some((order) => order.responsavelId !== 'tech-1'), false);
});

test('technician can change day without seeing another technician work', () => {
  const result = technicianDayAgenda(orders, { userId: 'tech-1', day: '2026-09-16', today: TODAY });
  assert.deepEqual(result.overdue, []);
  assert.deepEqual(result.scheduled, []);
});

test('UI exposes owner Lista/Semana/Mês and technician Meu dia without granting owner actions', () => {
  const source = fs.readFileSync(new URL('../../src/legacy/ZiisTecApp.jsx', import.meta.url), 'utf8');
  assert.match(source, /\[\["lista", "Lista"\], \["semana", "Semana"\], \["mes", "Mês"\]\]/);
  assert.match(source, /\[\["hoje", "Hoje"\], \["proximos", "Próximos"\], \["semdata", "Sem data"\], \["concluidos", "Concluídos"\]\]/);
  assert.match(source, /PageHead title=\{tecnico \? "Meu dia" : "Agenda"\}/);
  assert.match(source, /action=\{!tecnico && <Btn icon=\{Plus\}/);
  assert.match(source, /tecnico: \["inicio", "agenda", "ordens", "registrarMateriais", "vendaCampo"\]/);
});

test('frontend defense and database RLS preserve assigned-only and cross-tenant boundaries', () => {
  const source = fs.readFileSync(new URL('../../src/legacy/ZiisTecApp.jsx', import.meta.url), 'utf8');
  const rls = fs.readFileSync(new URL('../../supabase/0028_optimize_rls_auth_initplans.sql', import.meta.url), 'utf8');
  assert.match(source, /const ordensEmp = doTenant\(ordens\)\.filter\(\(o\) => permitido\("todasOS"\) \|\| o\.responsavelId === usuarioAtual\?\.id\)/);
  assert.match(rls, /alter policy p_wo_select on public\.work_orders/);
  assert.match(rls, /public\.zt_is_owner\(company_id\) or \(public\.zt_is_member\(company_id\) and assigned_to=\(select auth\.uid\(\)\)\)/);
});
