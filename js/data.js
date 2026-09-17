(function () {
  "use strict";

  window.TravelBillData = {
    storageKey: "travel-bill-local-v4",
    legacyStorageKey: "travel-bill-local-v2",
    initialState: {
      schemaVersion: 3,
      trip: {
        name: "旅行账单",
        destination: "",
        startDate: "",
        endDate: "",
        participants: [
          { id: "me", name: "我", isSelf: true },
          { id: "xiaoyang", name: "小羊", isSelf: false },
          { id: "chenjie", name: "陈姐", isSelf: false }
        ]
      },
      bills: [],
      imports: [],
      repayments: [],
      updatedAt: Date.now()
    }
  };
}());
