(function () {
  "use strict";

  function netAmount(bill) {
    return Math.max(0, bill.amount - (bill.refund || 0));
  }

  function splitEvenly(total, ids) {
    const people = [...new Set(ids)].filter(Boolean);
    if (!people.length) return {};
    const base = Math.floor(total / people.length);
    let remainder = total - base * people.length;
    return Object.fromEntries(people.map((id) => {
      const value = base + (remainder > 0 ? 1 : 0);
      remainder = Math.max(0, remainder - 1);
      return [id, value];
    }));
  }

  function companionIds(participants) {
    return participants.filter((person) => !person.isSelf).map((person) => person.id);
  }

  function legacyAllocations(bill, participants) {
    const net = netAmount(bill);
    const friendId = participants.find((person) => person.id === "xiaoyang")?.id || companionIds(participants)[0];
    if (bill.allocation === "self") return { me: net };
    if (bill.allocation === "aa") return splitEvenly(net, ["me", friendId]);
    if (bill.allocation === "friend") return friendId ? { [friendId]: net } : {};
    if (bill.allocation === "custom" && bill.custom) return { me: bill.custom.me || 0, [friendId]: bill.custom.friend || 0 };
    return {};
  }

  function allocationMap(bill, participants = []) {
    if (bill.status === "excluded" || bill.allocation === "unset") return {};
    if (bill.allocations && typeof bill.allocations === "object") {
      return Object.fromEntries(Object.entries(bill.allocations).map(([id, value]) => [id, Number(value) || 0]).filter(([, value]) => value >= 0));
    }
    return legacyAllocations(bill, participants);
  }

  function buildAllocations(total, mode, participants, options = {}) {
    const allIds = participants.map((person) => person.id);
    if (mode === "self") return { me: total };
    if (mode === "all-aa") return splitEvenly(total, allIds);
    if (mode === "selected-aa") return splitEvenly(total, options.selectedIds || []);
    if (mode === "person") return options.personId ? { [options.personId]: total } : {};
    if (mode === "custom") return { ...(options.allocations || {}) };
    return {};
  }

  function personShare(bill, personId, participants) {
    return allocationMap(bill, participants)[personId] || 0;
  }

  function otherShare(bill, participants) {
    const allocations = allocationMap(bill, participants);
    return Object.entries(allocations).reduce((sum, [id, value]) => sum + (id === "me" ? 0 : value), 0);
  }

  function summary(state) {
    const participants = state.trip.participants || [];
    const included = state.bills.filter((bill) => bill.status !== "excluded");
    const perPerson = Object.fromEntries(participants.map((person) => [person.id, 0]));
    const totals = included.reduce((result, bill) => {
      const allocations = allocationMap(bill, participants);
      result.net += netAmount(bill);
      Object.entries(allocations).forEach(([id, value]) => { perPerson[id] = (perPerson[id] || 0) + value; });
      if (bill.allocation === "unset" || bill.status === "pending" || bill.status === "duplicate") result.pending += 1;
      return result;
    }, { net: 0, pending: 0 });
    totals.own = perPerson.me || 0;
    totals.other = Object.entries(perPerson).reduce((sum, [id, value]) => sum + (id === "me" ? 0 : value), 0);
    totals.perPerson = perPerson;
    totals.perPersonRepaid = Object.fromEntries(participants.map((person) => [person.id, 0]));
    state.repayments.forEach((item) => {
      if (item.personId) totals.perPersonRepaid[item.personId] = (totals.perPersonRepaid[item.personId] || 0) + item.amount;
    });
    totals.perPersonReceivable = Object.fromEntries(participants.map((person) => [person.id, (perPerson[person.id] || 0) - (totals.perPersonRepaid[person.id] || 0)]));
    totals.repaid = Object.values(totals.perPersonRepaid).reduce((sum, value) => sum + value, 0);
    totals.receivable = totals.other - totals.repaid;
    totals.includedCount = included.length;
    return totals;
  }

  function categoryTotals(bills) {
    return bills.filter((bill) => bill.status !== "excluded").reduce((groups, bill) => {
      groups[bill.category] = (groups[bill.category] || 0) + netAmount(bill);
      return groups;
    }, {});
  }

  function dailyTotals(bills) {
    return bills.filter((bill) => bill.status !== "excluded").reduce((groups, bill) => {
      const date = bill.date.slice(5, 10).replace("-", "/");
      groups[date] = (groups[date] || 0) + netAmount(bill);
      return groups;
    }, {});
  }

  function formatMoney(cents) {
    const sign = cents < 0 ? "-" : "";
    return `${sign}¥${(Math.abs(cents) / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  }

  window.TravelBillCalc = { netAmount, splitEvenly, companionIds, allocationMap, buildAllocations, personShare, otherShare, summary, categoryTotals, dailyTotals, formatMoney, escapeHtml };
}());
