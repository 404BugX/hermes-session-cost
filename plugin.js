/**
 * Session cost chip — shows the focused conversation's estimated LLM spend in
 * the statusbar, next to the native Usage chip.
 *
 * Data: the backend already books a per-session cost (`estimated_cost_usd`
 * priced from the provider catalog, `actual_cost_usd` when the provider
 * reports a real price) on the session row. `host.listPersistedSessions`
 * returns those rows, so no provider key and no backend of our own.
 *
 * Settings (⌘K, persisted via ctx.storage):
 *   - "Session Cost: decimals"  → cycles 2 / 3 / 4 / 5 decimals
 *   - "Session Cost: dollar sign" → cycles "$0.0521" / "0.0521$"
 *
 * Save as: ~/.hermes/desktop-plugins/session-cost/plugin.js
 */
import { atom, cn, haptic, host, Tip, usePluginI18n, useQuery, useValue } from '@hermes/plugin-sdk'
import { jsx } from 'react/jsx-runtime'

const ID = 'session-cost'

// Plugin-local reactive settings, hydrated from ctx.storage at register.
const $decimals = atom(4)
const $suffix = atom(false)

function fmtCost(usd) {
  if (!usd || usd <= 0) return null
  const num = usd.toFixed($decimals.get())
  return $suffix.get() ? `${num}$` : `$${num}`
}

function fmtTokens(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return `${n}`
}

function CostChip() {
  const t = usePluginI18n(ID)
  // Settings subscription: re-render when a ⌘K setting cycles.
  useValue($decimals)
  useValue($suffix)
  const focusedStoredId = useValue(host.state.focusedStoredSessionId)
  const profile = useValue(host.state.focusedSessionProfile)
  const usage = useValue(host.state.focusedUsage)
  const busy = useValue(host.state.busy)

  // Rows carry actual_cost_usd / estimated_cost_usd. 8s poll: the cost only
  // moves when the backend books a turn, this is a readout not a control.
  const list = useQuery({
    queryKey: ['session-cost', 'sessions', profile],
    queryFn: () => host.listPersistedSessions(null, { profile: profile || 'default', limit: 200 }),
    refetchInterval: 8000,
    enabled: Boolean(profile)
  })

  const row = (list?.data?.sessions ?? []).find(s => s.id === focusedStoredId)
  const usd = Number(row?.actual_cost_usd || row?.estimated_cost_usd || 0)
  const label = fmtCost(usd)
  const tokens = usage?.total ?? 0
  const calls = usage?.calls ?? 0

  return jsx(Tip, {
    label: label ? t('tip', fmtCost(usd), fmtTokens(tokens), calls) : t('tipEmpty'),
    children: jsx('button', {
      className: cn(
        'inline-flex h-full items-center gap-1 px-1.5 text-[0.6875rem] transition-colors',
        'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground'
      ),
      type: 'button',
      onClick: () => {
        haptic('tap')
        host.notify({
          kind: 'info',
          message: label ? t('toast', fmtCost(usd), fmtTokens(tokens), calls) : t('tipEmpty')
        })
      },
      children: jsx('span', {
        className: cn(busy && 'opacity-70'),
        children: label ? `≈${label}` : '≈$0'
      })
    })
  })
}

export default {
  id: ID,
  name: 'Session Cost',
  register(ctx) {
    // Hydrate persisted settings (namespaced hermes.plugin.session-cost.*).
    const dec = Number(ctx.storage.get('decimals', 4))
    if (dec >= 2 && dec <= 5) $decimals.set(dec)
    $suffix.set(Boolean(ctx.storage.get('suffix', false)))

    ctx.i18n.register({
      en: {
        tip: (cost, tok, calls) =>
          `Session cost ≈ ${cost} — ${tok} tokens, ${calls} API calls (provider-catalog estimate)`,
        tipEmpty: 'Session cost — available after the first turn',
        toast: (cost, tok, calls) =>
          `≈ ${cost} — ${tok} tokens, ${calls} API calls (estimate from model pricing)`
      }
    })

    const PALETTE_AREA = 'palette'
    const nextDecimals = { 2: 3, 3: 4, 4: 5, 5: 2 }

    ctx.register({
      id: 'cmd-decimals',
      area: PALETTE_AREA,
      data: {
        id: 'session-cost.decimals',
        label: 'Session Cost: decimals',
        keywords: ['session', 'cost', 'decimals'],
        detail: () => `${$decimals.get()} decimals`,
        detailVariant: 'state',
        keepOpen: true,
        run: () => {
          const next = nextDecimals[$decimals.get()] ?? 4
          $decimals.set(next)
          ctx.storage.set('decimals', next)
        }
      }
    })

    ctx.register({
      id: 'cmd-symbol',
      area: PALETTE_AREA,
      data: {
        id: 'session-cost.symbol',
        label: 'Session Cost: dollar sign position',
        keywords: ['session', 'cost', 'dollar', 'symbol'],
        detail: () => ($suffix.get() ? '0.0521$ (suffix)' : '$0.0521 (prefix)'),
        detailVariant: 'state',
        keepOpen: true,
        run: () => {
          const next = !$suffix.get()
          $suffix.set(next)
          ctx.storage.set('suffix', next)
        }
      }
    })

    ctx.register({
      id: 'chip',
      area: 'statusBar.right',
      order: 125,
      render: () => jsx(CostChip, {})
    })
  }
}
