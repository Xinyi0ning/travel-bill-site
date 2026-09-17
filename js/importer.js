(function () {
  "use strict";

  const IMAGE_PATTERN = /\.(png|jpe?g|webp)$/i;
  const SHEET_PATTERN = /\.(xlsx?|csv)$/i;

  function fileType(file) {
    if (IMAGE_PATTERN.test(file.name) || /^image\//.test(file.type)) return "image";
    if (SHEET_PATTERN.test(file.name)) return "spreadsheet";
    return "unknown";
  }

  function progressLabel(message) {
    const labels = {
      "loading tesseract core": "加载识别引擎",
      "initializing tesseract": "初始化识别引擎",
      "loading language traineddata": "下载中文识别模型",
      "initializing api": "准备文字识别",
      "recognizing text": "识别图片文字"
    };
    return labels[message.status] || "处理图片";
  }

  async function processFile(file, callbacks) {
    const kind = fileType(file);
    if (kind === "unknown") throw new Error("不支持这个文件类型。请选择 XLSX、XLS、CSV、PNG、JPG 或 WebP。");
    if (kind === "spreadsheet") {
      callbacks.onProgress({ label: "读取表格结构", progress: .25 });
      const parsed = await window.TravelBillParser.parseSpreadsheet(file);
      callbacks.onProgress({ label: "整理交易记录", progress: 1 });
      return { kind, ...parsed };
    }
    const parsed = await window.TravelBillOCR.recognizeImage(file, (message) => {
      callbacks.onProgress({ label: progressLabel(message), progress: Number(message.progress) || 0 });
    });
    return { kind, ...parsed, stats: { totalRows: parsed.bills.length, expenses: parsed.bills.length, invalid: parsed.error ? 1 : 0 } };
  }

  async function processFiles(fileList, callbacks = {}) {
    const files = [...fileList];
    const results = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      callbacks.onFileStart?.({ file, index, total: files.length });
      try {
        const result = await processFile(file, { onProgress: (progress) => callbacks.onProgress?.({ ...progress, file, index, total: files.length }) });
        const output = { ok: true, file, ...result };
        results.push(output);
        callbacks.onFileComplete?.(output);
      } catch (error) {
        const output = { ok: false, file, error: error instanceof Error ? error.message : String(error) };
        results.push(output);
        callbacks.onFileError?.(output);
      }
    }
    callbacks.onComplete?.(results);
    return results;
  }

  window.TravelBillImporter = { processFiles, fileType };
}());
