const DB_NAME = 'hrt-reminders-db';
const STORE_NAME = 'reminders';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('by_time', 'timeMs', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Helper: compute next occurrence of weekday (0=Sun..6=Sat) at HH:MM after given ms
function nextOccurrenceForWeekdayTime(weekday, timeStr, afterMs) {
  const now = new Date(afterMs);
  const parts = (timeStr || '00:00').split(':').map(s => Number(s));
  const hh = parts[0] || 0;
  const mm = parts[1] || 0;
  const target = new Date(now);
  target.setHours(hh, mm, 0, 0);
  let diff = (weekday - target.getDay() + 7) % 7;
  if (diff === 0 && target.getTime() <= afterMs) diff = 7;
  target.setDate(target.getDate() + diff);
  return target;
}

async function getDueReminders(beforeMs) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const idx = store.index('by_time');
    const range = IDBKeyRange.upperBound(beforeMs);
    const res = [];
    const req = idx.openCursor(range);
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return resolve(res);
      const val = cur.value;
      res.push(val);
      // delete so it does not fire again
      cur.delete();

      // If this was a scheduled weekly reminder, create the next week's occurrence
      try {
        if (val && val.source === 'scheduled' && val.meta && typeof val.meta.weekday === 'number' && typeof val.meta.time === 'string') {
          const next = nextOccurrenceForWeekdayTime(Number(val.meta.weekday), val.meta.time, Date.now() + 1000);
          const nextId = `${val.meta.scheduledId}-${val.meta.weekday}-${next.getTime()}`;
          const nextObj = { id: nextId, timeMs: next.getTime(), title: val.title, body: val.body, source: 'scheduled', meta: val.meta };
          try { store.put(nextObj); } catch (e) { console.error('restore next occurrence failed', e); }
        }
      } catch (e) {
        console.error('compute next occurrence failed', e);
      }

      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

async function checkAndNotify() {
  try {
    const now = Date.now();
    // small leeway so we capture entries slightly in the near future (e.g., 1 minute ahead)
    const due = await getDueReminders(now + 60000);
    for (const r of due) {
      const title = r.title || 'HRT Tracker';
      const options = { body: r.body || '', tag: r.id, data: r.meta || {} };
      await self.registration.showNotification(title, options);
    }
  } catch (e) {
    console.error('checkAndNotify failed', e);
  }
}

self.addEventListener('push', function(event) {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { title: 'HRT Tracker', body: event.data ? event.data.text() : 'Notification' };
  }

  const title = payload.title || 'HRT Tracker';
  const options = {
    body: payload.body || '',
    tag: payload.tag || undefined,
    data: payload.data || {}
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('periodicsync', function(event) {
  if (event.tag === 'hrt-reminder-check') {
    event.waitUntil(checkAndNotify());
  }
});

self.addEventListener('message', function(event) {
  try {
    const data = event.data;
    if (data && data.type === 'check-reminders') {
      event.waitUntil(checkAndNotify());
    }
  } catch (e) { }
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(function(clientList) {
      if (clientList.length > 0) {
        return clientList[0].focus();
      }
      return clients.openWindow('/');
    })
  );
});