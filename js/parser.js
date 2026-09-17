(function () {
  "use strict";

  const HEADER_ALIASES = {
    date: ["交易时间", "交易日期", "时间"],
    type: ["交易类型", "交易分类", "类型"],
    merchant: ["交易对方", "商家名称", "交易对象", "对方名称", "收款方"],
    product: ["商品", "商品说明", "商品名称", "用途", "交易说明"],
    flow: ["收/支", "收支", "交易方向"],
    amount: ["金额(元)", "金额（元）", "交易金额", "金额"],
    method: ["支付方式", "收/付款方式", "付款方式"],
    status: ["当前状态", "交易状态", "状态"],
    transactionId: ["交易单号", "交易订单号", "交易号", "订单号"],
    merchantId: ["商户单号", "商家订单号", "商户订单号"],
    note: ["备注", "交易备注"]
  };

  const CATEGORY_RULES = [
    ["餐饮", /餐厅|餐饮|饭店|咖啡|奶茶|火锅|烧烤|外卖|饿了么|便利店|超市|食品|小吃|水饺|饮品|7-?eleven|可好/i],
    ["交通", /滴滴|哈啰|高德|出租|打车|顺风车|地铁|公交|铁路|火车|航空|机场|客运|加油|停车|车票|机票|船票/i],
    ["住宿", /酒店|宾馆|客栈|民宿|住宿|旅馆|公寓/i],
    ["餐饮", /美团|大众点评/i],
    ["门票", /门票|景区|博物馆|乐园|动物园|展览|票务/i],
    ["购物", /淘宝|京东|拼多多|百货|商场|服饰|珠宝|珍珠|纪念品|商店|零售/i],
    ["娱乐", /电影|影院|酒吧|KTV|娱乐|演出|桌游|按摩|足疗/i]
  ];

  function clean(value) {
    return String(value ?? "").replace(/^\ufeff/, "").trim();
  }

  function normalizeHeader(value) {
    return clean(value).replace(/[\s：:]/g, "").toLowerCase();
  }

  function parseMoney(value) {
    if (typeof value === "number") return Math.round(Math.abs(value) * 100);
    const number = Number(clean(value).replace(/[¥￥元,\s]/g, "").replace(/^\+/, ""));
    return Number.isFinite(number) ? Math.round(Math.abs(number) * 100) : null;
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function dateFromSerial(serial) {
    const epoch = Date.UTC(1899, 11, 30);
    const date = new Date(epoch + Number(serial) * 86400000);
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  }

  function normalizeDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
    }
    if (typeof value === "number" && value > 20000) return dateFromSerial(value);
    const text = clean(value).replace(/[年/.]/g, "-").replace(/月/g, "-").replace(/日/g, " ").replace(/\s+/g, " ");
    const match = text.match(/(20\d{2})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::\d{2})?)?/);
    if (!match) return "";
    return `${match[1]}-${pad(match[2])}-${pad(match[3])}T${pad(match[4] || 0)}:${pad(match[5] || 0)}`;
  }

  function hashText(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function inferCategory(text) {
    const rule = CATEGORY_RULES.find(([, pattern]) => pattern.test(text));
    return rule ? rule[0] : "其他";
  }

  function findHeaderRow(rows) {
    let best = { index: -1, score: 0 };
    rows.slice(0, 80).forEach((row, index) => {
      const values = row.map(normalizeHeader);
      const score = Object.values(HEADER_ALIASES).reduce((sum, aliases) => sum + (aliases.some((alias) => values.includes(normalizeHeader(alias))) ? 1 : 0), 0);
      if (score > best.score) best = { index, score };
    });
    return best.score >= 3 ? best.index : -1;
  }

  function makeColumnMap(headers) {
    const normalized = headers.map(normalizeHeader);
    return Object.fromEntries(Object.entries(HEADER_ALIASES).map(([field, aliases]) => {
      const index = normalized.findIndex((header) => aliases.some((alias) => header === normalizeHeader(alias)));
      return [field, index];
    }));
  }

  function readCell(row, columnMap, field) {
    const index = columnMap[field];
    return index >= 0 ? row[index] : "";
  }

  function isFailedStatus(status) {
    return /交易关闭|支付失败|已撤销|已取消|未支付|退款成功/.test(status) && !/已全额退款|部分退款/.test(status);
  }

  function refundFromStatus(status, amount) {
    if (/已全额退款/.test(status)) return amount;
    const match = status.match(/(?:已退款|部分退款|退款金额)[^0-9]*([0-9]+(?:[.,][0-9]{1,2})?)/);
    if (!match) return 0;
    const cents = Math.round(Number(match[1].replace(",", ".")) * 100);
    return Number.isFinite(cents) ? Math.min(amount, cents) : 0;
  }

  function rowToBill(row, columns, context) {
    const date = normalizeDate(readCell(row, columns, "date"));
    const type = clean(readCell(row, columns, "type"));
    const merchant = clean(readCell(row, columns, "merchant"));
    const product = clean(readCell(row, columns, "product"));
    const flow = clean(readCell(row, columns, "flow"));
    const amount = parseMoney(readCell(row, columns, "amount"));
    const paymentStatus = clean(readCell(row, columns, "status"));
    const transactionId = clean(readCell(row, columns, "transactionId"));
    const merchantId = clean(readCell(row, columns, "merchantId"));
    const note = clean(readCell(row, columns, "note"));
    const method = clean(readCell(row, columns, "method"));
    const isIncome = /收入|收款/.test(flow);
    const isRefundIncome = isIncome && /退款/.test(`${type} ${paymentStatus}`);
    const isNeutral = flow === "/" || (!/支出|付款|收入|收款/.test(flow)) || /中性|不计收支|其他/.test(flow);
    if (!date || !amount || isIncome || isNeutral) {
      return { skip: true, reason: isRefundIncome ? "refund-income" : isIncome ? "income" : isNeutral ? "neutral" : "invalid" };
    }
    const refund = refundFromStatus(paymentStatus, amount);
    const refunded = refund === amount;
    const partiallyRefunded = refund > 0 && refund < amount;
    const transfer = /转账|红包/.test(type);
    const failed = isFailedStatus(paymentStatus);
    const title = product && !/^(订单支付|商户单号|商品)$/.test(product) ? product : (merchant || type || "未命名费用");
    const searchable = `${merchant} ${product} ${type}`;
    const issues = [];
    if (transfer) issues.push("转账用途需要确认");
    if (refunded) issues.push("已全额退款，请核对退款归属");
    if (partiallyRefunded) issues.push(`已退款 ¥${(refund / 100).toFixed(2)}，请核对退款归属`);
    if (!merchant) issues.push("交易对方缺失");
    const rawFields = { "交易时间": date, "交易类型": type, "交易对方": merchant, "商品": product, "收/支": flow, "金额": amount / 100, "支付方式": method, "当前状态": paymentStatus, "交易单号": transactionId, "商户单号": merchantId, "备注": note };
    const fingerprint = transactionId || hashText(`${date}|${amount}|${merchant}|${product}`);
    return {
      bill: {
        id: `bill-${fingerprint}`,
        date,
        title,
        merchant: merchant || "待补充",
        category: inferCategory(searchable),
        amount,
        refund,
        allocation: "unset",
        status: failed ? "excluded" : "pending",
        source: context.fileName,
        sourceType: context.sourceType,
        transactionId,
        merchantId,
        paymentStatus,
        note: [note === "/" ? "" : note, ...issues].filter(Boolean).join("；"),
        confidence: 1,
        issues,
        original: rawFields
      }
    };
  }

  function selectWorksheet(workbook) {
    let fallback;
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
      fallback ||= { name, rows };
      if (findHeaderRow(rows) >= 0) return { name, rows };
    }
    return fallback;
  }

  function decodeCsvBuffer(buffer) {
    const bytes = new Uint8Array(buffer);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (_) {
      try {
        return new TextDecoder("gb18030", { fatal: true }).decode(bytes);
      } catch (_) {
        throw new Error("CSV 文件编码无法识别，请使用 UTF-8、GBK 或 GB18030 编码。");
      }
    }
  }

  function parseWorkbookBuffer(buffer, fileName) {
    if (!window.XLSX) throw new Error("表格解析组件未能加载，请重新打开页面后再试。");
    const isCsv = /\.csv$/i.test(fileName || "");
    const workbook = isCsv
      ? window.XLSX.read(decodeCsvBuffer(buffer), { type: "string", cellDates: true })
      : window.XLSX.read(buffer, { type: "array", cellDates: true });
    const selected = selectWorksheet(workbook);
    if (!selected) throw new Error("文件中没有可读取的工作表。");
    const headerIndex = findHeaderRow(selected.rows);
    if (headerIndex < 0) throw new Error("未找到交易时间、金额等账单表头；请确认文件是微信或支付宝导出的明细。");
    const columns = makeColumnMap(selected.rows[headerIndex]);
    if (columns.date < 0 || columns.amount < 0) throw new Error("账单缺少交易时间或金额列。");
    const stats = { totalRows: 0, expenses: 0, income: 0, refundIncome: 0, neutral: 0, invalid: 0, excluded: 0 };
    const bills = [];
    selected.rows.slice(headerIndex + 1).forEach((row) => {
      if (!row.some((cell) => clean(cell))) return;
      stats.totalRows += 1;
      const result = rowToBill(row, columns, { fileName, sourceType: "spreadsheet" });
      if (result.skip) {
        if (result.reason === "refund-income") stats.refundIncome += 1;
        else if (result.reason === "income") stats.income += 1;
        else if (result.reason === "neutral") stats.neutral += 1;
        else stats.invalid += 1;
        return;
      }
      bills.push(result.bill);
      stats.expenses += 1;
      if (result.bill.status === "excluded") stats.excluded += 1;
    });
    if (!bills.length) throw new Error("识别到表头，但没有找到可导入的支出记录。");
    return { bills, stats, sheetName: selected.name, headerRow: headerIndex + 1 };
  }

  async function parseSpreadsheet(file) {
    return parseWorkbookBuffer(await file.arrayBuffer(), file.name);
  }

  window.TravelBillParser = { parseSpreadsheet, parseWorkbookBuffer, inferCategory, normalizeDate, parseMoney, hashText, refundFromStatus };
}());
