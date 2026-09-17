(function () {
  "use strict";

  let pendingImportId = "";
  let confirmRemoval = null;

  function createId() {
    return `import-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function linkedBills(state, record) {
    if (!record) return [];
    const recordedIds = new Set(Array.isArray(record.billIds) ? record.billIds : []);
    const hasExplicitLinks = Array.isArray(record.billIds) || state.bills.some((bill) => bill.importId === record.id);
    if (hasExplicitLinks) return state.bills.filter((bill) => bill.importId === record.id || recordedIds.has(bill.id));
    return state.bills.filter((bill) => bill.sourceType !== "manual" && bill.source === record.name);
  }

  function liveCount(state, record) {
    return linkedBills(state, record).length;
  }

  function canSort(state, record) {
    return Boolean(record && (Array.isArray(record.billIds) || state.bills.some((bill) => bill.importId === record.id)));
  }

  function sortBatch(state, importId, order) {
    const record = state.imports.find((item) => item.id === importId);
    if (!record || !canSort(state, record) || !["asc", "desc"].includes(order)) return 0;
    const linkedIds = new Set(linkedBills(state, record).map((bill) => bill.id));
    const positions = state.bills.map((bill, index) => linkedIds.has(bill.id) ? index : -1).filter((index) => index >= 0);
    const sorted = positions.map((index, originalIndex) => ({ bill: state.bills[index], originalIndex })).sort((left, right) => {
      const difference = new Date(left.bill.date).getTime() - new Date(right.bill.date).getTime();
      return (order === "asc" ? difference : -difference) || left.originalIndex - right.originalIndex;
    }).map((item) => item.bill);
    positions.forEach((position, index) => { state.bills[position] = sorted[index]; });
    record.dateOrder = order;
    return positions.length;
  }

  function open(state, importId, callback) {
    const record = state.imports.find((item) => item.id === importId);
    const bills = linkedBills(state, record);
    if (!record || !bills.length || record.status === "reverted") return false;
    const edited = bills.filter((bill) => bill.edited).length;
    const legacy = !Array.isArray(record.billIds) && !bills.some((bill) => bill.importId === record.id);
    document.querySelector("#removeImportFile").textContent = record.name;
    document.querySelector("#removeImportSummary").textContent = `将删除这次导入当前保留的 ${bills.length} 笔费用。`;
    document.querySelector("#removeImportWarning").textContent = `${edited ? `其中 ${edited} 笔后来手动修改过，也会一起删除。` : "其他文件、手动新增费用和还款记录不受影响。"}${legacy ? " 这是旧版导入记录，将按来源文件名匹配。" : ""}`;
    document.querySelector("#confirmImportRemoval").textContent = `删除 ${bills.length} 笔费用`;
    const resultDialog = document.querySelector("#importResultDialog");
    if (resultDialog.open) resultDialog.close();
    pendingImportId = importId;
    confirmRemoval = callback;
    document.querySelector("#removeImportDialog").showModal();
    return true;
  }

  function removeFromState(state, importId) {
    const record = state.imports.find((item) => item.id === importId);
    const bills = linkedBills(state, record);
    const ids = bills.map((bill) => bill.id);
    if (!record || !ids.length) return { count: 0, ids: [], name: record?.name || "该文件" };
    const idSet = new Set(ids);
    state.bills = state.bills.filter((bill) => !idSet.has(bill.id));
    record.originalMessage = record.originalMessage || record.message;
    record.status = "reverted";
    record.removedBills = ids.length;
    record.removedAt = new Date().toISOString();
    record.message = `已撤销本次导入，共删除 ${ids.length} 笔费用`;
    if (!Array.isArray(record.billIds)) record.billIds = ids;
    return { count: ids.length, ids, name: record.name };
  }

  document.querySelector("#confirmImportRemoval").addEventListener("click", () => {
    if (!pendingImportId || !confirmRemoval) return;
    const importId = pendingImportId;
    document.querySelector("#removeImportDialog").close();
    pendingImportId = "";
    const callback = confirmRemoval;
    confirmRemoval = null;
    callback(importId);
  });

  window.TravelBillImportHistory = { createId, linkedBills, liveCount, canSort, sortBatch, open, removeFromState };
}());
