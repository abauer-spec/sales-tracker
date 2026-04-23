/**
 * Sales Tracking System — Cloudflare Worker
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function err(msg, status = 400) {
  return json({ error: msg }, status);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url  = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';
    const method = request.method;

    try {
      // ─── GOAL (НОВОЕ: Сохранение цели в БД) ──────────────────────

      if (method === 'GET' && path === '/api/goal') {
        const result = await env.DB.prepare(
          "SELECT value FROM settings WHERE key = 'daily_goal'"
        ).first();
        return json({ goal: result ? parseInt(result.value) : 0 });
      }

      if (method === 'POST' && path === '/api/goal') {
        const { goal } = await request.json();
        await env.DB.prepare(
          "INSERT INTO settings (key, value) VALUES ('daily_goal', ?) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        ).bind(goal.toString()).run();
        return json({ ok: true });
      }

      // ─── AGENTS ──────────────────────────────────────────────────

      if (method === 'GET' && path === '/api/agents') {
        const { results } = await env.DB.prepare('SELECT * FROM agents ORDER BY name').all();
        return json(results);
      }

      if (method === 'POST' && path === '/api/agents') {
        const { name } = await request.json();
        if (!name?.trim()) return err('name required');
        const r = await env.DB.prepare(
          'INSERT INTO agents (name) VALUES (?) RETURNING *'
        ).bind(name.trim()).first();
        return json(r, 201);
      }

      const agentDel = path.match(/^\/api\/agents\/(\d+)$/);
      if (method === 'DELETE' && agentDel) {
        await env.DB.prepare('DELETE FROM agents WHERE id=?').bind(+agentDel[1]).run();
        return json({ ok: true });
      }

      // ─── TRANSACTIONS ────────────────────────────────────────────

      if (method === 'GET' && path === '/api/transactions') {
        const date = url.searchParams.get('date') || todayStr();
        const { results } = await env.DB.prepare(`
          SELECT t.*, a.name AS agent_name
          FROM transactions t
          JOIN agents a ON a.id = t.agent_id
          WHERE t.date = ?
          ORDER BY t.created_at DESC
        `).bind(date).all();
        return json(results);
      }

      if (method === 'GET' && path === '/api/transactions/all') {
        const { results } = await env.DB.prepare(`
          SELECT t.*, a.name AS agent_name
          FROM transactions t
          JOIN agents a ON a.id = t.agent_id
          ORDER BY t.created_at DESC LIMIT 50
        `).all();
        return json(results);
      }

      if (method === 'POST' && path === '/api/transactions') {
        const { agent_id, amount, date } = await request.json();
        if (!agent_id || !amount) return err('agent_id and amount required');
        const d = date || todayStr();
        const r = await env.DB.prepare(
          'INSERT INTO transactions (agent_id, amount, date) VALUES (?,?,?) RETURNING *'
        ).bind(+agent_id, +amount, d).first();
        const agent = await env.DB.prepare('SELECT name FROM agents WHERE id=?').bind(+agent_id).first();
        return json({ ...r, agent_name: agent?.name }, 201);
      }

      const txUpdate = path.match(/^\/api\/transactions\/(\d+)$/);
      if (method === 'PUT' && txUpdate) {
        const { amount, date } = await request.json();
        if (!amount) return err('amount required');
        const d = date || todayStr();
        const r = await env.DB.prepare(
          'UPDATE transactions SET amount=?, date=? WHERE id=? RETURNING *'
        ).bind(+amount, d, +txUpdate[1]).first();
        if (!r) return err('not found', 404);
        return json(r);
      }

      if (method === 'DELETE' && txUpdate) {
        await env.DB.prepare('DELETE FROM transactions WHERE id=?').bind(+txUpdate[1]).run();
        return json({ ok: true });
      }

      // ─── DASHBOARD ───────────────────────────────────────────────

      if (method === 'GET' && path === '/api/dashboard') {
        const today = todayStr();
        const monthStart = today.slice(0, 8) + '01';

        const { results: todayRows } = await env.DB.prepare(`
          SELECT a.id, a.name,
            COALESCE(SUM(CASE WHEN t.date=? THEN t.amount END), 0) AS today,
            COALESCE(SUM(CASE WHEN t.date>=? THEN t.amount END), 0) AS month
          FROM agents a
          LEFT JOIN transactions t ON t.agent_id = a.id
          GROUP BY a.id, a.name
        `).bind(today, monthStart).all();

        const totalToday = todayRows.reduce((s, r) => s + r.today, 0);
        const totalMonth = todayRows.reduce((s, r) => s + r.month, 0);

        const monster = todayRows.reduce(
          (best, r) => (r.today > (best?.today ?? -1) ? r : best),
          null
        );

        const { results: lastTx } = await env.DB.prepare(`
          SELECT t.*, a.name AS agent_name
          FROM transactions t JOIN agents a ON a.id=t.agent_id
          ORDER BY t.created_at DESC LIMIT 3
        `).all();

        // Получаем цель из настроек
        const goalData = await env.DB.prepare("SELECT value FROM settings WHERE key = 'daily_goal'").first();

        return json({
          today: totalToday,
          month: totalMonth,
          monster: monster?.today > 0 ? monster : null,
          agents: todayRows,
          lastTransactions: lastTx,
          serverTime: today,
          goal: goalData ? parseInt(goalData.value) : 0 // Отправляем цель в дашборд
        });
      }

      // ─── RESET ───────────────────────────────────────────────────

      if (method === 'POST' && path === '/api/reset/today') {
        await env.DB.prepare("DELETE FROM transactions WHERE date=?").bind(todayStr()).run();
        return json({ ok: true });
      }

      if (method === 'POST' && path === '/api/reset/month') {
        const monthStart = todayStr().slice(0, 8) + '01';
        await env.DB.prepare("DELETE FROM transactions WHERE date>=?").bind(monthStart).run();
        return json({ ok: true });
      }

      return err('Not found', 404);
    } catch (e) {
      console.error(e);
      return err(e.message, 500);
    }
  },
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
