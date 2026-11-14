'use strict'
// Preloaded (NODE_OPTIONS=--require) into every Node process the verify-budget helpers start.
// 1. Neon HTTP SQL for *.verify-budget.invalid goes to the local shim (neon-shim.mjs).
// 2. Requests to live Neon, Plaid, Anthropic or OpenAI hosts are refused and logged.
const fs = require('node:fs')
const http = require('node:http')
const https = require('node:https')

const SHIM = process.env.VERIFY_BUDGET_SHIM_URL
const LOG = process.env.VERIFY_BUDGET_EGRESS_LOG
const LOCAL = /(^|\.)verify-budget\.invalid$/i
const BLOCKED = /(^|\.)(neon\.tech|neon\.build|plaid\.com|anthropic\.com|openai\.com)$/i

function blocked(host, via) {
  const line = `${new Date().toISOString()} pid=${process.pid} via=${via} host=${host}\n`
  process.stderr.write(`[verify-budget] blocked egress ${line}`)
  if (LOG) fs.appendFileSync(LOG, line)
  return new Error(`[verify-budget] blocked egress to ${host}`)
}

function hostOf(u) {
  try { return new URL(String(u)).hostname } catch { return '' }
}

const realFetch = globalThis.fetch
globalThis.fetch = function guardedFetch(input, init) {
  const url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url
  const host = hostOf(url)
  if (LOCAL.test(host)) {
    if (!SHIM) return Promise.reject(new Error('[verify-budget] VERIFY_BUDGET_SHIM_URL is not set'))
    return realFetch(SHIM, init)
  }
  if (BLOCKED.test(host)) return Promise.reject(blocked(host, 'fetch'))
  return realFetch(input, init)
}

// The Plaid SDK uses axios, which goes through http(s).request rather than fetch.
for (const [name, mod] of [['http', http], ['https', https]]) {
  for (const fn of ['request', 'get']) {
    const real = mod[fn]
    mod[fn] = function guardedRequest(...args) {
      const first = args[0]
      const opts = typeof first === 'string' || first instanceof URL ? args[1] : first
      const host = (typeof first === 'string' || first instanceof URL ? hostOf(first) : '') ||
        String(opts?.hostname ?? opts?.host ?? '').replace(/:\d+$/, '')
      if (BLOCKED.test(host) || LOCAL.test(host)) throw blocked(host, `${name}.${fn}`)
      return real.apply(this, args)
    }
  }
}
