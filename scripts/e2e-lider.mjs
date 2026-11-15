// Prueba automática en el iPhone simulado: un "líder" (este script) maneja una sala privada en el servidor
// mientras la app entra como invitado. Crea dos cuentas temporales y las borra al terminar.
// Escribe e2e/sala.json con { sala, token } para que el flujo abra la app directo en la sala.
import fs from 'node:fs';
const BASE = (process.env.SERVIDOR || 'https://30.abis.party').replace(/\/+$/, '');
const sfx = Date.now().toString(36).slice(-6);
const PASS = 'prueba-' + Math.random().toString(36).slice(2, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function api(path, body, token, method = 'POST') {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(path + ' ' + r.status + ' ' + JSON.stringify(j)); return j;
}
const lider = await api('/api/register', { handle: 'e2e_l_' + sfx, name: 'PC (líder de prueba)', password: PASS });
const inv = await api('/api/register', { handle: 'e2e_i_' + sfx, name: 'iPhone (prueba)', password: PASS });
log('cuentas temporales creadas');

const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws?token=' + encodeURIComponent(lider.token));
const inbox = [];
ws.addEventListener('message', (e) => { try { inbox.push(JSON.parse(e.data)); } catch { /* */ } });
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
const send = (m) => ws.send(JSON.stringify(m));
const wait = async (t, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const i = inbox.findIndex((m) => m.t === t); if (i >= 0) return inbox.splice(i, 1)[0]; await sleep(100); } return null; };

send({ t: 'room:create', name: 'Prueba iPhone', privacy: 'private' });
const joined = await wait('room:joined');
const sala = joined.room.id;
send({ t: 'room:invite', users: [inv.me.id] });
fs.mkdirSync('e2e', { recursive: true });
fs.writeFileSync('e2e/sala.json', JSON.stringify({ sala, token: inv.token }));
log('sala', sala, 'lista; esperando a que entre el iPhone');

// Esperar a que el iPhone entre (máximo 90 s)
let dentro = false;
for (let i = 0; i < 90 && !dentro; i++) { const m = inbox.find((x) => x.t === 'room:meta' && x.members?.some((u) => u.id === inv.me.id)); if (m) dentro = true; else await sleep(1000); }
log(dentro ? 'el iPhone entró a la sala' : 'el iPhone NO entró a la sala');

const HLS = 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8';
send({ t: 'room:load', item: { provider: 'web', url: HLS, title: 'Video de prueba (HLS con subtítulos)', hls: true } }); log('video HLS');
await sleep(4000);
send({ t: 'room:chat', text: 'Hola desde la PC 👋 ¿me ves bien en el iPhone?' }); log('chat');
await sleep(20000);
send({ t: 'room:subs', id: 'tt0', code: 'en' }); log('subtítulos encendidos por el líder');
await sleep(20000);
send({ t: 'room:subs', id: null }); log('subtítulos apagados por el líder');
await sleep(12000);
send({ t: 'room:control', playing: false, action: 'pause' }); log('pausa');
await sleep(8000);
send({ t: 'room:control', playing: true, action: 'play' }); log('reanudar');
await sleep(6000);
send({ t: 'room:load', item: { provider: 'youtube', mediaId: 'aqz-KE-bpKQ', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', title: 'Big Buck Bunny (YouTube)' } }); log('video de YouTube');
await sleep(30000);

// Limpieza: salir y borrar las dos cuentas temporales
send({ t: 'room:leave' }); await sleep(500); ws.close();
for (const u of [lider, inv]) { try { await api('/api/account', { password: PASS }, u.token, 'DELETE'); } catch (e) { log('no se pudo borrar', e.message); } }
log('cuentas temporales borradas; fin');
