(function () {
  "use strict";

  let workerPromise;
  let progressListener = () => {};

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function localDateTime(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function parseDateFromText(text) {
    const full = text.match(/(20\d{2})[年/.\-](\d{1,2})[月/.\-](\d{1,2})日?(?:\s+|T)?(\d{1,2})?:?(\d{2})?/);
    if (full) return `${full[1]}-${pad(full[2])}-${pad(full[3])}T${pad(full[4] || 0)}:${pad(full[5] || 0)}`;
    const short = text.match(/(?:^|\s)(\d{1,2})[月/.\-](\d{1,2})日?(?:\s+)(\d{1,2}):(\d{2})/);
    if (short) return `${new Date().getFullYear()}-${pad(short[1])}-${pad(short[2])}T${pad(short[3])}:${pad(short[4])}`;
    return "";
  }

  function moneyCandidates(lines) {
    const results = [];
    lines.forEach((line, lineIndex) => {
      const pattern = /(?:¥|￥|RMB\s*)\s*([0-9]{1,8}(?:[,.][0-9]{1,2}))|(?:实付|付款金额|支付金额|订单金额|合计|总计|金额)\s*[:：]?\s*([0-9]{1,8}(?:[,.][0-9]{1,2}))/gi;
      let match;
      while ((match = pattern.exec(line))) {
        const value = Number((match[1] || match[2]).replace(",", "."));
        if (!Number.isFinite(value) || value <= 0) continue;
        let score = 1;
        if (/实付|付款金额|支付金额|合计|总计/.test(line)) score += 5;
        if (/[¥￥]/.test(match[0])) score += 2;
        if (/优惠|减免|原价|退款/.test(line)) score -= 3;
        const context = lines.slice(Math.max(0, lineIndex - 3), Math.min(lines.length, lineIndex + 3)).join(" ");
        results.push({ lineIndex, cents: Math.round(value * 100), line, context, score, date: parseDateFromText(context) });
      }
    });
    const unique = [];
    const seen = new Set();
    results.sort((a, b) => b.score - a.score).forEach((item) => {
      const key = `${item.lineIndex}:${item.cents}`;
      if (!seen.has(key)) { seen.add(key); unique.push(item); }
    });
    return unique;
  }

  function labeledValue(lines, labels) {
    for (let index = 0; index < lines.length; index += 1) {
      const expression = new RegExp(`^(?:${labels.join("|")})\\s*[:：]?\\s*(.*)$`);
      const match = lines[index].match(expression);
      if (!match) continue;
      const value = match[1].trim() || (lines[index + 1] || "").trim();
      if (value && !labels.includes(value)) return value;
    }
    return "";
  }

  function nearbyMerchant(lines, candidate) {
    const start = Math.max(0, candidate.lineIndex - 4);
    for (let index = candidate.lineIndex - 1; index >= start; index -= 1) {
      const line = lines[index];
      if (!line || /支付成功|交易成功|收款成功|账单详情|当前状态|交易时间|付款方式|[¥￥]|\d{1,2}:\d{2}/.test(line)) continue;
      if (line.length >= 2 && line.length <= 50) return line;
    }
    return "";
  }

  function parseRecognizedText(text, fileName, confidence) {
    const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
    const candidates = moneyCandidates(lines);
    if (!candidates.length) return { bills: [], rawText: text, confidence, error: "识别到了文字，但没有找到明确金额。请使用“新增费用”手动补充。" };
    const dated = candidates.filter((item) => item.date);
    const distinctDates = new Set(dated.map((item) => item.date)).size;
    const datedRows = dated.filter((item) => parseDateFromText(item.line)).length;
    const selected = distinctDates >= 2 || datedRows >= 2 ? dated.slice(0, 30) : [candidates[0]];
    const labeledMerchant = labeledValue(lines, ["交易对方", "商户全称", "商户名称", "收款方", "付款给"]);
    const labeledProduct = labeledValue(lines, ["商品", "商品说明", "订单说明", "交易说明"]);
    const bills = selected.map((candidate, index) => {
      const merchant = labeledMerchant || nearbyMerchant(lines, candidate) || "待补充";
      const title = labeledProduct || (merchant !== "待补充" ? merchant : "图片识别费用");
      const date = candidate.date || parseDateFromText(text) || localDateTime(new Date());
      const issues = ["图片识别结果请逐项核对"];
      if (!candidate.date && !parseDateFromText(text)) issues.push("未识别到交易时间，已填入当前时间");
      if (merchant === "待补充") issues.push("未识别到交易对方");
      if (confidence < 80) issues.push("文字识别置信度较低");
      const fingerprint = window.TravelBillParser.hashText(`${fileName}|${date}|${candidate.cents}|${merchant}|${index}`);
      return {
        id: `ocr-${fingerprint}`,
        date,
        title,
        merchant,
        category: window.TravelBillParser.inferCategory(`${merchant} ${title}`),
        amount: candidate.cents,
        refund: 0,
        allocation: "unset",
        status: "pending",
        source: fileName,
        sourceType: "image-ocr",
        transactionId: "",
        paymentStatus: "图片识别",
        note: issues.join("；"),
        confidence: Math.max(0, Math.min(1, confidence / 100)),
        issues,
        originalText: text.slice(0, 12000),
        original: { "OCR 原文": text.slice(0, 12000), "识别置信度": `${confidence.toFixed(1)}%` }
      };
    });
    return { bills, rawText: text, confidence, error: "" };
  }

  async function prepareImage(file) {
    if (!window.createImageBitmap) return file;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(2.5, Math.max(1, 1600 / bitmap.width));
    let width = Math.min(3000, Math.round(bitmap.width * scale));
    let height = Math.round(bitmap.height * (width / bitmap.width));
    const maxPixels = 12000000;
    if (width * height > maxPixels) {
      const reduction = Math.sqrt(maxPixels / (width * height));
      width = Math.max(1, Math.round(width * reduction));
      height = Math.max(1, Math.round(height * reduction));
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const imageData = context.getImageData(0, 0, width, height);
    for (let index = 0; index < imageData.data.length; index += 4) {
      const gray = imageData.data[index] * .299 + imageData.data[index + 1] * .587 + imageData.data[index + 2] * .114;
      const value = Math.max(0, Math.min(255, (gray - 128) * 1.16 + 128));
      imageData.data[index] = value;
      imageData.data[index + 1] = value;
      imageData.data[index + 2] = value;
    }
    context.putImageData(imageData, 0, 0);
    return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob || file), "image/png"));
  }

  async function getWorker(onProgress) {
    progressListener = onProgress || (() => {});
    if (!window.Tesseract) throw new Error("图片识别组件未能加载，请检查网络后重新打开页面。");
    if (!workerPromise) {
      workerPromise = window.Tesseract.createWorker(["chi_sim", "eng"], window.Tesseract.OEM.LSTM_ONLY, {
        logger(message) { progressListener(message); },
        errorHandler(error) { console.error("OCR worker error", error); }
      });
    }
    return workerPromise;
  }

  async function recognizeImage(file, onProgress) {
    try {
      const worker = await getWorker(onProgress);
      const prepared = await prepareImage(file);
      const result = await worker.recognize(prepared);
      return parseRecognizedText(result.data.text || "", file.name, Number(result.data.confidence) || 0);
    } catch (error) {
      workerPromise = undefined;
      throw error;
    }
  }

  window.addEventListener("beforeunload", () => {
    if (workerPromise) workerPromise.then((worker) => worker.terminate()).catch(() => {});
  });

  window.TravelBillOCR = { recognizeImage, parseRecognizedText };
}());
