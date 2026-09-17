(function () {
  "use strict";

  const Calc = window.TravelBillCalc;
  const ImportHistory = window.TravelBillImportHistory;
  const InlineNotes = window.TravelBillInlineNotes;
  const allocationNames = { self: "自己", "selected-aa": "指定人 AA", person: "替人付", custom: "自定义", unset: "待设置" };
  const statusNames = { confirmed: "已确认", pending: "待核对", duplicate: "疑似重复", excluded: "已排除" };

  function allocationButtons(bill, state) {
    const count = (state.trip.participants || []).length;
    const names = { ...allocationNames, "all-aa": `全员 AA · ${count} 人` };
    return `<div class="segments" aria-label="${Calc.escapeHtml(bill.title)}的承担方式">
      ${["self", "all-aa", "selected-aa", "person", "custom"].map((type) => {
        const active = bill.allocation === type;
        return `<button type="button" data-allocation="${type}" data-id="${bill.id}" aria-pressed="${active}">${Calc.escapeHtml(names[type])}${active ? " ✓" : ""}</button>`;
      }).join("")}
    </div>`;
  }

  function statusLabel(status, label) {
    return `<span class="status-label status-${status}">${label || statusNames[status] || status}</span>`;
  }

  function sourceLabel(bill) {
    if (bill.sourceType === "image-ocr") return `${bill.source} · OCR ${Math.round((bill.confidence || 0) * 100)}%`;
    return bill.source || "手动添加";
  }

  function billRow(bill, selected, state) {
    const allocations = Calc.allocationMap(bill, state.trip.participants);
    const date = new Date(bill.date);
    const source = sourceLabel(bill);
    return `<tr class="${bill.status === "excluded" ? "is-excluded" : ""}">
      <td class="check-cell"><input type="checkbox" data-select="${bill.id}" aria-label="选择${Calc.escapeHtml(bill.title)}" ${selected ? "checked" : ""}></td>
      <td><span class="date-main">${date.getMonth() + 1}月${date.getDate()}日</span><span class="date-main">${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}</span></td>
      <td class="bill-description-cell"><button class="bill-name bill-link" type="button" data-edit="${bill.id}" title="${Calc.escapeHtml(bill.title)}">${Calc.escapeHtml(bill.title)}</button><span class="bill-source" title="${Calc.escapeHtml(source)}">${Calc.escapeHtml(source)}</span></td>
      <td class="numeric amount-main bill-amount-cell">${Calc.formatMoney(Calc.netAmount(bill))}</td>
      <td class="bill-allocation-cell"><div class="allocation-workflow">${allocationButtons(bill, state)}<label class="allocation-note"><span class="sr-only">备注</span>${InlineNotes.field(bill)}</label></div></td>
      <td><span class="category-tag">${Calc.escapeHtml(bill.category)}</span></td>
      <td class="numeric">${bill.allocation === "unset" ? "—" : Calc.formatMoney(allocations.me || 0)}</td>
      <td class="numeric">${bill.allocation === "unset" ? "—" : Calc.formatMoney(Calc.otherShare(bill, state.trip.participants))}</td>
      <td>${statusLabel(bill.status)}</td>
      <td><button class="row-action" type="button" data-edit="${bill.id}" aria-label="编辑${Calc.escapeHtml(bill.title)}">•••</button></td>
    </tr>`;
  }

  function mobileCard(bill, state) {
    const allocations = Calc.allocationMap(bill, state.trip.participants);
    const date = new Date(bill.date);
    return `<article class="mobile-card ${bill.status === "excluded" ? "is-excluded" : ""}">
      <div class="mobile-card-head"><div><h3>${Calc.escapeHtml(bill.title)}</h3><div class="mobile-card-meta"><span>${date.getMonth()+1}月${date.getDate()}日 ${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}</span><span>${Calc.escapeHtml(bill.category)}</span></div></div><strong class="amount-main">${Calc.formatMoney(Calc.netAmount(bill))}</strong></div>
      ${allocationButtons(bill, state)}
      <label class="mobile-note"><span>备注</span>${InlineNotes.field(bill, "卡片")}</label>
      <div class="mobile-split"><span>我承担 <strong>${bill.allocation === "unset" ? "—" : Calc.formatMoney(allocations.me || 0)}</strong></span><span>同行人应还 <strong>${bill.allocation === "unset" ? "—" : Calc.formatMoney(Calc.otherShare(bill, state.trip.participants))}</strong></span></div>
      <div class="mobile-card-actions"><button class="row-action" type="button" data-edit="${bill.id}" aria-label="编辑${Calc.escapeHtml(bill.title)}">编辑</button></div>
    </article>`;
  }

  function readableDate(date) {
    const value = new Date(`${date}T00:00:00`);
    return `${value.getFullYear()} 年 ${value.getMonth() + 1} 月 ${value.getDate()} 日`;
  }

  function renderTrip(state) {
    document.querySelector("#tripTitle").textContent = state.trip.name || "旅行账单";
    document.querySelector("#tripDestination").textContent = state.trip.destination || "未设置旅行地";
    document.querySelector("#tripCompanion").textContent = (state.trip.participants || []).filter((person) => !person.isSelf).map((person) => person.name).join("、") || "暂无";
    document.querySelector("#tripDates").textContent = state.trip.startDate && state.trip.endDate ? `${readableDate(state.trip.startDate)}—${readableDate(state.trip.endDate)}` : "上传账单后自动整理日期范围";
  }

  function renderProjectHome(trips, activeTripId) {
    document.querySelector("#projectList").innerHTML = trips.length ? trips.map((state) => {
      const total = Calc.summary(state);
      const companions = (state.trip.participants || []).filter((person) => !person.isSelf).map((person) => person.name).join("、") || "暂无同行人";
      const dates = state.trip.startDate && state.trip.endDate ? `${state.trip.startDate}—${state.trip.endDate}` : "日期待设置";
      const status = state.id === activeTripId ? "当前旅行" : "旅行项目";
      return `<button class="project-card" type="button" data-open-trip="${Calc.escapeHtml(state.id)}" aria-label="打开${Calc.escapeHtml(state.trip.name || "旅行账单")}">
        <span class="project-card-main"><span><span class="eyebrow">${status}</span><h2>${Calc.escapeHtml(state.trip.name || "旅行账单")}</h2><span class="project-card-meta">${Calc.escapeHtml(state.trip.destination || "旅行地待设置")} · ${Calc.escapeHtml(dates)} · ${Calc.escapeHtml(companions)}</span></span><span class="project-card-arrow" aria-hidden="true">→</span></span>
        <span class="project-card-stats"><span>净支出<strong>${Calc.formatMoney(total.net)}</strong></span><span>剩余应收<strong>${Calc.formatMoney(total.receivable)}</strong></span><span>待核对<strong>${total.pending} 笔</strong></span><span>账单<strong>${state.bills.length} 笔</strong></span></span>
      </button>`;
    }).join("") : '<div class="empty-state"><strong>还没有旅行</strong><p>点击“新建旅行”开始记录。</p></div>';
  }

  function renderSummary(state) {
    const total = Calc.summary(state);
    document.querySelector("#netTotal").textContent = Calc.formatMoney(total.net);
    document.querySelector("#ownTotal").textContent = Calc.formatMoney(total.own);
    document.querySelector("#otherTotal").textContent = Calc.formatMoney(total.other);
    document.querySelector("#receivableTotal").textContent = Calc.formatMoney(total.receivable);
    document.querySelector("#netMeta").textContent = `已纳入 ${total.includedCount} 笔${total.pending ? " · 暂计" : ""}`;
    document.querySelector("#receivableMeta").textContent = `同行人已还 ${Calc.formatMoney(total.repaid)}`;
    const banner = document.querySelector("#reviewBanner");
    banner.hidden = total.pending === 0;
    document.querySelector("#reviewTitle").textContent = `${total.pending} 笔账单需要确认`;
    document.querySelector("#reviewText").textContent = "待核对账单已计入净支出；已设置承担的金额会暂计入承担汇总。";
  }

  function renderBills(bills, selectedIds, totalCount, state) {
    document.querySelector("#billTableBody").innerHTML = bills.map((bill) => billRow(bill, selectedIds.has(bill.id), state)).join("");
    document.querySelector("#mobileBillList").innerHTML = bills.map((bill) => mobileCard(bill, state)).join("");
    document.querySelector("#emptyState").hidden = bills.length > 0;
    document.querySelector("#emptyTitle").textContent = totalCount ? "没有符合条件的账单" : "还没有账单";
    document.querySelector("#emptyText").textContent = totalCount ? "试试清除筛选条件。" : "上传微信、支付宝账单或支付截图开始整理。";
    document.querySelector("#resultCount").textContent = `显示 ${bills.length} 笔`;
  }

  function renderCounts(state) {
    const bills = state.bills;
    const count = (matcher) => bills.filter(matcher).length;
    document.querySelector("#billCountBadge").textContent = bills.length;
    document.querySelector("#allCount").textContent = bills.length;
    document.querySelector("#pendingCount").textContent = count((bill) => bill.status === "pending");
    document.querySelector("#unsetCount").textContent = count((bill) => bill.allocation === "unset" && bill.status !== "excluded");
    document.querySelector("#duplicateCount").textContent = count((bill) => bill.status === "duplicate");
    document.querySelector("#excludedCount").textContent = count((bill) => bill.status === "excluded");
  }

  function renderSettlement(state) {
    const total = Calc.summary(state);
    const companions = (state.trip.participants || []).filter((person) => !person.isSelf);
    document.querySelector("#settlementContent").innerHTML = companions.length ? companions.map((person) => {
      const due = total.perPerson[person.id] || 0;
      const repaid = total.perPersonRepaid[person.id] || 0;
      const remaining = total.perPersonReceivable[person.id] || 0;
      const repayments = state.repayments.filter((item) => item.personId === person.id);
      const repaymentRows = repayments.length ? repayments.slice().reverse().map((item) => `<div class="repayment-item"><span>${Calc.escapeHtml(item.date)} · ${Calc.escapeHtml(item.note || "还款")}</span><strong>已还 ${Calc.formatMoney(item.amount)}</strong><span>已计入</span></div>`).join("") : "<p>还没有登记还款。</p>";
      const stateLabel = remaining > 0 ? statusLabel("pending", "待收款") : remaining < 0 ? statusLabel("overpaid", "需退还") : statusLabel("confirmed", "已结清");
      const balanceLabel = remaining < 0 ? `需退还${person.name}` : "剩余应还";
      return `<article class="settlement-card"><div class="person-row"><div class="person"><span class="avatar">${Calc.escapeHtml(person.name.slice(0,1))}</span><div><strong>${Calc.escapeHtml(person.name)}</strong><small>同行人 · ${state.bills.filter((bill) => Calc.personShare(bill, person.id, state.trip.participants) > 0).length} 笔账单相关</small></div></div>${stateLabel}</div><div class="settlement-amounts"><div><span>应还合计</span><strong>${Calc.formatMoney(due)}</strong></div><div><span>已经归还</span><strong>${Calc.formatMoney(repaid)}</strong></div><div><span>${Calc.escapeHtml(balanceLabel)}</span><strong class="${remaining < 0 ? "amount-refund" : "amount-due"}">${Calc.formatMoney(Math.abs(remaining))}</strong></div></div><h3>还款记录</h3><div class="repayment-list">${repaymentRows}</div><div class="settlement-actions"><button class="button button-secondary" type="button" data-repayment-person="${Calc.escapeHtml(person.id)}">＋ 登记${Calc.escapeHtml(person.name)}还款</button></div></article>`;
    }).join("") : '<div class="empty-state"><strong>还没有同行人</strong><p>请先在项目设置中添加同行人。</p></div>';
  }

  function barRows(data, color) {
    const entries = Object.entries(data).sort((a,b) => b[1] - a[1]);
    if (!entries.length) return "<p>导入账单后显示统计。</p>";
    const max = Math.max(...entries.map(([,value]) => value), 1);
    return entries.map(([label,value]) => `<div class="bar-row"><span>${Calc.escapeHtml(label)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(3, value/max*100)}%;${color ? `background:${color}` : ""}"></div></div><strong>${Calc.formatMoney(value)}</strong></div>`).join("");
  }

  function renderStats(state) {
    const total = Calc.summary(state);
    const confirmed = total.own + total.other || 1;
    const ownPercent = Math.round(total.own / confirmed * 100);
    document.querySelector("#statsContent").innerHTML = `<article class="chart-card"><h3>费用分类</h3>${barRows(Calc.categoryTotals(state.bills))}</article><article class="chart-card"><h3>承担构成</h3><div class="composition"><div class="donut" style="--own-angle:${ownPercent}%"><div class="donut-center"><strong>${ownPercent}%</strong><span>自己承担</span></div></div><div class="legend"><span><i></i>自己 ${Calc.formatMoney(total.own)}</span><span><i></i>同行人 ${Calc.formatMoney(total.other)}</span></div></div></article><article class="chart-card" style="grid-column:1/-1"><h3>每日支出</h3>${barRows(Calc.dailyTotals(state.bills), "#6f91df")}</article>`;
  }

  function importStatus(item) {
    if (item.status === "error") return statusLabel("duplicate", "处理失败");
    if (item.status === "reverted") return statusLabel("excluded", "已撤销");
    if (item.issues) return statusLabel("pending", "需要核对");
    return statusLabel("confirmed", "处理完成");
  }

  function renderImports(state) {
    document.querySelector("#importList").innerHTML = state.imports.length ? state.imports.map((item) => {
      const live = ImportHistory.liveCount(state, item);
      const action = live > 0 && item.status !== "reverted" ? `<button class="danger-text import-remove-action" type="button" data-remove-import="${Calc.escapeHtml(item.id)}">撤销此次导入</button>` : "";
      const order = item.dateOrder === "asc" ? "asc" : "desc";
      const sorting = live > 0 && item.status !== "reverted" && ImportHistory.canSort(state, item) ? `<div class="import-order-control" role="group" aria-label="${Calc.escapeHtml(item.name)}日期排序"><span>日期</span><button type="button" data-import-sort="${Calc.escapeHtml(item.id)}" data-order="asc" aria-pressed="${order === "asc"}" title="最早的账单排在前面">正序</button><button type="button" data-import-sort="${Calc.escapeHtml(item.id)}" data-order="desc" aria-pressed="${order === "desc"}" title="最新的账单排在前面">倒序</button></div>` : "";
      const count = item.status === "reverted" ? `已删除 ${item.removedBills || item.bills || 0} 笔` : `${live} 笔当前账单`;
      return `<article class="import-item"><span class="file-icon">${Calc.escapeHtml(item.type)}</span><div><strong>${Calc.escapeHtml(item.name)}</strong><p>${Calc.escapeHtml(item.date)} · ${Calc.escapeHtml(item.message || "已在浏览器中完成处理")}</p></div>${importStatus(item)}<div class="import-metrics"><strong>${count}</strong><p>本次导入 ${item.bills} 笔 · ${item.issues} 个问题</p></div><div class="import-actions">${sorting}${action}</div></article>`;
    }).join("") : "<div class=\"empty-state\"><strong>还没有导入记录</strong><p>文件会在当前浏览器中解析。</p></div>";
  }

  function renderCategories(state) {
    const select = document.querySelector("#categoryFilter");
    const current = select.value;
    const options = [...new Set(state.bills.map((bill) => bill.category))].sort();
    select.innerHTML = `<option value="all">全部分类</option>${options.map((item) => `<option value="${Calc.escapeHtml(item)}">${Calc.escapeHtml(item)}</option>`).join("")}`;
    select.value = options.includes(current) ? current : "all";
  }

  window.TravelBillUI = { renderTrip, renderProjectHome, renderSummary, renderBills, renderCounts, renderSettlement, renderStats, renderImports, renderCategories };
}());
