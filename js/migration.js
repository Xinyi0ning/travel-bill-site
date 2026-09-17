(function () {
  "use strict";

  const Data = window.TravelBillData;
  const Calc = window.TravelBillCalc;
  const Parser = window.TravelBillParser;
  const clone = (value) => JSON.parse(JSON.stringify(value));

  function primaryCompanionId(participants) {
    return participants.find((person) => person.id === "xiaoyang")?.id
      || participants.find((person) => !person.isSelf)?.id
      || "xiaoyang";
  }

  function v2Participants(trip) {
    return [
      { id: "me", name: "我", isSelf: true },
      { id: "xiaoyang", name: String(trip.companion || "小羊").trim() || "小羊", isSelf: false },
      { id: "chenjie", name: "陈姐", isSelf: false }
    ];
  }

  function cleanAllocations(allocations) {
    if (!allocations || typeof allocations !== "object" || Array.isArray(allocations)) return {};
    return Object.fromEntries(Object.entries(allocations).map(([id, value]) => [id, Math.max(0, Math.round(Number(value) || 0))]));
  }

  function scaleAllocations(allocations, total, participants) {
    const cleaned = cleanAllocations(allocations);
    const participantOrder = participants.map((person) => person.id);
    const ids = [...participantOrder.filter((id) => id in cleaned), ...Object.keys(cleaned).filter((id) => !participantOrder.includes(id))];
    const currentTotal = ids.reduce((sum, id) => sum + cleaned[id], 0);
    if (!ids.length || currentTotal <= 0) return cleaned;
    if (total <= 0) return Object.fromEntries(ids.map((id) => [id, 0]));
    const scaled = Object.fromEntries(ids.map((id) => [id, Math.floor(cleaned[id] * total / currentTotal)]));
    let remainder = total - ids.reduce((sum, id) => sum + scaled[id], 0);
    const positiveIds = ids.filter((id) => cleaned[id] > 0);
    for (let index = 0; remainder > 0 && positiveIds.length; index += 1, remainder -= 1) {
      scaled[positiveIds[index % positiveIds.length]] += 1;
    }
    return scaled;
  }

  function repairRefund(bill) {
    const amount = Math.max(0, Math.round(Number(bill.amount) || 0));
    const previousRefund = Math.min(amount, Math.max(0, Math.round(Number(bill.refund) || 0)));
    const detectedRefund = Parser.refundFromStatus(String(bill.paymentStatus || ""), amount);
    const refund = previousRefund === 0 && detectedRefund > 0 ? detectedRefund : previousRefund;
    bill.amount = amount;
    bill.refund = refund;
    if (refund <= 0 || refund >= amount) return { changed: refund !== previousRefund, previousNet: amount - previousRefund };
    const issue = `已退款 ¥${(refund / 100).toFixed(2)}，请核对退款归属`;
    bill.issues = Array.isArray(bill.issues) ? bill.issues : [];
    if (!bill.issues.includes(issue)) bill.issues.push(issue);
    return { changed: refund !== previousRefund, previousNet: amount - previousRefund };
  }

  function migrateAllocation(bill, participants, refundRepair) {
    const mode = bill.allocation || "unset";
    const net = Calc.netAmount(bill);
    const friendId = primaryCompanionId(participants);
    const stored = cleanAllocations(bill.allocations);

    if (mode === "unset") {
      bill.allocations = {};
      return;
    }
    if (mode === "self") {
      bill.allocations = { me: net };
      return;
    }
    if (mode === "aa") {
      bill.allocation = "selected-aa";
      bill.allocationPeople = ["me", friendId];
      bill.allocations = Calc.splitEvenly(net, bill.allocationPeople);
      return;
    }
    if (mode === "friend") {
      bill.allocation = "person";
      bill.allocationPerson = friendId;
      bill.allocations = { [friendId]: net };
      return;
    }
    if (mode === "custom") {
      const legacy = bill.custom ? { me: bill.custom.me || 0, [friendId]: bill.custom.friend || 0 } : {};
      const allocations = Object.keys(stored).length ? stored : cleanAllocations(legacy);
      bill.allocations = refundRepair.changed ? scaleAllocations(allocations, net, participants) : allocations;
      delete bill.custom;
      return;
    }

    if (mode === "all-aa" && !Object.keys(stored).length) {
      bill.allocations = Calc.splitEvenly(net, participants.map((person) => person.id));
      return;
    }
    if (mode === "selected-aa" && !Object.keys(stored).length) {
      bill.allocations = Calc.splitEvenly(net, bill.allocationPeople || []);
      return;
    }
    if (mode === "person" && !Object.keys(stored).length) {
      bill.allocations = bill.allocationPerson ? { [bill.allocationPerson]: net } : {};
      return;
    }
    bill.allocations = refundRepair.changed ? scaleAllocations(stored, net, participants) : stored;
  }

  function migrateState(input) {
    if (!input || ![2, 3].includes(input.schemaVersion)) throw new Error("不支持的账单数据版本");
    const before = JSON.stringify(input);
    const state = clone(input);
    const fromV2 = state.schemaVersion === 2;
    state.trip = state.trip && typeof state.trip === "object" ? state.trip : {};
    state.trip.participants = fromV2
      ? v2Participants(state.trip)
      : (Array.isArray(state.trip.participants) && state.trip.participants.length ? state.trip.participants : clone(Data.initialState.trip.participants));
    state.trip.destination = typeof state.trip.destination === "string" ? state.trip.destination : "";
    delete state.trip.companion;
    state.bills = Array.isArray(state.bills) ? state.bills : [];
    state.imports = Array.isArray(state.imports) ? state.imports : [];
    state.imports.forEach((record) => {
      if (!["asc", "desc"].includes(record.dateOrder)) record.dateOrder = "desc";
    });
    state.repayments = Array.isArray(state.repayments) ? state.repayments : [];

    let repairedRefunds = 0;
    state.bills.forEach((bill) => {
      const repair = repairRefund(bill);
      if (repair.changed) repairedRefunds += 1;
      migrateAllocation(bill, state.trip.participants, repair);
    });
    const companionId = primaryCompanionId(state.trip.participants);
    state.repayments.forEach((repayment) => {
      if (!repayment.personId) repayment.personId = companionId;
    });
    state.schemaVersion = 3;

    return { state, changed: JSON.stringify(state) !== before, repairedRefunds };
  }

  window.TravelBillMigration = { migrateState, scaleAllocations, primaryCompanionId };
}());
