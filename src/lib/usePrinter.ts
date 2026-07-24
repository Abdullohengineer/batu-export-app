import { useEffect, useSyncExternalStore } from 'react'
import { Preferences } from '@capacitor/preferences'
import { P1Printer, isP1PrinterAvailable, type PrinterInfo } from './p1Printer'

// Shared printer-selection/connection state for the whole app session — a
// module-level external store (not per-component state) because
// Barcode1Display/Barcode2Display can each render many times on one screen
// (one per pallet row) and all of them need to reflect the SAME connection
// status live, not their own independent copies. Persistence itself is
// @capacitor/preferences (requirement D); this hook is the only thing that
// reads/writes it — the native plugin never touches storage.
const PREFS_KEY = 'p1_printer'

interface PrinterStoreState {
  available: boolean
  selected: PrinterInfo | null
  connected: boolean
  scanning: boolean
  printers: PrinterInfo[]
  loadingSelected: boolean
}

let state: PrinterStoreState = {
  available: isP1PrinterAvailable(),
  selected: null,
  connected: false,
  scanning: false,
  printers: [],
  loadingSelected: true,
}

const listeners = new Set<() => void>()

function setState(patch: Partial<PrinterStoreState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return state
}

let initialized = false

// Runs once per app session (guarded by `initialized`, not by component
// lifecycle — every usePrinter() caller triggers this the same way, only
// the first one actually does anything): loads the saved printer and
// silently reconnects to it once. "Requirement D — a JS hook re-issues
// selectPrinter with the saved address once per session." After this,
// printLabel's own native-side reconnect-on-idle (P1PrinterPlugin.java)
// covers every later print without JS doing anything further.
async function initOnce() {
  if (initialized || !state.available) {
    setState({ loadingSelected: false })
    return
  }
  initialized = true

  P1Printer.addListener('connectionChange', (event) => {
    setState({ connected: event.connected })
  })

  const { value } = await Preferences.get({ key: PREFS_KEY })
  const saved: PrinterInfo | null = value ? JSON.parse(value) : null
  setState({ selected: saved, loadingSelected: false })

  if (saved) {
    try {
      const { connected } = await P1Printer.selectPrinter({ address: saved.address })
      setState({ connected })
    } catch {
      // Unreachable at session start isn't an error to surface here —
      // PrinterStatus already shows "not connected" plus a re-select
      // affordance, and printLabel tries again via its own reconnect path
      // on the next print regardless.
      setState({ connected: false })
    }
  }
}

export function usePrinter() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot)

  useEffect(() => {
    initOnce()
  }, [])

  async function scan() {
    if (!state.available) return
    setState({ scanning: true, printers: [] })
    try {
      const { printers } = await P1Printer.listPrinters()
      setState({ printers })
    } finally {
      setState({ scanning: false })
    }
  }

  async function select(printer: PrinterInfo) {
    const { connected } = await P1Printer.selectPrinter({ address: printer.address })
    await Preferences.set({ key: PREFS_KEY, value: JSON.stringify(printer) })
    setState({ selected: printer, connected })
  }

  return { ...snapshot, scan, select }
}
