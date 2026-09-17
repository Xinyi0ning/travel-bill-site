(function () {
  "use strict";

  const Calc = window.TravelBillCalc;
  let activeState = null;
  let draftPeople = [];
  let onSave = null;
  let idSequence = 0;

  function syncNames() {
    document.querySelectorAll("#settingsPeople [data-person-name]").forEach((input) => {
      const person = draftPeople.find((item) => item.id === input.dataset.personName);
      if (person && !person.isSelf) person.name = input.value;
    });
  }

  function renderPeople() {
    document.querySelector("#settingsPeople").innerHTML = draftPeople.map((person) => `<div class="participant-setting-row">
      <div><label for="setting-${Calc.escapeHtml(person.id)}">${person.isSelf ? "实付人" : "同行人"}</label><input id="setting-${Calc.escapeHtml(person.id)}" data-person-name="${Calc.escapeHtml(person.id)}" value="${Calc.escapeHtml(person.name)}" ${person.isSelf ? "disabled" : ""} maxlength="30"></div>
      ${person.isSelf ? '<span class="fixed-person-tag">固定</span>' : `<button class="danger-text" type="button" data-remove-person="${Calc.escapeHtml(person.id)}">删除</button>`}
    </div>`).join("");
  }

  function referencesFor(personId) {
    const bills = activeState.bills.filter((bill) => (bill.allocations?.[personId] || 0) > 0
      || bill.allocationPerson === personId || (bill.allocationPeople || []).includes(personId));
    const repayments = activeState.repayments.filter((item) => item.personId === personId);
    return { bills: bills.length, repayments: repayments.length };
  }

  function removePerson(personId) {
    syncNames();
    const person = draftPeople.find((item) => item.id === personId);
    if (!person || person.isSelf) return;
    const references = referencesFor(personId);
    if (references.bills || references.repayments) {
      document.querySelector("#settingsError").textContent = `不能删除${person.name || "该同行人"}：仍有 ${references.bills} 笔账单、${references.repayments} 笔还款引用。`;
      return;
    }
    draftPeople = draftPeople.filter((item) => item.id !== personId);
    document.querySelector("#settingsError").textContent = "";
    renderPeople();
  }

  function addPerson() {
    syncNames();
    idSequence += 1;
    draftPeople.push({ id: `person-${Date.now().toString(36)}-${idSequence}`, name: `同行人 ${draftPeople.filter((person) => !person.isSelf).length + 1}`, isSelf: false });
    document.querySelector("#settingsError").textContent = "";
    renderPeople();
    const inputs = document.querySelectorAll("#settingsPeople [data-person-name]");
    inputs[inputs.length - 1]?.focus();
  }

  function save() {
    syncNames();
    const name = document.querySelector("#settingsTripName").value.trim();
    const destination = document.querySelector("#settingsDestination").value.trim();
    const startDate = document.querySelector("#settingsStartDate").value;
    const endDate = document.querySelector("#settingsEndDate").value;
    const companionNames = draftPeople.filter((person) => !person.isSelf).map((person) => person.name.trim());
    const error = document.querySelector("#settingsError");
    if (!name || !destination || !startDate || !endDate) return void (error.textContent = "请填写旅行名称、旅行地和起止日期。");
    if (startDate > endDate) return void (error.textContent = "结束日期不能早于开始日期。");
    if (!companionNames.length) return void (error.textContent = "请至少保留一位同行人。");
    if (companionNames.some((item) => !item)) return void (error.textContent = "同行人姓名不能为空。");
    const normalized = companionNames.map((item) => item.toLocaleLowerCase("zh-CN"));
    if (new Set(normalized).size !== normalized.length || normalized.includes("我")) return void (error.textContent = "参与人姓名不能重复，也不能使用“我”。");
    draftPeople.forEach((person) => { person.name = person.isSelf ? "我" : person.name.trim(); });
    document.querySelector("#settingsDialog").close();
    onSave({ ...activeState.trip, name, destination, startDate, endDate, participants: draftPeople });
  }

  function open(state, callback) {
    activeState = state;
    onSave = callback;
    draftPeople = JSON.parse(JSON.stringify(state.trip.participants || []));
    document.querySelector("#settingsTripName").value = state.trip.name || "";
    document.querySelector("#settingsDestination").value = state.trip.destination || "";
    document.querySelector("#settingsStartDate").value = state.trip.startDate || "";
    document.querySelector("#settingsEndDate").value = state.trip.endDate || "";
    document.querySelector("#settingsError").textContent = "";
    renderPeople();
    document.querySelector("#settingsDialog").showModal();
  }

  document.querySelector("#settingsPeople").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-person]");
    if (button) removePerson(button.dataset.removePerson);
  });
  document.querySelector("#addCompanion").addEventListener("click", addPerson);
  document.querySelector("#saveSettings").addEventListener("click", save);

  window.TravelBillProjectSettings = { open };
}());
