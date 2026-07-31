// Temps réel : Server-Sent Events TYPÉS et REPRENABLES (Lot 1 « Feux FR »).
//   · chaque événement porte un identifiant croissant ;
//   · un client coupé reprend là où il s'était arrêté (Last-Event-ID) grâce
//     à un tampon des 500 derniers événements ;
//   · battement de cœur toutes les 20 s (les proxys ne coupent plus) ;
//   · abonnement filtrable par pays (?country=FR) — un événement sans champ
//     country reste diffusé à tous (compatibilité incidents existants).
// Types émis aujourd'hui : incident (historique), fire.batch,
// burned-area.batch. Le nom d'événement est le type SSE.
import { Router } from 'express';

const clients = new Set(); // { res, country }
let nextId = 1;
const RING_MAX = 500;
const ring = []; // { id, event, data, country }

export function broadcast(event, data) {
  const entry = {
    id: nextId++,
    event,
    data,
    country: data && typeof data === 'object' ? data.country || null : null,
  };
  ring.push(entry);
  if (ring.length > RING_MAX) ring.shift();
  const payload = `id: ${entry.id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    if (c.country && entry.country && c.country !== entry.country) continue;
    try { c.res.write(payload); } catch { clients.delete(c); }
  }
}

export const eventsRouter = Router();

eventsRouter.get('/', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  const country = /^[A-Z]{2}$/.test(String(req.query.country || '')) ? String(req.query.country) : null;
  const client = { res, country };
  // Reprise : rejouer tout ce qui a été émis depuis le dernier identifiant vu.
  const lastId = Number(req.get('Last-Event-ID') || req.query.lastEventId || 0);
  if (Number.isFinite(lastId) && lastId > 0) {
    for (const e of ring) {
      if (e.id <= lastId) continue;
      if (country && e.country && e.country !== country) continue;
      try { res.write(`id: ${e.id}\nevent: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`); } catch {}
    }
  }
  clients.add(client);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 20_000);
  req.on('close', () => { clearInterval(ping); clients.delete(client); });
});
