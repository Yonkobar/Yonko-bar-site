var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// vendor/uint8array-extras/index.js
var objectToString = Object.prototype.toString;
var uint8ArrayStringified = "[object Uint8Array]";
function isType(value, typeConstructor, typeStringified) {
  if (!value) {
    return false;
  }
  if (value.constructor === typeConstructor) {
    return true;
  }
  return objectToString.call(value) === typeStringified;
}
__name(isType, "isType");
function isUint8Array(value) {
  return isType(value, Uint8Array, uint8ArrayStringified);
}
__name(isUint8Array, "isUint8Array");
function assertUint8Array(value) {
  if (!isUint8Array(value)) {
    throw new TypeError(`Expected \`Uint8Array\`, got \`${typeof value}\``);
  }
}
__name(assertUint8Array, "assertUint8Array");
function toUint8Array(value) {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError(`Unsupported value, got \`${typeof value}\`.`);
}
__name(toUint8Array, "toUint8Array");
function concatUint8Arrays(arrays, totalLength) {
  if (arrays.length === 0) {
    return new Uint8Array(0);
  }
  totalLength ??= arrays.reduce((accumulator, currentValue) => accumulator + currentValue.length, 0);
  const returnValue = new Uint8Array(totalLength);
  let offset = 0;
  for (const array of arrays) {
    assertUint8Array(array);
    returnValue.set(array, offset);
    offset += array.length;
  }
  return returnValue;
}
__name(concatUint8Arrays, "concatUint8Arrays");
var cachedDecoders = {
  utf8: new globalThis.TextDecoder("utf8")
};
function assertString(value) {
  if (typeof value !== "string") {
    throw new TypeError(`Expected \`string\`, got \`${typeof value}\``);
  }
}
__name(assertString, "assertString");
var cachedEncoder = new globalThis.TextEncoder();
function stringToUint8Array(string) {
  assertString(string);
  return cachedEncoder.encode(string);
}
__name(stringToUint8Array, "stringToUint8Array");
function base64ToBase64Url(base64) {
  return base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
__name(base64ToBase64Url, "base64ToBase64Url");
function base64UrlToBase64(base64url) {
  const base64 = base64url.replaceAll("-", "+").replaceAll("_", "/");
  const padding = (4 - base64.length % 4) % 4;
  return base64 + "=".repeat(padding);
}
__name(base64UrlToBase64, "base64UrlToBase64");
var MAX_BLOCK_SIZE = 65535;
function uint8ArrayToBase64(array, { urlSafe = false } = {}) {
  assertUint8Array(array);
  let base64 = "";
  for (let index = 0; index < array.length; index += MAX_BLOCK_SIZE) {
    const chunk = array.subarray(index, index + MAX_BLOCK_SIZE);
    base64 += globalThis.btoa(String.fromCodePoint.apply(void 0, chunk));
  }
  return urlSafe ? base64ToBase64Url(base64) : base64;
}
__name(uint8ArrayToBase64, "uint8ArrayToBase64");
function base64ToUint8Array(base64String) {
  assertString(base64String);
  return Uint8Array.from(globalThis.atob(base64UrlToBase64(base64String)), (x) => x.codePointAt(0));
}
__name(base64ToUint8Array, "base64ToUint8Array");
var byteToHexLookupTable = Array.from({ length: 256 }, (_, index) => index.toString(16).padStart(2, "0"));

// vendor/web-push/utils.js
function encodeRecordSize(size) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, size);
  return bytes;
}
__name(encodeRecordSize, "encodeRecordSize");
function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
__name(invariant, "invariant");

// vendor/web-push/client-keys.js
async function deriveClientKeys(sub) {
  const bytes = base64ToUint8Array(sub.keys.p256dh);
  const authSecretBytes = base64ToUint8Array(sub.keys.auth);
  invariant(bytes.byteLength === 65 && bytes[0] === 4, "Subscription p256dh is not an uncompressed P-256 point");
  invariant(authSecretBytes.byteLength === 16, "Subscription auth secret is not 16 bytes");
  return {
    publicKeyBytes: bytes,
    publicKey: await crypto.subtle.importKey("raw", bytes, {
      name: "ECDH",
      namedCurve: "P-256"
    }, false, []),
    authSecretBytes
  };
}
__name(deriveClientKeys, "deriveClientKeys");

// vendor/web-push/hkdf.js
function createHMAC(data) {
  const keyPromise = crypto.subtle.importKey("raw", data, {
    name: "HMAC",
    hash: "SHA-256"
  }, false, ["sign"]);
  return {
    hash: /* @__PURE__ */ __name(async (input) => {
      const k = await keyPromise;
      return crypto.subtle.sign("HMAC", k, input);
    }, "hash")
  };
}
__name(createHMAC, "createHMAC");
async function hkdf(salt, ikm) {
  const prkhPromise = createHMAC(salt).hash(ikm).then((prk) => createHMAC(prk));
  return {
    extract: /* @__PURE__ */ __name(async (info, len) => {
      const prkh = await prkhPromise;
      const blocks = await Array.from({ length: Math.ceil(len / 32) }, (_, i) => i).reduce(async (acc, i) => {
        const previous = await acc;
        const hash = await prkh.hash(new Uint8Array([...previous.at(-1) ?? [], ...info, i + 1]));
        return [...previous, new Uint8Array(hash)];
      }, Promise.resolve([]));
      return concatUint8Arrays(blocks).slice(0, len);
    }, "extract")
  };
}
__name(hkdf, "hkdf");

// vendor/web-push/info.js
function createKeyInfo(clientPublic, serverPublic) {
  return new Uint8Array([
    ...stringToUint8Array("WebPush: info\0"),
    ...clientPublic,
    ...serverPublic
  ]);
}
__name(createKeyInfo, "createKeyInfo");
function createInfo(type) {
  return stringToUint8Array(`Content-Encoding: ${type}\0`);
}
__name(createInfo, "createInfo");

// vendor/web-push/local-keys.js
async function generateLocalKeys() {
  const keyPair = await crypto.subtle.generateKey({
    name: "ECDH",
    namedCurve: "P-256"
  }, false, ["deriveBits"]);
  return {
    privateKey: keyPair.privateKey,
    publicKeyBytes: new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey))
  };
}
__name(generateLocalKeys, "generateLocalKeys");

// vendor/web-push/salt.js
async function getSalt() {
  return crypto.getRandomValues(new Uint8Array(16));
}
__name(getSalt, "getSalt");

// vendor/web-push/encrypt.js
var recordSize = 4096;
var headerSize = 21 + 65;
var maxPlaintextSize = recordSize - headerSize - 17;
async function encryptNotification(subscription, plaintext, options = {}) {
  invariant(plaintext.byteLength <= maxPlaintextSize, `Payload is ${plaintext.byteLength} bytes, the maximum is ${maxPlaintextSize}`);
  const clientKeys = await deriveClientKeys(subscription);
  const salt = await getSalt();
  const localKeys = await generateLocalKeys();
  const sharedSecret = await crypto.subtle.deriveBits({
    name: "ECDH",
    public: clientKeys.publicKey
  }, localKeys.privateKey, 256);
  const keyInfo = createKeyInfo(clientKeys.publicKeyBytes, localKeys.publicKeyBytes);
  const cekInfo = createInfo("aes128gcm");
  const nonceInfo = createInfo("nonce");
  const ikmHkdf = await hkdf(clientKeys.authSecretBytes, sharedSecret);
  const ikm = await ikmHkdf.extract(keyInfo, 32);
  const messageHkdf = await hkdf(salt, ikm);
  const cekBytes = await messageHkdf.extract(cekInfo, 16);
  const nonceBytes = await messageHkdf.extract(nonceInfo, 12);
  const cekCryptoKey = await crypto.subtle.importKey("raw", cekBytes, {
    name: "AES-GCM",
    length: 128
  }, false, ["encrypt"]);
  const padTo = options.pad ?? true ? maxPlaintextSize : plaintext.byteLength;
  const padded = new Uint8Array(padTo + 1);
  padded.set(plaintext);
  padded[plaintext.byteLength] = 2;
  const encrypted = await crypto.subtle.encrypt({
    name: "AES-GCM",
    iv: nonceBytes
  }, cekCryptoKey, padded);
  return new Uint8Array([
    ...salt,
    ...encodeRecordSize(recordSize),
    localKeys.publicKeyBytes.byteLength,
    ...localKeys.publicKeyBytes,
    ...new Uint8Array(encrypted)
  ]);
}
__name(encryptNotification, "encryptNotification");

// vendor/web-push/base64.js
function encodeBase64Url(value) {
  return uint8ArrayToBase64(toUint8Array(value), { urlSafe: true });
}
__name(encodeBase64Url, "encodeBase64Url");
function objectToBase64Url(obj) {
  return encodeBase64Url(stringToUint8Array(JSON.stringify(obj)));
}
__name(objectToBase64Url, "objectToBase64Url");

// vendor/web-push/jwt.js
async function sign(payload, key) {
  const headerStr = objectToBase64Url({
    typ: "JWT",
    alg: "ES256"
  });
  const payloadStr = objectToBase64Url({
    iat: Math.floor(Date.now() / 1e3),
    ...payload
  });
  const dataStr = `${headerStr}.${payloadStr}`;
  const signature = await crypto.subtle.sign({
    name: "ECDSA",
    hash: "SHA-256"
  }, key, stringToUint8Array(dataStr));
  return `${dataStr}.${encodeBase64Url(signature)}`;
}
__name(sign, "sign");

// vendor/web-push/vapid.js
async function vapidHeaders(subscription, vapid) {
  invariant(vapid.subject, "Vapid subject is empty");
  invariant(vapid.privateKey, "Vapid private key is empty");
  invariant(vapid.publicKey, "Vapid public key is empty");
  const endpoint = new URL(subscription.endpoint);
  invariant(endpoint.protocol === "https:", `Subscription endpoint is not https: ${endpoint.protocol}`);
  const vapidPublicKeyBytes = base64ToUint8Array(vapid.publicKey);
  const publicKey = await crypto.subtle.importKey("jwk", {
    kty: "EC",
    crv: "P-256",
    x: encodeBase64Url(vapidPublicKeyBytes.slice(1, 33)),
    y: encodeBase64Url(vapidPublicKeyBytes.slice(33, 65)),
    d: vapid.privateKey
  }, {
    name: "ECDSA",
    namedCurve: "P-256"
  }, false, ["sign"]);
  const jwt = await sign({
    aud: endpoint.origin,
    exp: Math.floor(Date.now() / 1e3) + 12 * 60 * 60,
    sub: vapid.subject
  }, publicKey);
  return {
    headers: {
      authorization: `vapid t=${jwt}, k=${vapid.publicKey}`
    }
  };
}
__name(vapidHeaders, "vapidHeaders");

// vendor/web-push/payload.js
async function buildPushPayload(message, subscription, vapid) {
  const { headers } = await vapidHeaders(subscription, vapid);
  const body = await encryptNotification(subscription, stringToUint8Array(
    // if its a primitive, convert to string, otherwise stringify
    typeof message.data === "string" || typeof message.data === "number" ? message.data.toString() : JSON.stringify(message.data)
  ));
  return {
    headers: {
      ...headers,
      ttl: (message.options?.ttl || 60).toString(),
      ...message.options?.urgency && {
        urgency: message.options.urgency
      },
      ...message.options?.topic && {
        topic: message.options.topic
      },
      "content-encoding": "aes128gcm",
      "content-length": body.byteLength.toString(),
      "content-type": "application/octet-stream"
    },
    method: "post",
    body
  };
}
__name(buildPushPayload, "buildPushPayload");

// core.js
function parisClock(time) {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(time));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
__name(parisClock, "parisClock");
function validateSubscription(value) {
  if (!value || typeof value.endpoint !== "string" || value.endpoint.length > 2048) return false;
  try {
    const u = new URL(value.endpoint);
    const allowed = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"];
    if (u.protocol !== "https:" || u.port || u.username || u.password || u.hash || !allowed.includes(u.hostname)) return false;
    const decode = /* @__PURE__ */ __name((s, length) => typeof s === "string" && /^[A-Za-z0-9_-]+$/.test(s) && atob(s.replace(/-/g, "+").replace(/_/g, "/")).length === length, "decode");
    return decode(value.keys?.p256dh, 65) && decode(value.keys?.auth, 16);
  } catch {
    return false;
  }
}
__name(validateSubscription, "validateSubscription");
function summary(entries, date) {
  const today = entries.filter((e) => e.date === date && e.status !== "declined");
  const accepted = today.filter((e) => e.status === "accepted").length;
  const pending = today.filter((e) => e.status === "pending").length;
  const guests = today.reduce((n, e) => n + Math.max(0, parseInt(e.guests, 10) || 0), 0);
  return {
    title: "Yonko Bar \xB7 R\xE9cap de 14 h",
    body: `${today.length} r\xE9servation(s) aujourd\u2019hui \xB7 ${accepted} accept\xE9e(s) \xB7 ${pending} en attente \xB7 ${guests} personne(s).`,
    tag: `daily-${date}`,
    url: "/dashboard"
  };
}
__name(summary, "summary");
async function reservationKeys(kv) {
  let cursor;
  const names = [];
  do {
    const page = await kv.list({ prefix: "res:", ...cursor ? { cursor } : {} });
    names.push(...page.keys.filter((k) => k.name !== "res:index").map((k) => k.name));
    cursor = page.list_complete ? void 0 : page.cursor;
  } while (cursor);
  return names;
}
__name(reservationKeys, "reservationKeys");
async function readReservations(kv, keys) {
  const entries = [];
  for (let i = 0; i < keys.length; i += 20) {
    const batch = await Promise.all(keys.slice(i, i + 20).map(async (key) => {
      const raw = await kv.get(key);
      if (!raw) return null;
      return { key, entry: JSON.parse(raw) };
    }));
    entries.push(...batch.filter(Boolean));
  }
  return entries;
}
__name(readReservations, "readReservations");

// worker.js
var json = /* @__PURE__ */ __name((data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } }), "json");
var ready = /* @__PURE__ */ __name((env) => !!(env.RESERVATIONS && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT && env.DASHBOARD_KEY && env.APP_ORIGIN), "ready");
var worker_default = {
  async fetch(request, env) {
    env = normalizePushEnv(env);
    if (!ready(env)) return json({ error: "Notifications non configur\xE9es sur le serveur." }, 503);
    if (!request.headers.get("x-dashboard-key") || request.headers.get("x-dashboard-key") !== env.DASHBOARD_KEY) return json({ error: "Acc\xE8s refus\xE9." }, 401);
    if (request.headers.get("x-app-origin") !== env.APP_ORIGIN) return json({ error: "Origine de l\u2019application incorrecte." }, 403);
    return env.PUSH_STATE.get(env.PUSH_STATE.idFromName("yonko-push")).fetch(request);
  },
  async scheduled(controller, env, ctx) {
    env = normalizePushEnv(env);
    if (!ready(env)) throw new Error("Push configuration incomplete");
    ctx.waitUntil((async () => {
      const res = await env.PUSH_STATE.get(env.PUSH_STATE.idFromName("yonko-push")).fetch("https://internal/tick", {
        method: "POST",
        body: JSON.stringify({ time: controller.scheduledTime })
      });
      if (!res.ok) throw new Error(`Push tick failed: ${res.status}`);
    })());
  }
};
var PushState = class {
  static {
    __name(this, "PushState");
  }
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = normalizePushEnv(env);
    this.queue = Promise.resolve();
  }
  fetch(request) {
    const job = this.queue.then(() => this.handle(request));
    this.queue = job.catch(() => {
    });
    return job;
  }
  async load() {
    const meta = await this.ctx.storage.get("state");
    if (!meta) return { subscriptions: {}, seen: {}, jobs: {}, startedAt: Date.now(), lastDaily: null };
    const state = { ...meta, subscriptions: {}, seen: {}, jobs: {} };
    for (const name of ["subscriptions", "seen", "jobs"]) {
      for (let i = 0; i < (meta.chunks?.[name] || 0); i++) Object.assign(state[name], Object.fromEntries(await this.ctx.storage.get(`${name}:${i}`) || []));
    }
    delete state.chunks;
    return state;
  }
  async save(s) {
    await this.ctx.storage.transaction(async (tx) => {
      const previous = await tx.get("state");
      const { subscriptions, seen, jobs, ...meta } = s;
      meta.chunks = {};
      for (const [name, values] of Object.entries({ subscriptions, seen, jobs })) {
        const items = Object.entries(values);
        const count = Math.ceil(items.length / 40);
        meta.chunks[name] = count;
        for (let i = 0; i < count; i++) await tx.put(`${name}:${i}`, items.slice(i * 40, (i + 1) * 40));
        for (let i = count; i < (previous?.chunks?.[name] || 0); i++) await tx.delete(`${name}:${i}`);
      }
      await tx.put("state", meta);
    });
  }
  async handle(request) {
    const path = new URL(request.url).pathname;
    const state = await this.load();
    if (path === "/config" && request.method === "GET") {
      return json({
        publicKey: this.env.VAPID_PUBLIC_KEY,
        quoteAcceptanceDetectable: false,
        lastTick: state.lastTick || null,
        lastDaily: state.lastDaily
      });
    }
    if (path === "/event" && request.method === "POST") {
      let event;
      try {
        event = await request.json();
      } catch {
        return json({ error: "Invalid event" }, 400);
      }
      if (!/^[a-zA-Z0-9-]{1,100}$/.test(event.id || "") || !Number.isFinite(event.createdAt)) return json({ error: "Invalid event" }, 400);
      const key = `res:${event.id}`;
      if (!state.seen[key]) {
        const id = `new-${await digest(key)}`;
        this.enqueue(state, id, { title: "Yonko Bar \xB7 Nouvelle r\xE9servation", body: "Une nouvelle demande est disponible dans votre tableau de bord.", tag: id, url: "/dashboard" });
        state.seen[key] = true;
        await this.save(state);
        await this.deliver(state);
      }
      return json({ ok: true });
    }
    if (path === "/subscription" && ["POST", "DELETE"].includes(request.method)) {
      let sub;
      try {
        sub = await request.json();
      } catch {
        return json({ error: "Abonnement invalide." }, 400);
      }
      if (!validateSubscription(sub)) return json({ error: "Abonnement ou fournisseur push non pris en charge." }, 400);
      const id = await digest(sub.endpoint);
      if (request.method === "DELETE") {
        delete state.subscriptions[id];
        for (const [k, job] of Object.entries(state.jobs)) if (job.subId === id) delete state.jobs[k];
      } else {
        if (!state.subscriptions[id] && Object.keys(state.subscriptions).length >= 50) return json({ error: "Limite de 50 appareils atteinte." }, 409);
        if (!state.initialized) {
          for (const key of await reservationKeys(this.env.RESERVATIONS)) state.seen[key] = true;
          state.initialized = true;
        }
        state.subscriptions[id] = { endpoint: sub.endpoint, keys: sub.keys, expirationTime: sub.expirationTime || null };
      }
      await this.save(state);
      return json({ ok: true });
    }
    if (path === "/test" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Abonnement manquant." }, 400);
      }
      if (typeof body.endpoint !== "string") return json({ error: "Abonnement manquant." }, 400);
      const id = await digest(body.endpoint);
      if (!state.subscriptions[id]) return json({ error: "Activez les notifications sur cet appareil." }, 404);
      const tag = `test-${crypto.randomUUID()}`;
      this.enqueue(state, tag, { title: "Yonko Bar \xB7 Test push", body: "Le serveur a envoy\xE9 cette notification.", url: "/dashboard", tag }, [id]);
      await this.save(state);
      await this.deliver(state);
      return json({ ok: true, queued: Object.values(state.jobs).some((j) => j.payload.tag === tag) });
    }
    if (path === "/tick" && request.method === "POST") {
      const { time } = await request.json();
      if (!Number.isFinite(time)) return json({ error: "Invalid time" }, 400);
      await this.tick(state, time);
      return json({ ok: true });
    }
    return json({ error: "Not found" }, 404);
  }
  enqueue(state, eventId, payload, ids = Object.keys(state.subscriptions)) {
    for (const subId of ids) {
      const key = `${eventId}:${subId}`;
      state.jobs[key] ??= { subId, payload, attempts: 0, next: 0, expires: Date.now() + 864e5 };
    }
  }
  async tick(state, time) {
    const keys = await reservationKeys(this.env.RESERVATIONS);
    const isFirst = !state.initialized;
    if (isFirst) {
      for (const k of keys) state.seen[k] = true;
      state.initialized = true;
    } else {
      const unseen = keys.filter((k) => !state.seen[k]);
      for (const { key, entry } of await readReservations(this.env.RESERVATIONS, unseen)) {
        if (Number(entry.createdAt) >= state.startedAt) {
          const id = `new-${await digest(key)}`;
          this.enqueue(state, id, {
            title: "Yonko Bar \xB7 Nouvelle r\xE9servation",
            body: "Une nouvelle demande est disponible dans votre tableau de bord.",
            tag: id,
            url: "/dashboard"
          });
        }
        state.seen[key] = true;
      }
    }
    const { date, hour } = parisClock(time);
    if (hour === 14 && state.lastDaily !== date) {
      const records = await readReservations(this.env.RESERVATIONS, keys);
      this.enqueue(state, `daily-${date}`, summary(records.map((r) => r.entry), date));
      state.lastDaily = date;
    }
    state.lastTick = new Date(time).toISOString();
    await this.save(state);
    await this.deliver(state);
  }
  async deliver(state) {
    const now = Date.now();
    const due = Object.entries(state.jobs).filter(([, j]) => j.next <= now).slice(0, 20);
    await Promise.all(due.map(async ([key, job]) => {
      const sub = state.subscriptions[job.subId];
      if (!sub || job.expires <= now) {
        delete state.jobs[key];
        return;
      }
      try {
        const payload = await buildPushPayload(
          { data: job.payload, options: { ttl: 3600, urgency: "normal" } },
          sub,
          {
            subject: this.env.VAPID_SUBJECT,
            publicKey: this.env.VAPID_PUBLIC_KEY,
            privateKey: this.env.VAPID_PRIVATE_KEY
          }
        );
        const response = await fetch(sub.endpoint, {
          ...payload,
          redirect: "manual",
          signal: AbortSignal.timeout(8e3)
        });
        if (response.status === 404 || response.status === 410) {
          delete state.subscriptions[job.subId];
          delete state.jobs[key];
        } else if (response.ok) {
          delete state.jobs[key];
        } else {
          throw new Error(`Push service HTTP ${response.status}`);
        }
      } catch {
        job.attempts++;
        job.next = now + Math.min(36e5, 6e4 * 2 ** Math.min(job.attempts - 1, 6));
        console.warn("Push delivery deferred", { attempt: job.attempts });
      }
    }));
    await this.save(state);
  }
};
async function digest(text) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))),
    (b) => b.toString(16).padStart(2, "0")
  ).join("");
}
__name(digest, "digest");
function normalizePushEnv(env) {
  const unquote = /* @__PURE__ */ __name((value) => {
    let text = typeof value === "string" ? value.trim() : "";
    if (text.startsWith('"') && text.endsWith('"')) {
      try {
        const decoded = JSON.parse(text);
        if (typeof decoded === "string") text = decoded;
      } catch {
      }
    } else if (text.startsWith("'") && text.endsWith("'")) text = text.slice(1, -1);
    return text.trim();
  }, "unquote");
  const key = /* @__PURE__ */ __name((value) => unquote(value).replace(/\s/g, "").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""), "key");
  return { ...env, VAPID_PUBLIC_KEY: key(env.VAPID_PUBLIC_KEY), VAPID_PRIVATE_KEY: key(env.VAPID_PRIVATE_KEY), VAPID_SUBJECT: unquote(env.VAPID_SUBJECT) };
}
__name(normalizePushEnv, "normalizePushEnv");
export {
  PushState,
  worker_default as default,
  normalizePushEnv
};
//# sourceMappingURL=worker.js.map
