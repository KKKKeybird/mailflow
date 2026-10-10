import { randomBytes, createHash } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';

export const hashMcpToken = token => createHash('sha256').update(token).digest('hex');
const tokenInput = z.object({
  name: z.string().trim().min(1).max(100),
  accountIds: z.array(z.string().uuid()).min(1).max(100),
  allowSend: z.boolean().default(false),
  expiresInDays: z.number().int().min(1).max(365).default(90),
}).strict();
const safeColumns = 'id, name, account_ids, allow_send, created_at, expires_at, last_used_at, revoked_at';
const router = Router();
router.use(requireAuth);
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.get('/', async (req, res) => {
  const { rows } = await query(`SELECT ${safeColumns} FROM mcp_tokens WHERE user_id = $1 ORDER BY created_at DESC`, [req.session.userId]);
  res.json({ tokens: rows });
});

router.post('/', async (req, res) => {
  const input = tokenInput.safeParse(req.body);
  if (!input.success) return res.status(400).json({ error: 'Invalid token settings; select at least one mailbox.' });
  const { name, allowSend, expiresInDays } = input.data;
  const accountIds = [...new Set(input.data.accountIds)];
  const owned = await query('SELECT id FROM email_accounts WHERE user_id = $1 AND enabled = true AND id = ANY($2::uuid[])', [req.session.userId, accountIds]);
  if (owned.rows.length !== accountIds.length) return res.status(403).json({ error: 'One or more mailboxes are unavailable.' });
  const count = await query('SELECT count(*)::integer AS count FROM mcp_tokens WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()', [req.session.userId]);
  if (count.rows[0].count >= 50) return res.status(400).json({ error: 'Revoke an existing token before creating another.' });
  const token = `mf_mcp_${randomBytes(32).toString('base64url')}`;
  const expiresAt = new Date(Date.now() + expiresInDays * 86400000).toISOString();
  const { rows } = await query(`INSERT INTO mcp_tokens (user_id, name, token_hash, account_ids, allow_send, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${safeColumns}`, [req.session.userId, name, hashMcpToken(token), accountIds, allowSend, expiresAt]);
  res.status(201).json({ ...rows[0], token });
});

router.delete('/:id', async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ error: 'Invalid token ID' });
  const result = await query('UPDATE mcp_tokens SET revoked_at = COALESCE(revoked_at, NOW()) WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.session.userId]);
  if (!result.rows.length) return res.status(404).json({ error: 'Token not found' });
  res.json({ revoked: true });
});

router.get('/events', async (req, res) => {
  const { rows } = await query(`SELECT e.id, e.tool, e.success, e.created_at, t.name AS token_name FROM mcp_tool_events e
    JOIN mcp_tokens t ON e.token_id = t.id WHERE e.user_id = $1 ORDER BY e.created_at DESC LIMIT 50`, [req.session.userId]);
  res.json({ events: rows });
});

export default router;
