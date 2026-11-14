// Local stand-in for Neon's SQL-over-HTTP endpoint, backed by the private Postgres cluster.
// Speaks the subset @neondatabase/serverless 1.x uses: POST /sql with {query, params} or
// {queries: [...]} (one transaction), raw text values in array mode with field type OIDs, and
// 400 + Postgres error fields on failure.
// Uses node-postgres like Neon's own proxy: every param goes to the server as untyped text, so
// 'true', JSON strings and dates reach Postgres exactly as the app's driver serialised them.
// Env: SHIM_PORT, SHIM_PG_URL, TOOLS (pg is installed there by launch.sh).
import http from 'node:http'
import { createRequire } from 'node:module'

const { Pool } = createRequire(`${process.env.TOOLS}/package.json`)('pg')
const pool = new Pool({ connectionString: process.env.SHIM_PG_URL, max: 10 })
const rawText = { getTypeParser: () => (v) => v }
let served = 0 // /sql requests answered; doctor.sh uses it to prove the app's DB traffic lands here

const ERROR_FIELDS = ['severity', 'code', 'detail', 'hint', 'position', 'internalPosition', 'internalQuery',
  'where', 'schema', 'table', 'column', 'dataType', 'constraint', 'file', 'line', 'routine']

async function run(client, { query, params = [] }) {
  const res = await client.query({ text: query, values: params, rowMode: 'array', types: rawText })
  return {
    command: res.command,
    rowCount: res.rowCount,
    fields: res.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID, tableID: f.tableID, columnID: f.columnID })),
    rows: res.rows,
    rowAsArray: true,
  }
}

const server = http.createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  try {
    if (req.method === 'GET' && req.url === '/healthz') {
      const { rows: [row] } = await pool.query('select current_database() as db, version() as version')
      return send(200, { ok: true, served, ...row })
    }
    if (req.method !== 'POST' || req.url !== '/sql') return send(404, { message: 'not found' })
    served++
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    if (!Array.isArray(body.queries)) return send(200, await run(pool, body))
    const client = await pool.connect()
    try {
      await client.query('begin')
      const results = []
      for (const q of body.queries) results.push(await run(client, q))
      await client.query('commit')
      return send(200, { results })
    } catch (err) {
      await client.query('rollback').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  } catch (err) {
    const out = { message: err.message }
    for (const f of ERROR_FIELDS) if (err[f] !== undefined) out[f] = String(err[f])
    process.stderr.write(`[neon-shim] ${out.code ?? 'ERR'} ${out.message}\n`)
    return send(400, out)
  }
})

server.listen(Number(process.env.SHIM_PORT), '127.0.0.1', () => {
  process.stdout.write(`[neon-shim] listening on 127.0.0.1:${process.env.SHIM_PORT}\n`)
})
