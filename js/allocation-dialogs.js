(function () {
  "use strict";

  const Calc = window.TravelBillCalc;
  let active = null;

  function participants(state) {
    return state.trip.participants || [];
  }

  function renderChoices(container, people, selectedIds, type) {
    container.innerHTML = people.map((person) => `<label class="person-choice">
      <input type="${type}" name="allocation-person" value="${Calc.escapeHtml(person.id)}" ${selectedIds.includes(person.id) ? "checked" : ""}>
      <span><strong>${Calc.escapeHtml(person.name)}</strong><small>${person.isSelf ? "实付人" : "同行人"}</small></span>
    </label>`).join("");
  }

  function openSelectedAa(bill, state, onSave) {
    const people = participants(state);
    const selected = bill.allocation === "selected-aa" ? (bill.allocationPeople || []) : Object.keys(Calc.allocationMap(bill, people));
    active = { bill, state, onSave, mode: "selected-aa" };
    document.querySelector("#selectedAaTitle").textContent = bill.title;
    document.querySelector("#selectedAaTotal").textContent = Calc.formatMoney(Calc.netAmount(bill));
    document.querySelector("#selectedAaError").textContent = "";
    renderChoices(document.querySelector("#selectedAaPeople"), people, selected, "checkbox");
    document.querySelector("#selectedAaDialog").showModal();
  }

  function saveSelectedAa() {
    if (!active || active.mode !== "selected-aa") return;
    const selectedIds = [...document.querySelectorAll('#selectedAaPeople input:checked')].map((input) => input.value);
    if (!selectedIds.length) return void (document.querySelector("#selectedAaError").textContent = "请至少选择一位承担人。");
    document.querySelector("#selectedAaDialog").close();
    active.onSave({ selectedIds });
  }

  function openPerson(bill, state, onSave) {
    const companions = participants(state).filter((person) => !person.isSelf);
    active = { bill, state, onSave, mode: "person" };
    document.querySelector("#personTitle").textContent = bill.title;
    document.querySelector("#personTotal").textContent = Calc.formatMoney(Calc.netAmount(bill));
    document.querySelector("#personError").textContent = "";
    renderChoices(document.querySelector("#personChoices"), companions, [bill.allocationPerson].filter(Boolean), "radio");
    document.querySelector("#personDialog").showModal();
  }

  function savePerson() {
    if (!active || active.mode !== "person") return;
    const selected = document.querySelector('#personChoices input:checked');
    if (!selected) return void (document.querySelector("#personError").textContent = "请选择一位同行人。");
    document.querySelector("#personDialog").close();
    active.onSave({ personId: selected.value });
  }

  function customValues() {
    return Object.fromEntries([...document.querySelectorAll("#customAllocationFields [data-person-amount]")].map((input) => [
      input.dataset.personAmount,
      Math.round(Number(input.value) * 100)
    ]));
  }

  function updateCustomProgress() {
    if (!active || active.mode !== "custom") return;
    const allocations = customValues();
    const invalid = Object.values(allocations).some((value) => !Number.isFinite(value) || value < 0);
    const allocated = invalid ? 0 : Object.values(allocations).reduce((sum, value) => sum + value, 0);
    const remaining = Calc.netAmount(active.bill) - allocated;
    document.querySelector("#allocatedText").textContent = `已分配 ${Calc.formatMoney(allocated)}`;
    document.querySelector("#remainingText").textContent = `${remaining < 0 ? "超出" : "待分配"} ${Calc.formatMoney(Math.abs(remaining))}`;
    document.querySelector("#remainingText").style.color = !invalid && remaining === 0 ? "var(--green)" : "var(--orange)";
  }

  function openCustom(bill, state, onSave) {
    const people = participants(state);
    const stored = Calc.allocationMap(bill, people);
    const hasStored = Object.values(stored).some((value) => value > 0);
    const allocations = hasStored ? stored : { me: Calc.netAmount(bill) };
    active = { bill, state, onSave, mode: "custom" };
    document.querySelector("#customTitle").textContent = bill.title;
    document.querySelector("#customTotal").textContent = Calc.formatMoney(Calc.netAmount(bill));
    document.querySelector("#customError").textContent = "";
    document.querySelector("#customAllocationFields").innerHTML = people.map((person) => `<label class="allocation-person-row">
      <span>${Calc.escapeHtml(person.name)}</span>
      <span class="money-input"><span>¥</span><input data-person-amount="${Calc.escapeHtml(person.id)}" type="number" min="0" step="0.01" value="${((allocations[person.id] || 0) / 100).toFixed(2)}" required></span>
    </label>`).join("");
    updateCustomProgress();
    document.querySelector("#customDialog").showModal();
  }

  function saveCustom() {
    if (!active || active.mode !== "custom") return;
    const allocations = customValues();
    const values = Object.values(allocations);
    const error = document.querySelector("#customError");
    if (values.some((value) => !Number.isFinite(value) || value < 0)) return void (error.textContent = "请输入有效的非负金额。");
    const allocated = values.reduce((sum, value) => sum + value, 0);
    const difference = Calc.netAmount(active.bill) - allocated;
    if (difference !== 0) return void (error.textContent = `分配金额与净金额相差 ${Calc.formatMoney(Math.abs(difference))}。`);
    document.querySelector("#customDialog").close();
    active.onSave({ allocations });
  }

  function open(mode, bill, state, onSave) {
    if (mode === "selected-aa") openSelectedAa(bill, state, onSave);
    else if (mode === "person") openPerson(bill, state, onSave);
    else if (mode === "custom") openCustom(bill, state, onSave);
  }

  document.querySelector("#saveSelectedAa").addEventListener("click", saveSelectedAa);
  document.querySelector("#savePerson").addEventListener("click", savePerson);
  document.querySelector("#saveCustom").addEventListener("click", saveCustom);
  document.querySelector("#customAllocationFields").addEventListener("input", updateCustomProgress);

  window.TravelBillAllocationDialogs = { open };
}());
