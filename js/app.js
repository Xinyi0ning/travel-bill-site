(function () {
  "use strict";

  const Data = window.TravelBillData;
  const Calc = window.TravelBillCalc;
  const Migration = window.TravelBillMigration;
  const TripStore = window.TravelBillTripStore;
  const UI = window.TravelBillUI;
  const AllocationDialogs = window.TravelBillAllocationDialogs;
  const ProjectSettings = window.TravelBillProjectSettings;
  const Exporter = window.TravelBillExporter;
  const ImportHistory = window.TravelBillImportHistory;
  const InlineNotes = window.TravelBillInlineNotes;
  const clone = (value) => JSON.parse(JSON.stringify(value));

  let library = TripStore.load();
  let state = TripStore.active(library);
  let filters = { search: "", category: "all", status: "all", quick: "all" };
  let selectedIds = new Set();
  let undoState = null;
  let pendingDeleteId = "";
  let lastImportedIds = [];
  let pendingBackup = null;
  let toastTimer;

  function saveState(message = "已自动保存") {
    state.updatedAt = Date.now();
    try {
      TripStore.replaceActive(library, state);
      TripStore.save(library);
      document.querySelector("#saveState").innerHTML = `<span aria-hidden="true">✓</span> ${message}`;
    } catch (_) {
      document.querySelector("#saveState").textContent = "本机存储空间不足";
      showToast("本机存储空间不足，请先导出明细备份");
    }
  }

  function filteredBills() {
    return state.bills.filter((bill) => {
      const haystack = `${bill.title} ${bill.merchant} ${bill.note} ${bill.source}`.toLowerCase();
      if (filters.search && !haystack.includes(filters.search.toLowerCase())) return false;
      if (filters.category !== "all" && bill.category !== filters.category) return false;
      if (filters.status !== "all" && bill.status !== filters.status) return false;
      if (filters.quick === "pending" && !["pending", "duplicate"].includes(bill.status)) return false;
      if (filters.quick === "unset" && (bill.allocation !== "unset" || bill.status === "excluded")) return false;
      if (filters.quick === "duplicate" && bill.status !== "duplicate") return false;
      if (filters.quick === "excluded" && bill.status !== "excluded") return false;
      return true;
    });
  }

  function render() {
    UI.renderTrip(state);
    UI.renderProjectHome(library.trips, library.activeTripId);
    UI.renderSummary(state);
    UI.renderCounts(state);
    UI.renderCategories(state);
    UI.renderBills(filteredBills(), selectedIds, state.bills.length, state);
    UI.renderSettlement(state);
    UI.renderStats(state);
    UI.renderImports(state);
    updateBatchBar();
  }

  function updateTripRange() {
    const dates = state.bills.filter((bill) => bill.status !== "excluded" && bill.date).map((bill) => bill.date.slice(0, 10)).sort();
    if (!dates.length) return;
    if (!state.trip.startDate) state.trip.startDate = dates[0];
    if (!state.trip.endDate) state.trip.endDate = dates[dates.length - 1];
  }

  function primaryCompanion() {
    const participants = state.trip.participants || [];
    const id = Migration.primaryCompanionId(participants);
    return participants.find((person) => person.id === id) || { id, name: "同行人" };
  }

  function allocationOptions(bill) {
    return { selectedIds: bill?.allocationPeople || [], personId: bill?.allocationPerson, allocations: bill?.allocations || {} };
  }

  function applyAllocation(bill, allocation, options = {}) {
    const people = state.trip.participants || [];
    const companion = primaryCompanion();
    const net = Calc.netAmount(bill);
    let mode = allocation;
    if (mode === "aa") { mode = "selected-aa"; options = { selectedIds: ["me", companion.id] }; }
    if (mode === "friend") { mode = "person"; options = { personId: companion.id }; }
    const selectedIds = people.filter((person) => (options.selectedIds || []).includes(person.id)).map((person) => person.id);
    const personId = people.some((person) => !person.isSelf && person.id === options.personId) ? options.personId : "";
    const customAllocations = Object.fromEntries(people.map((person) => [person.id, Math.max(0, Math.round(Number(options.allocations?.[person.id]) || 0))]));
    const buildOptions = mode === "selected-aa" ? { selectedIds } : mode === "person" ? { personId } : { allocations: customAllocations };
    const allocations = Calc.buildAllocations(net, mode, people, buildOptions);
    const allocated = Object.values(allocations).reduce((sum, value) => sum + value, 0);
    if (mode !== "unset" && allocated !== net) return false;
    delete bill.allocationPeople;
    delete bill.allocationPerson;
    delete bill.custom;
    bill.allocation = mode;
    bill.allocations = allocations;
    if (mode === "selected-aa") bill.allocationPeople = selectedIds;
    if (mode === "person") bill.allocationPerson = personId;
    return true;
  }

  function applyTransportDefault(bill) {
    if (bill.category !== "交通" || bill.status === "excluded" || bill.allocation !== "unset" || bill.defaultAllocationApplied) return false;
    if (!applyAllocation(bill, "all-aa")) return false;
    bill.defaultAllocationApplied = "transport-all-aa";
    if (!bill.issues?.length && bill.status !== "duplicate") bill.status = "confirmed";
    return true;
  }

  function applyTransportDefaults() {
    return state.bills.reduce((changed, bill) => applyTransportDefault(bill) || changed, false);
  }

  function editorAllocationMode(bill) {
    if (!bill) return "unset";
    if (bill.allocation === "aa") return "selected-aa";
    if (bill.allocation === "friend") return "person";
    return ["unset", "self", "all-aa", "selected-aa", "person", "custom"].includes(bill.allocation) ? bill.allocation : "unset";
  }

  function allocationLabel(bill) {
    if (bill.allocation === "self") return "自己承担";
    if (bill.allocation === "all-aa") return "全员 AA";
    if (bill.allocation === "selected-aa") return `${(bill.allocationPeople || []).map((id) => state.trip.participants.find((person) => person.id === id)?.name).filter(Boolean).join("、")} AA`;
    if (bill.allocation === "person") return `替${state.trip.participants.find((person) => person.id === bill.allocationPerson)?.name || "同行人"}付`;
    return "自定义分配";
  }

  function setAllocation(id, allocation, options) {
    const bill = state.bills.find((item) => item.id === id);
    if (!bill) return;
    undoState = clone(state);
    if (!applyAllocation(bill, allocation, options)) return void showToast("分配金额必须与账单净金额一致");
    if (bill.status !== "excluded") bill.status = "confirmed";
    saveState();
    render();
    showToast(`“${bill.title}”已设为${allocationLabel(bill)}`, true);
  }

  function chooseAllocation(id, allocation) {
    const bill = state.bills.find((item) => item.id === id);
    if (!bill) return;
    if (["selected-aa", "person", "custom"].includes(allocation)) {
      AllocationDialogs.open(allocation, bill, state, (options) => setAllocation(id, allocation, options));
    } else setAllocation(id, allocation);
  }

  function updateBatchBar() {
    const bar = document.querySelector("#batchBar");
    bar.hidden = selectedIds.size === 0;
    document.querySelector("#selectedCount").textContent = selectedIds.size;
    const visible = filteredBills();
    document.querySelector("#selectAll").checked = visible.length > 0 && visible.every((bill) => selectedIds.has(bill.id));
  }

  function runBatch(action) {
    if (action === "clear") { selectedIds.clear(); render(); return; }
    undoState = clone(state);
    state.bills.forEach((bill) => {
      if (!selectedIds.has(bill.id)) return;
      if (action === "exclude") bill.status = "excluded";
      else { applyAllocation(bill, action); bill.status = "confirmed"; }
    });
    const changed = selectedIds.size;
    selectedIds.clear();
    updateTripRange();
    saveState();
    render();
    showToast(`已更新 ${changed} 笔账单`, true);
  }

  function undo() {
    if (!undoState) return;
    state = undoState;
    undoState = null;
    saveState("已撤销并保存");
    render();
    showToast("已撤销上一次修改");
  }

  function setQuick(value) {
    filters.quick = value;
    document.querySelectorAll(".quick-chip").forEach((button) => button.classList.toggle("active", button.dataset.quick === value));
    switchTab("bills");
    UI.renderBills(filteredBills(), selectedIds, state.bills.length, state);
  }

  function switchTab(name) {
    document.querySelectorAll("[data-tab]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.tab === name)));
    document.querySelectorAll(".tab-panel").forEach((panel) => { panel.hidden = panel.id !== `${name}Panel`; });
  }

  function switchPage(page) {
    const home = page === "home";
    document.querySelector("#projectHome").hidden = !home;
    document.querySelector("#main").hidden = home;
    document.querySelector("#tripActions").hidden = home;
    document.querySelector("#detailStartButton").hidden = home;
    document.querySelector(".skip-link").href = home ? "#projectHome" : "#main";
    if (home) UI.renderProjectHome(library.trips, library.activeTripId);
  }

  function resetWorkspaceState() {
    filters = { search: "", category: "all", status: "all", quick: "all" };
    selectedIds = new Set();
    undoState = null;
    document.querySelector("#searchInput").value = "";
    document.querySelectorAll(".quick-chip").forEach((button) => button.classList.toggle("active", button.dataset.quick === "all"));
  }

  function openTrip(tripId) {
    const selected = TripStore.select(library, tripId);
    if (!selected) return void showToast("没有找到这个旅行项目");
    state = selected;
    resetWorkspaceState();
    try { TripStore.save(library); } catch (_) { /* The active trip still works in memory. */ }
    render();
    switchPage("trip");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openNewTrip() {
    document.querySelector("#newTripForm").reset();
    document.querySelector("#newTripError").textContent = "";
    document.querySelector("#newTripDialog").showModal();
  }

  function createTrip() {
    const name = document.querySelector("#newTripName").value.trim();
    const destination = document.querySelector("#newTripDestination").value.trim();
    const startDate = document.querySelector("#newTripStartDate").value;
    const endDate = document.querySelector("#newTripEndDate").value;
    const companionNames = [...new Set(document.querySelector("#newTripCompanions").value.split(/[，,、;；\n]/).map((value) => value.trim()).filter(Boolean))];
    const error = document.querySelector("#newTripError");
    if (!name || !destination || !startDate || !endDate || !companionNames.length) return void (error.textContent = "请填写旅行名称、旅行地、开始和结束日期，并至少添加一位同行人。");
    if (endDate < startDate) return void (error.textContent = "结束日期不能早于开始日期。");
    const next = clone(Data.initialState);
    next.id = TripStore.createTripId();
    next.trip = {
      name,
      destination,
      startDate,
      endDate,
      participants: [
        { id: "me", name: "我", isSelf: true },
        ...companionNames.map((personName, index) => ({ id: `person-${Date.now()}-${index}`, name: personName, isSelf: false }))
      ]
    };
    next.updatedAt = Date.now();
    state = TripStore.add(library, next);
    resetWorkspaceState();
    document.querySelector("#newTripDialog").close();
    saveState("新旅行已创建");
    render();
    switchPage("trip");
    showToast(`已创建“${name}”`);
  }

  function exportBackup() {
    try {
      TripStore.replaceActive(library, state);
      TripStore.save(library);
      const content = JSON.stringify(TripStore.backup(library), null, 2);
      const blob = new Blob([content], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `同行账本完整备份_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast(`已导出 ${library.trips.length} 个旅行的完整备份`);
    } catch (_) {
      showToast("完整备份导出失败，请稍后再试");
    }
  }

  async function prepareBackupRestore(file) {
    if (!file) return;
    try {
      pendingBackup = TripStore.normalizeLibrary(JSON.parse(await file.text()));
      const bills = pendingBackup.trips.reduce((sum, trip) => sum + trip.bills.length, 0);
      document.querySelector("#restoreBackupSummary").textContent = `备份中包含 ${pendingBackup.trips.length} 个旅行、${bills} 笔账单。`;
      document.querySelector("#backupDialog").close();
      document.querySelector("#restoreBackupDialog").showModal();
    } catch (error) {
      pendingBackup = null;
      showToast(error instanceof Error ? error.message : "备份文件无法读取");
    } finally {
      document.querySelector("#backupFileInput").value = "";
    }
  }

  function restoreBackup() {
    if (!pendingBackup) return;
    const restoredLibrary = pendingBackup;
    try {
      TripStore.save(restoredLibrary);
    } catch (_) {
      return void showToast("本机存储空间不足，备份未能恢复");
    }
    library = restoredLibrary;
    pendingBackup = null;
    state = TripStore.active(library);
    resetWorkspaceState();
    document.querySelector("#restoreBackupDialog").close();
    render();
    switchPage("home");
    window.scrollTo({ top: 0, behavior: "smooth" });
    showToast(`已恢复 ${library.trips.length} 个旅行`);
  }

  function goToDetailsStart() {
    switchPage("trip");
    switchTab("bills");
    document.querySelector(".table-wrap").scrollTo({ left: 0, behavior: "smooth" });
    document.querySelector("#billsPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openSettings() {
    ProjectSettings.open(state, (trip) => {
      state.trip = trip;
      saveState();
      render();
      showToast("项目设置已保存");
    });
  }

  function importRecord(result, added, duplicates, importId, billIds) {
    const extension = result.file.name.split(".").pop().toUpperCase();
    const stats = result.stats || {};
    const skipped = (stats.income || 0) + (stats.refundIncome || 0) + (stats.neutral || 0) + (stats.invalid || 0);
    const issues = result.ok ? (result.bills || []).filter((bill) => bill.issues?.length).length : 1;
    return {
      id: importId,
      name: result.file.name,
      type: result.kind === "image" ? "IMG" : extension.slice(0, 4),
      date: new Date().toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }),
      status: result.ok ? "complete" : "error",
      bills: added,
      billIds,
      dateOrder: "desc",
      issues,
      duplicates,
      message: result.ok ? `导入 ${added} 笔${duplicates ? `，跳过 ${duplicates} 笔重复` : ""}${skipped ? `，忽略 ${skipped} 笔收入或非支出` : ""}` : result.error
    };
  }

  function mergeResults(results) {
    const existingIds = new Set(state.bills.map((bill) => bill.id));
    const transactionIds = new Set(state.bills.map((bill) => bill.transactionId).filter(Boolean));
    lastImportedIds = [];
    return results.map((result) => {
      const importId = ImportHistory.createId();
      const billIds = [];
      let added = 0;
      let duplicates = 0;
      if (result.ok) {
        [...(result.bills || [])].sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime()).forEach((bill) => {
          if (existingIds.has(bill.id) || (bill.transactionId && transactionIds.has(bill.transactionId))) { duplicates += 1; return; }
          bill.importId = importId;
          applyTransportDefault(bill);
          state.bills.push(bill);
          existingIds.add(bill.id);
          if (bill.transactionId) transactionIds.add(bill.transactionId);
          lastImportedIds.push(bill.id);
          billIds.push(bill.id);
          added += 1;
        });
      }
      const record = importRecord(result, added, duplicates, importId, billIds);
      state.imports.unshift(record);
      return { result, record };
    });
  }

  function showImportResults(merged) {
    const successes = merged.filter((item) => item.result.ok).length;
    document.querySelector("#resultTitle").textContent = successes ? "账单已整理" : "文件未能导入";
    document.querySelector("#importResults").innerHTML = merged.map(({ result, record }) => `<div class="result-item ${result.ok ? "" : "is-error"}"><div><strong>${Calc.escapeHtml(record.name)}</strong><span>${Calc.escapeHtml(record.message)}</span></div><div class="result-item-actions"><strong>${result.ok ? `${record.bills} 笔` : "失败"}</strong>${record.bills ? `<div class="import-order-control" role="group" aria-label="${Calc.escapeHtml(record.name)}日期排序"><span>日期</span><button type="button" data-import-sort="${Calc.escapeHtml(record.id)}" data-order="asc" aria-pressed="false" title="最早的账单排在前面">正序</button><button type="button" data-import-sort="${Calc.escapeHtml(record.id)}" data-order="desc" aria-pressed="true" title="最新的账单排在前面">倒序</button></div><button class="danger-text" type="button" data-remove-import="${Calc.escapeHtml(record.id)}">撤销此次导入</button>` : ""}</div></div>`).join("");
    document.querySelector("#reviewImported").hidden = lastImportedIds.length === 0;
    document.querySelector("#importResultDialog").showModal();
  }

  function sortImportedBatch(importId, order) {
    const count = ImportHistory.sortBatch(state, importId, order);
    if (!count) return void showToast("这次导入没有可排序的账单");
    saveState("账单顺序已保存");
    render();
    document.querySelectorAll(`[data-import-sort="${CSS.escape(importId)}"]`).forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.order === order)));
    showToast(`已按日期${order === "asc" ? "正序" : "倒序"}排列这次导入的 ${count} 笔账单`);
  }

  async function processFiles(files) {
    if (!files?.length) return;
    const dialog = document.querySelector("#importProgressDialog");
    const progress = document.querySelector("#importProgress");
    dialog.showModal();
    const results = await window.TravelBillImporter.processFiles(files, {
      onFileStart({ file, index, total }) {
        document.querySelector("#progressTitle").textContent = `正在处理 ${file.name}`;
        document.querySelector("#progressText").textContent = `第 ${index + 1} 个，共 ${total} 个文件`;
        progress.value = Math.round(index / total * 100);
      },
      onProgress({ label, progress: value, index, total }) {
        document.querySelector("#progressText").textContent = label;
        progress.value = Math.max(2, Math.round((index + value) / total * 100));
      }
    });
    const merged = mergeResults(results);
    updateTripRange();
    saveState();
    render();
    progress.value = 100;
    dialog.close();
    document.querySelector("#fileInput").value = "";
    showImportResults(merged);
  }

  function localInputDate(date = new Date()) {
    const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return adjusted.toISOString().slice(0, 16);
  }

  function openEditor(id = "") {
    const bill = id ? state.bills.find((item) => item.id === id) : null;
    document.querySelector("#editBillId").value = bill?.id || "";
    document.querySelector("#editEyebrow").textContent = bill ? "账单核对" : "手动添加";
    document.querySelector("#editTitle").textContent = bill ? "编辑费用" : "新增费用";
    document.querySelector("#editName").value = bill?.title || "";
    document.querySelector("#editDate").value = bill?.date?.slice(0, 16) || localInputDate();
    document.querySelector("#editMerchant").value = bill?.merchant || "";
    document.querySelector("#editAmount").value = bill ? (bill.amount / 100).toFixed(2) : "";
    document.querySelector("#editRefund").value = bill ? ((bill.refund || 0) / 100).toFixed(2) : "0.00";
    document.querySelector("#editCategory").value = bill?.category || "其他";
    document.querySelector("#editAllocation").value = editorAllocationMode(bill);
    document.querySelector("#editNote").value = bill?.note || "";
    document.querySelector("#editIncluded").checked = bill?.status !== "excluded";
    document.querySelector("#editError").textContent = "";
    document.querySelector("#deleteFromEditor").hidden = !bill;
    const raw = bill?.originalText || (bill?.original ? JSON.stringify(bill.original, null, 2) : "");
    document.querySelector("#rawDetails").hidden = !raw;
    document.querySelector("#rawContent").textContent = raw;
    document.querySelector("#editDialog").showModal();
  }

  function saveEditor() {
    const id = document.querySelector("#editBillId").value;
    const name = document.querySelector("#editName").value.trim();
    const date = document.querySelector("#editDate").value;
    const amount = Math.round(Number(document.querySelector("#editAmount").value) * 100);
    const refund = Math.round((Number(document.querySelector("#editRefund").value) || 0) * 100);
    const error = document.querySelector("#editError");
    if (!name || !date || !Number.isFinite(amount) || amount <= 0) return void (error.textContent = "请填写费用说明、交易时间和有效金额。");
    if (!Number.isFinite(refund) || refund < 0 || refund > amount) return void (error.textContent = "退款金额不能小于零或超过原始金额。");
    undoState = clone(state);
    const existing = id ? state.bills.find((bill) => bill.id === id) : null;
    const allocation = document.querySelector("#editAllocation").value;
    const included = document.querySelector("#editIncluded").checked;
    const amountChanged = existing && (existing.amount !== amount || (existing.refund || 0) !== refund);
    const safeAllocation = allocation === "custom" && amountChanged ? "unset" : allocation;
    const previousOptions = allocationOptions(existing);
    const values = {
      id: existing?.id || `manual-${Date.now()}`,
      date,
      title: name,
      merchant: document.querySelector("#editMerchant").value.trim() || "待补充",
      category: document.querySelector("#editCategory").value,
      amount,
      refund,
      status: included ? (safeAllocation === "unset" ? "pending" : "confirmed") : "excluded",
      source: existing?.source || "手动添加",
      sourceType: existing?.sourceType || "manual",
      transactionId: existing?.transactionId || "",
      paymentStatus: existing?.paymentStatus || "手动记录",
      note: document.querySelector("#editNote").value.trim(),
      confidence: existing?.confidence ?? 1,
      issues: existing?.issues || [],
      original: existing?.original,
      originalText: existing?.originalText,
      edited: true
    };
    const savedBill = existing || values;
    if (existing) Object.assign(existing, values); else state.bills.push(values);
    if (!(safeAllocation === "custom" && existing && !amountChanged)) applyAllocation(savedBill, safeAllocation, previousOptions);
    applyTransportDefault(savedBill);
    updateTripRange();
    saveState();
    document.querySelector("#editDialog").close();
    render();
    showToast(existing ? "账单修改已保存" : "新费用已添加", true);
  }

  function askDelete(id) {
    pendingDeleteId = id;
    document.querySelector("#deleteDialog").showModal();
  }

  function confirmDelete() {
    const bill = state.bills.find((item) => item.id === pendingDeleteId);
    if (!bill) return;
    undoState = clone(state);
    state.bills = state.bills.filter((item) => item.id !== pendingDeleteId);
    selectedIds.delete(pendingDeleteId);
    updateTripRange();
    saveState();
    document.querySelector("#deleteDialog").close();
    document.querySelector("#editDialog").close();
    render();
    showToast(`已删除“${bill.title}”`, true);
  }

  function openRepayment(personId = "") {
    const companions = state.trip.participants.filter((person) => !person.isSelf);
    if (!companions.length) return void showToast("请先在项目设置中添加同行人");
    const select = document.querySelector("#repaymentPerson");
    select.innerHTML = companions.map((person) => `<option value="${Calc.escapeHtml(person.id)}">${Calc.escapeHtml(person.name)}</option>`).join("");
    select.value = companions.some((person) => person.id === personId) ? personId : companions[0].id;
    document.querySelector("#repaymentAmount").value = "";
    document.querySelector("#repaymentDate").value = localInputDate().slice(0, 10);
    document.querySelector("#repaymentNote").value = "";
    document.querySelector("#repaymentDialog").showModal();
  }

  function addRepayment() {
    const amount = Math.round(Number(document.querySelector("#repaymentAmount").value) * 100);
    const date = document.querySelector("#repaymentDate").value;
    const personId = document.querySelector("#repaymentPerson").value;
    if (!Number.isFinite(amount) || amount <= 0 || !date || !state.trip.participants.some((person) => !person.isSelf && person.id === personId)) { document.querySelector("#repaymentForm").reportValidity(); return; }
    state.repayments.push({ id: `r-${Date.now()}`, personId, amount, date, note: document.querySelector("#repaymentNote").value.trim() });
    saveState();
    document.querySelector("#repaymentDialog").close();
    render();
    showToast(`已登记还款 ${Calc.formatMoney(amount)}`);
  }

  function exportExcel() {
    if (!state.bills.length) return void showToast("暂无账单可导出");
    try { Exporter.exportXlsx(state); showToast("已导出含每位参与人承担金额的 Excel 明细"); }
    catch (error) { showToast(error.message || "Excel 导出失败"); }
  }

  function removeImportedBatch(importId) {
    const record = state.imports.find((item) => item.id === importId);
    if (!record || !ImportHistory.liveCount(state, record)) return void showToast("这次导入已经没有可删除的费用");
    undoState = clone(state);
    const result = ImportHistory.removeFromState(state, importId);
    result.ids.forEach((id) => selectedIds.delete(id));
    saveState();
    render();
    showToast(`已撤销“${result.name}”导入的 ${result.count} 笔费用`, true);
  }

  function showToast(message, withUndo = false) {
    const toast = document.querySelector("#toast");
    clearTimeout(toastTimer);
    toast.innerHTML = `${Calc.escapeHtml(message)}${withUndo ? ' <button type="button" data-undo style="margin-left:12px;border:0;background:transparent;color:#a9c5ff;font-weight:700;cursor:pointer">撤销</button>' : ""}`;
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, 5200);
  }

  document.addEventListener("click", (event) => {
    const target = event.target.closest("button, a");
    if (!target) return;
    if (target.matches("a[href='#']")) event.preventDefault();
    if (target.dataset.tab) switchTab(target.dataset.tab);
    if (target.hasAttribute("data-all-trips")) switchPage("home");
    if (target.hasAttribute("data-open-trip")) openTrip(target.dataset.openTrip);
    if (target.dataset.quick) setQuick(target.dataset.quick);
    if (target.dataset.edit) openEditor(target.dataset.edit);
    if (target.dataset.allocation) chooseAllocation(target.dataset.id, target.dataset.allocation);
    if (target.dataset.batch) runBatch(target.dataset.batch);
    if (target.dataset.importSort) sortImportedBatch(target.dataset.importSort, target.dataset.order);
    if (target.hasAttribute("data-upload") || target.id === "uploadButton") document.querySelector("#fileInput").click();
    if (target.id === "addBillButton") openEditor();
    if (target.id === "exportButton") exportExcel();
    if (target.id === "saveEdit") saveEditor();
    if (target.id === "deleteFromEditor") askDelete(document.querySelector("#editBillId").value);
    if (target.id === "confirmDelete") confirmDelete();
    if (target.id === "openRepayment") openRepayment();
    if (target.hasAttribute("data-repayment-person")) openRepayment(target.dataset.repaymentPerson);
    if (target.id === "saveRepayment") addRepayment();
    if (target.id === "reviewImported") setQuick("pending");
    if (target.dataset.removeImport && !ImportHistory.open(state, target.dataset.removeImport, removeImportedBatch)) showToast("这次导入已经没有可删除的费用");
    if (target.dataset.undo !== undefined) undo();
    if (target.id === "settingsButton") openSettings();
    if (target.id === "newTripButton") openNewTrip();
    if (target.id === "createTripButton") createTrip();
    if (target.id === "backupButton") document.querySelector("#backupDialog").showModal();
    if (target.id === "exportBackupButton") exportBackup();
    if (target.id === "importBackupButton") document.querySelector("#backupFileInput").click();
    if (target.id === "confirmRestoreBackup") restoreBackup();
    if (target.id === "detailStartButton") goToDetailsStart();
    if (target.id === "moreFilters") showToast("更多筛选将在后续版本开放");
  });

  document.addEventListener("change", (event) => {
    if (event.target.id === "fileInput" && event.target.files.length) processFiles(event.target.files);
    if (event.target.id === "backupFileInput" && event.target.files.length) prepareBackupRestore(event.target.files[0]);
    if (event.target.id === "categoryFilter") { filters.category = event.target.value; UI.renderBills(filteredBills(), selectedIds, state.bills.length, state); }
    if (event.target.id === "statusFilter") { filters.status = event.target.value; UI.renderBills(filteredBills(), selectedIds, state.bills.length, state); }
    if (event.target.matches("[data-select]")) { event.target.checked ? selectedIds.add(event.target.dataset.select) : selectedIds.delete(event.target.dataset.select); updateBatchBar(); }
    if (event.target.id === "selectAll") { filteredBills().forEach((bill) => event.target.checked ? selectedIds.add(bill.id) : selectedIds.delete(bill.id)); render(); }
  });

  const dropZone = document.querySelector("#dropZone");
  ["dragenter", "dragover"].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.add("is-dragging"); }));
  ["dragleave", "drop"].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.remove("is-dragging"); }));
  dropZone.addEventListener("drop", (event) => processFiles(event.dataTransfer.files));
  document.querySelector("#searchInput").addEventListener("input", (event) => { filters.search = event.target.value; UI.renderBills(filteredBills(), selectedIds, state.bills.length, state); });
  ["#customForm", "#selectedAaForm", "#personForm", "#settingsForm", "#repaymentForm", "#editForm", "#newTripForm"].forEach((selector) => document.querySelector(selector).addEventListener("submit", (event) => { if (event.submitter && event.submitter.value === "cancel") return; event.preventDefault(); }));
  InlineNotes.bind((id, note) => { const bill = state.bills.find((item) => item.id === id); if (!bill || bill.note === note) return; bill.note = note; bill.edited = true; saveState("备注已保存"); });

  if (applyTransportDefaults()) saveState("已应用交通费全员 AA 默认规则");
  render();
}());
