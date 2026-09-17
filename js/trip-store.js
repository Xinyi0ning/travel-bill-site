(function () {
  "use strict";

  const Data = window.TravelBillData;
  const Migration = window.TravelBillMigration;
  const clone = (value) => JSON.parse(JSON.stringify(value));

  function createTripId() {
    return `trip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizeTrip(input) {
    const migrated = Migration.migrateState(input).state;
    migrated.id = String(migrated.id || createTripId());
    return migrated;
  }

  function normalizeLibrary(input) {
    const source = input?.library && typeof input.library === "object" ? input.library : input;
    if (source?.schemaVersion === 4 && Array.isArray(source.trips)) {
      if (!source.trips.length) throw new Error("备份中没有旅行项目。");
      const ids = new Set();
      const trips = source.trips.map((trip) => {
        const normalized = normalizeTrip(trip);
        while (ids.has(normalized.id)) normalized.id = createTripId();
        ids.add(normalized.id);
        return normalized;
      });
      const activeTripId = ids.has(source.activeTripId) ? source.activeTripId : trips[0].id;
      return { schemaVersion: 4, activeTripId, trips, updatedAt: Number(source.updatedAt) || Date.now() };
    }
    if (source?.trip && [2, 3].includes(source.schemaVersion)) {
      const trip = normalizeTrip(source);
      return { schemaVersion: 4, activeTripId: trip.id, trips: [trip], updatedAt: Date.now() };
    }
    throw new Error("无法识别这个备份文件的数据格式。");
  }

  function save(library) {
    library.updatedAt = Date.now();
    localStorage.setItem(Data.storageKey, JSON.stringify(library));
  }

  function load() {
    const current = localStorage.getItem(Data.storageKey);
    if (current) {
      try { return normalizeLibrary(JSON.parse(current)); }
      catch (_) { /* Fall back to the untouched legacy data. */ }
    }
    const legacy = localStorage.getItem(Data.legacyStorageKey);
    if (legacy) {
      try {
        const library = normalizeLibrary(JSON.parse(legacy));
        try { save(library); } catch (_) { /* Keep the migrated library in memory if storage is full. */ }
        return library;
      } catch (_) { /* Start with a clean trip if legacy data is damaged. */ }
    }
    const library = normalizeLibrary(clone(Data.initialState));
    try { save(library); } catch (_) { /* The app can still run for this session. */ }
    return library;
  }

  function active(library) {
    return library.trips.find((trip) => trip.id === library.activeTripId) || library.trips[0];
  }

  function replaceActive(library, state) {
    const index = library.trips.findIndex((trip) => trip.id === library.activeTripId);
    if (index >= 0) library.trips[index] = state;
    else library.trips.push(state);
    library.activeTripId = state.id;
  }

  function add(library, state) {
    const trip = normalizeTrip(state);
    if (library.trips.some((item) => item.id === trip.id)) trip.id = createTripId();
    library.trips.push(trip);
    library.activeTripId = trip.id;
    return trip;
  }

  function select(library, tripId) {
    const trip = library.trips.find((item) => item.id === tripId);
    if (!trip) return null;
    library.activeTripId = trip.id;
    return trip;
  }

  function backup(library) {
    return {
      app: "同行账本",
      backupVersion: 1,
      exportedAt: new Date().toISOString(),
      library: clone(library)
    };
  }

  window.TravelBillTripStore = { createTripId, normalizeLibrary, load, save, active, replaceActive, add, select, backup };
}());
