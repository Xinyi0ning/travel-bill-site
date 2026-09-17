(function () {
  "use strict";

  const Calc = window.TravelBillCalc;

  function allocationName(bill, participants) {
    if (bill.allocation === "self") return "自己承担";
    if (bill.allocation === "all-aa") return `全员 AA · ${participants.length} 人`;
    if (bill.allocation === "selected-aa") {
      const names = (bill.allocationPeople || []).map((id) => participants.find((person) => person.id === id)?.name).filter(Boolean);
      return `${names.join("、")} AA`;
    }
    if (bill.allocation === "person") return `替${participants.find((person) => person.id === bill.allocationPerson)?.name || "同行人"}付`;
    if (bill.allocation === "custom") return "自定义";
    return "待设置";
  }

  function billRows(state) {
    const participants = state.trip.participants || [];
    return state.bills.map((bill) => {
      const allocations = Calc.allocationMap(bill, participants);
      const row = {
        "日期时间": bill.date,
        "费用说明": bill.title,
        "商家": bill.merchant,
        "分类": bill.category,
        "原始金额（元）": bill.amount / 100,
        "退款（元）": (bill.refund || 0) / 100,
        "净金额（元）": Calc.netAmount(bill) / 100,
        "承担方式": allocationName(bill, participants)
      };
      participants.forEach((person) => { row[`${person.name}承担（元）`] = (allocations[person.id] || 0) / 100; });
      row["同行人承担合计（元）"] = Calc.otherShare(bill, participants) / 100;
      row["状态"] = bill.status;
      row["来源"] = bill.source;
      row["备注"] = bill.note || "";
      return row;
    });
  }

  function exportXlsx(state) {
    if (!window.XLSX) throw new Error("Excel 导出组件未能加载，请重新打开页面后再试。");
    const rows = billRows(state);
    const sheet = window.XLSX.utils.json_to_sheet(rows);
    const headers = Object.keys(rows[0] || {});
    sheet["!cols"] = headers.map((header) => ({ wch: header.includes("费用说明") || header.includes("备注") ? 24 : header.includes("来源") ? 20 : 15 }));
    if (sheet["!ref"]) sheet["!autofilter"] = { ref: sheet["!ref"] };
    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, sheet, "账单明细");
    const safeName = (state.trip.name || "旅行账单").replace(/[\\/:*?"<>|]/g, "_");
    window.XLSX.writeFile(workbook, `${safeName}_账单明细.xlsx`, { compression: true });
    return workbook;
  }

  window.TravelBillExporter = { exportXlsx, billRows };
}());
