const isCancelled = (order) => order?.status === "cancelada";
const isCompleted = (order) => order?.status === "concluida";
const scheduledDate = (order) => order?.data || "";
const completedDate = (order) => (order?.concluidaEm || order?.data || "").slice(0, 10);

export function agendaRoleScope(orders = [], { role, userId } = {}) {
  const visible = orders.filter((order) => !isCancelled(order));
  if (role !== "tecnico") return visible;
  if (!userId) return [];
  return visible.filter((order) => order?.responsavelId === userId);
}

export function filterOwnerAgenda(orders = [], {
  filter = "proximos",
  today,
  technicianId = "",
} = {}) {
  let visible = agendaRoleScope(orders, { role: "proprietario" });
  if (technicianId) visible = visible.filter((order) => order?.responsavelId === technicianId);

  if (filter === "hoje") return visible.filter((order) => scheduledDate(order) === today);
  if (filter === "semdata") return visible.filter((order) => !scheduledDate(order) && !isCompleted(order));
  if (filter === "concluidos") return visible.filter(isCompleted);
  return visible.filter((order) => !isCompleted(order) && Boolean(scheduledDate(order)) && scheduledDate(order) >= today);
}

export function agendaOrderDate(order, filter = "proximos") {
  if (filter === "concluidos") return completedDate(order);
  return scheduledDate(order);
}

export function sortAgendaOrders(orders = [], filter = "proximos") {
  return [...orders].sort((a, b) => {
    const ad = agendaOrderDate(a, filter) || "9999-12-31";
    const bd = agendaOrderDate(b, filter) || "9999-12-31";
    if (ad !== bd) return ad.localeCompare(bd);
    return (a?.hora || "99:99").localeCompare(b?.hora || "99:99") || String(a?.numero || "").localeCompare(String(b?.numero || ""));
  });
}

export function groupAgendaOrders(orders = [], filter = "proximos") {
  const groups = [];
  for (const order of sortAgendaOrders(orders, filter)) {
    const date = agendaOrderDate(order, filter) || "sem-data";
    let group = groups.at(-1);
    if (!group || group.date !== date) {
      group = { date, orders: [] };
      groups.push(group);
    }
    group.orders.push(order);
  }
  return groups;
}

export function technicianDayAgenda(orders = [], { userId, day, today } = {}) {
  const scoped = agendaRoleScope(orders, { role: "tecnico", userId });
  const overdue = day === today
    ? scoped.filter((order) => !isCompleted(order) && Boolean(scheduledDate(order)) && scheduledDate(order) < today)
    : [];
  const scheduled = scoped.filter((order) => scheduledDate(order) === day);
  return {
    overdue: sortAgendaOrders(overdue, "proximos"),
    scheduled: [...scheduled].sort((a, b) => (a?.hora || "99:99").localeCompare(b?.hora || "99:99") || String(a?.numero || "").localeCompare(String(b?.numero || ""))),
  };
}
