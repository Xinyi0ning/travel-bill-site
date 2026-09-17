(function () {
  "use strict";

  const Calc = window.TravelBillCalc;

  function field(bill, context = "明细") {
    const title = Calc.escapeHtml(bill.title);
    return `<input class="inline-note" type="text" maxlength="200" data-note-id="${Calc.escapeHtml(bill.id)}" value="${Calc.escapeHtml(bill.note || "")}" placeholder="＋ 添加备注" aria-label="${title}${context}备注">`;
  }

  function bind(onSave) {
    document.addEventListener("change", (event) => {
      const input = event.target.closest("[data-note-id]");
      if (!input) return;
      const note = input.value.trim();
      document.querySelectorAll(`[data-note-id="${CSS.escape(input.dataset.noteId)}"]`).forEach((item) => { item.value = note; });
      onSave(input.dataset.noteId, note);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target.matches("[data-note-id]")) {
        event.preventDefault();
        event.target.blur();
      }
    });
  }

  window.TravelBillInlineNotes = { field, bind };
}());
