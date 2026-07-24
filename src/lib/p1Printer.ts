import { registerPlugin, Capacitor, type PluginListenerHandle } from '@capacitor/core'

// Thin wrapper around P1PrinterPlugin.java (android/app/src/main/java/com/
// batuexport/app/P1PrinterPlugin.java), which wraps DothanTech's LPAPI SDK
// for the P1 Bluetooth label printer. Only exists in the native Android
// build — see isP1PrinterAvailable() for the feature-detect every call site
// must use before touching this. Kept deliberately minimal (three methods)
// since native code can't be updated over the air; anything likely to
// change (label content, retry policy, persisted selection) lives on the JS
// side instead — see usePrinter.ts.
export interface PrinterInfo {
  address: string
  name: string
}

// calibreLabel is omitted for Barcode #1 (raw material has no calibre yet).
export interface PrintLabelOptions {
  barcode: string
  serial: string
  typeName: string
  calibreLabel?: string
  weightKg: number
  clientName: string
}

// One shared code space with the native side's mapFailReason(): NO_PAPER,
// COVER_OPEN, LOW_BATTERY, NOT_CONNECTED are the 4 requirement E calls out
// specifically; OTHER covers the remaining ~20 LPAPI PrintFailReason values.
export type PrintFailureReason = 'NO_PAPER' | 'COVER_OPEN' | 'LOW_BATTERY' | 'NOT_CONNECTED' | 'OTHER'

export interface PrintLabelResult {
  success: boolean
  reason?: PrintFailureReason
}

export interface ConnectionChangeEvent {
  connected: boolean
}

export interface P1PrinterPlugin {
  listPrinters(): Promise<{ printers: PrinterInfo[] }>
  selectPrinter(options: { address: string }): Promise<{ connected: boolean }>
  printLabel(options: PrintLabelOptions): Promise<PrintLabelResult>
  addListener(
    eventName: 'connectionChange',
    listenerFunc: (event: ConnectionChangeEvent) => void,
  ): Promise<PluginListenerHandle>
  removeAllListeners(): Promise<void>
}

export const P1Printer = registerPlugin<P1PrinterPlugin>('P1Printer')

export function isP1PrinterAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('P1Printer')
}

// Stable Uzbek messages for the plugin's reject codes (permission/connectivity
// — the call never got to attempt a print) and the resolved-with-failure
// reasons (a print was attempted and the hardware reported why it didn't
// work). Requirement C/E: always a specific, visible message, never a
// silent no-op.
const PLUGIN_ERROR_MESSAGES: Record<string, string> = {
  PERMISSION_DENIED: "Bluetooth uchun ruxsat berilmadi. Sozlamalardan ruxsat bering va qayta urining.",
  BLUETOOTH_DISABLED: "Bluetooth yoqilmagan. Uni yoqib, qayta urining.",
  BLUETOOTH_UNSUPPORTED: "Bu qurilmada Bluetooth mavjud emas.",
  CONNECTION_FAILED: "Printerga ulanib bo'lmadi. Printer yoqilganini tekshiring.",
  NOT_CONNECTED: "Printer ulanmagan. Printerni yoqib, qaytadan tanlang.",
  TIMEOUT: "Printerdan javob kelmadi. Qaytadan urining.",
  SUPERSEDED: "Boshqa so'rov boshlandi.",
  INVALID_ARGUMENT: "Yorliq ma'lumotlari to'liq emas.",
}

const PRINT_FAILURE_MESSAGES: Record<PrintFailureReason, string> = {
  NO_PAPER: "Yorliq tugagan. Rulonni almashtiring va qayta urining.",
  COVER_OPEN: "Printer qopqog'i ochiq. Yopib, qayta urining.",
  LOW_BATTERY: "Printer batareyasi kam. Quvvatlab, qayta urining.",
  NOT_CONNECTED: "Printer ulanmagan. Printerni yoqib, qaytadan tanlang.",
  OTHER: "Chop etishda xatolik yuz berdi. Qayta urining.",
}

export function printFailureMessage(reason: PrintFailureReason | undefined): string {
  return PRINT_FAILURE_MESSAGES[reason ?? 'OTHER']
}

// Capacitor plugin rejections carry {message, code}; code is what we key
// messages off (message is English/diagnostic, meant for logs not Ombor).
export function pluginErrorMessage(err: unknown): string {
  const code = (err as { code?: string } | undefined)?.code
  if (code && PLUGIN_ERROR_MESSAGES[code]) return PLUGIN_ERROR_MESSAGES[code]
  return err instanceof Error ? err.message : "Noma'lum xatolik yuz berdi."
}
