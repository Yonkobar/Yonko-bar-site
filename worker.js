import {buildPushPayload} from './vendor/web-push/main.js';
import {parisClock, validateSubscription, summary, reservationKeys, readReservations} from './core.js';

const json = (data, status = 200) => Response.json(data, {status, headers: {'Cache-Control': 'no-store'}});
const ready = env => !!(env.RESERVATIONS && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT && env.DASHBOARD_KEY && env.APP_ORIGIN);

export default {
  async fetch(request, env) {
    if (!ready(env)) return json({error: 'Notifications non configurées sur le serveur.'}, 503);
    if (!request.headers.get('x-dashboard-key') || request.headers.get('x-dashboard-key') !== env.DASHBOARD_KEY) return json({error: 'Accès refusé.'}, 401);
    if (request.headers.get('x-app-origin') !== env.APP_ORIGIN) return json({error: 'Origine de preview incorrecte.'}, 403);
    return env.PUSH_STATE.get(env.PUSH_STATE.idFromName('yonko-push')).fetch(request);
  },
  async scheduled(controller, env, ctx) {
    if (!ready(env)) throw new Error('Push configuration incomplete');
    ctx.waitUntil((async () => {
      const res = await env.PUSH_STATE.get(env.PUSH_STATE.idFromName('yonko-push')).fetch('https://internal/tick', {
        method: 'POST', body: JSON.stringify({time: controller.scheduledTime}),
      });
      if (!res.ok) throw new Error(`Push tick failed: ${res.status}`);
    })());
  },
};

export class PushState {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.queue = Promise.resolve(); }
  fetch(request) {
    const job = this.queue.then(() => this.handle(request));
    this.queue = job.catch(() => {});
    return job;
  }
  async load() {
    const meta = await this.ctx.storage.get('state');
    if (!meta) return {subscriptions: {}, seen: {}, jobs: {}, startedAt: Date.now(), lastDaily: null};
    const state = {...meta, subscriptions: {}, seen: {}, jobs: {}};
    for (const name of ['subscriptions', 'seen', 'jobs']) {
      for (let i = 0; i < (meta.chunks?.[name] || 0); i++) Object.assign(state[name], Object.fromEntries(await this.ctx.storage.get(`${name}:${i}`) || []));
    }
    delete state.chunks;
    return state;
  }
  async save(s) {
    await this.ctx.storage.transaction(async tx => {
      const previous = await tx.get('state');
      const {subscriptions, seen, jobs, ...meta} = s;
      meta.chunks = {};
      for (const [name, values] of Object.entries({subscriptions, seen, jobs})) {
        const items = Object.entries(values);
        const count = Math.ceil(items.length / 40);
        meta.chunks[name] = count;
        for (let i = 0; i < count; i++) await tx.put(`${name}:${i}`, items.slice(i * 40, (i + 1) * 40));
        for (let i = count; i < (previous?.chunks?.[name] || 0); i++) await tx.delete(`${name}:${i}`);
      }
      await tx.put('state', meta);
    });
  }
  async handle(request) {
    const path = new URL(request.url).pathname;
    const state = await this.load();

    if (path === '/config' && request.method === 'GET') {
      return json({
        publicKey: this.env.VAPID_PUBLIC_KEY,
        quoteAcceptanceDetectable: false,
        lastTick: state.lastTick || null,
        lastDaily: state.lastDaily
      });
    }

    if (path === '/event' && request.method === 'POST') {
      let event;
      try { event = await request.json(); } catch { return json({error: 'Invalid event'}, 400); }
      if (!/^[a-zA-Z0-9-]{1,100}$/.test(event.id || '') || !Number.isFinite(event.createdAt)) return json({error: 'Invalid event'}, 400);
      const key = `res:${event.id}`;
      if (!state.seen[key]) {
        const id = `new-${await digest(key)}`;
        this.enqueue(state, id, {title: 'Yonko Bar · Nouvelle réservation', body: 'Une nouvelle demande est disponible dans votre tableau de bord.', tag: id, url: '/dashboard'});
        state.seen[key] = true;
        await this.save(state);
        await this.deliver(state);
      }
      return json({ok: true});
    }

    if (path === '/subscription' && ['POST', 'DELETE'].includes(request.method)) {
      let sub;
      try { sub = await request.json(); } catch { return json({error: 'Abonnement invalide.'}, 400); }
      if (!validateSubscription(sub)) return json({error: 'Abonnement ou fournisseur push non pris en charge.'}, 400);
      const id = await digest(sub.endpoint);
      if (request.method === 'DELETE') {
        delete state.subscriptions[id];
        for (const [k, job] of Object.entries(state.jobs)) if (job.subId === id) delete state.jobs[k];
      } else {
        if (!state.subscriptions[id] && Object.keys(state.subscriptions).length >= 50) return json({error: 'Limite de 50 appareils atteinte.'}, 409);
        if (!state.initialized) {
          for (const key of await reservationKeys(this.env.RESERVATIONS)) state.seen[key] = true;
          state.initialized = true;
        }
        state.subscriptions[id] = {endpoint: sub.endpoint, keys: sub.keys, expirationTime: sub.expirationTime || null};
      }
      await this.save(state);
      return json({ok: true});
    }

    if (path === '/test' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return json({error: 'Abonnement manquant.'}, 400); }
      if (typeof body.endpoint !== 'string') return json({error: 'Abonnement manquant.'}, 400);

      const id = await digest(body.endpoint);
      const sub = state.subscriptions[id];
      if (!sub) return json({error: 'Activez les notifications sur cet appareil.'}, 404);

      const tag = `test-${crypto.randomUUID()}`;
      const payloadData = {
        title: 'Yonko Bar · Test push',
        body: 'Le serveur a envoyé cette notification.',
        url: '/dashboard',
        tag
      };

      try {
        const payload = await buildPushPayload(
          {data: payloadData, options: {ttl: 3600, urgency: 'normal'}},
          sub,
          {
            subject: this.env.VAPID_SUBJECT,
            publicKey: this.env.VAPID_PUBLIC_KEY,
            privateKey: this.env.VAPID_PRIVATE_KEY,
          }
        );

        const response = await fetch(sub.endpoint, {
          ...payload,
          redirect: 'error',
          signal: AbortSignal.timeout(8000)
        });

        if (response.status === 404 || response.status === 410) {
          delete state.subscriptions[id];
          await this.save(state);
          return json({error: `Abonnement push expiré (${response.status}). Désactivez puis réactivez les notifications.`}, 410);
        }

        if (!response.ok) {
          let detail = '';
          try { detail = (await response.text()).slice(0, 180); } catch {}
          return json({
            error: `Le fournisseur push a refusé l’envoi (HTTP ${response.status})${detail ? ` : ${detail}` : ''}`
          }, 502);
        }

        return json({ok: true, queued: false, status: response.status});
      } catch (e) {
        const message = String(e?.message || e || 'Erreur inconnue');
        return json({
          error: `Échec technique lors de l’envoi push : ${message}`
        }, 502);
      }
    }

    if (path === '/tick' && request.method === 'POST') {
      const {time} = await request.json();
      if (!Number.isFinite(time)) return json({error: 'Invalid time'}, 400);
      await this.tick(state, time);
      return json({ok: true});
    }

    return json({error: 'Not found'}, 404);
  }

  enqueue(state, eventId, payload, ids = Object.keys(state.subscriptions)) {
    for (const subId of ids) {
      const key = `${eventId}:${subId}`;
      state.jobs[key] ??= {subId, payload, attempts: 0, next: 0, expires: Date.now() + 86400000};
    }
  }

  async tick(state, time) {
    const keys = await reservationKeys(this.env.RESERVATIONS);
    const isFirst = !state.initialized;

    if (isFirst) {
      for (const k of keys) state.seen[k] = true;
      state.initialized = true;
    } else {
      const unseen = keys.filter(k => !state.seen[k]);
      for (const {key, entry} of await readReservations(this.env.RESERVATIONS, unseen)) {
        if (Number(entry.createdAt) >= state.startedAt) {
          const id = `new-${await digest(key)}`;
          this.enqueue(state, id, {
            title: 'Yonko Bar · Nouvelle réservation',
            body: 'Une nouvelle demande est disponible dans votre tableau de bord.',
            tag: id,
            url: '/dashboard'
          });
        }
        state.seen[key] = true;
      }
    }

    const {date, hour} = parisClock(time);
    if (hour === 14 && state.lastDaily !== date) {
      const records = await readReservations(this.env.RESERVATIONS, keys);
      this.enqueue(state, `daily-${date}`, summary(records.map(r => r.entry), date));
      state.lastDaily = date;
    }

    state.lastTick = new Date(time).toISOString();
    await this.save(state);
    await this.deliver(state);
  }

  async deliver(state) {
    const now = Date.now();
    const due = Object.entries(state.jobs).filter(([,j]) => j.next <= now).slice(0, 20);

    await Promise.all(due.map(async ([key, job]) => {
      const sub = state.subscriptions[job.subId];
      if (!sub || job.expires <= now) {
        delete state.jobs[key];
        return;
      }

      try {
        const payload = await buildPushPayload(
          {data: job.payload, options: {ttl: 3600, urgency: 'normal'}},
          sub,
          {
            subject: this.env.VAPID_SUBJECT,
            publicKey: this.env.VAPID_PUBLIC_KEY,
            privateKey: this.env.VAPID_PRIVATE_KEY,
          }
        );

        const response = await fetch(sub.endpoint, {
          ...payload,
          redirect: 'error',
          signal: AbortSignal.timeout(8000)
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
        job.next = now + Math.min(3600000, 60000 * 2 ** Math.min(job.attempts - 1, 6));
        console.warn('Push delivery deferred', {attempt: job.attempts});
      }
    }));

    await this.save(state);
  }
}

async function digest(text) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
    b => b.toString(16).padStart(2, '0')
  ).join('');
}
