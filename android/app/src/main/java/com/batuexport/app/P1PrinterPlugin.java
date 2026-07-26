package com.batuexport.app;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import com.dothantech.lpapi.LPAPI;
import com.dothantech.printer.IDzPrinter;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.ArrayList;
import java.util.concurrent.atomic.AtomicBoolean;

// Wraps DothanTech's LPAPI SDK (vendor/printer-sdk/) for the P1 Bluetooth
// label printer. Kept deliberately thin: printer I/O only. No persistence
// (that's @capacitor/preferences on the JS side, see usePrinter.ts) and no
// label-content decisions beyond the fixed 40x30mm layout (see DECISIONS.md
// for why the layout lives here AND in barcodeLabel.ts as a web preview).
//
// Everything LPAPI reports asynchronously via Callback, never a return
// value — commitJob() returning true only means "queued", not "printed".
// Every public method here holds its PluginCall open until the matching
// Callback fires, guarded by a timeout so the JS side is never left hanging
// indefinitely on a printer that stops responding mid-operation.
@CapacitorPlugin(
    name = "P1Printer",
    permissions = {
        @Permission(
            alias = "bluetoothModern",
            strings = { Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT }
        ),
        @Permission(
            alias = "bluetoothLegacy",
            strings = {
                Manifest.permission.BLUETOOTH,
                Manifest.permission.BLUETOOTH_ADMIN,
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            }
        )
    }
)
public class P1PrinterPlugin extends Plugin {

    private static final double LABEL_WIDTH_MM = 40;
    private static final double LABEL_HEIGHT_MM = 30;
    private static final long DISCOVERY_WINDOW_MS = 4000;
    private static final long CONNECT_TIMEOUT_MS = 10000;
    private static final long PRINT_TIMEOUT_MS = 18000;
    private static final int CLIENT_NAME_MAX_CHARS = 22;

    private LPAPI api;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<IDzPrinter.PrinterAddress> discovered = Collections.synchronizedList(new ArrayList<>());

    // Accessed from both the UI thread (Handler timeouts, plugin method
    // calls) and LPAPI's own callback thread — volatile for cross-thread
    // visibility, AtomicBoolean for the resolve-exactly-once race.
    private volatile IDzPrinter.PrinterAddress currentAddress;
    private volatile ConnectCallback pendingConnectCallback;
    private final AtomicBoolean connectSettled = new AtomicBoolean(true);
    private volatile Runnable connectTimeoutRunnable;
    private volatile PluginCall pendingPrintCall;
    private final AtomicBoolean printSettled = new AtomicBoolean(true);
    private volatile Runnable printTimeoutRunnable;

    private interface ConnectCallback {
        void onConnected();
        void onFailed(String message, String code);
    }

    private final LPAPI.Callback callback = new LPAPI.Callback() {
        @Override
        public void onProgressInfo(IDzPrinter.ProgressInfo info, Object addiInfo) {
            // Not surfaced to JS — onStateChange below is what the
            // connection-status UI (requirement D) actually needs.
        }

        @Override
        public void onStateChange(IDzPrinter.PrinterAddress address, IDzPrinter.PrinterState state) {
            boolean connected = state == IDzPrinter.PrinterState.Connected || state == IDzPrinter.PrinterState.Connected2;
            notifyListeners("connectionChange", connectionEvent(connected));

            if (pendingConnectCallback != null && connectSettled.compareAndSet(false, true)) {
                cancelConnectTimeout();
                ConnectCallback cb = pendingConnectCallback;
                pendingConnectCallback = null;
                if (connected) {
                    cb.onConnected();
                } else {
                    cb.onFailed("Printerga ulanib bo'lmadi", "CONNECTION_FAILED");
                }
            }
        }

        @Override
        public void onPrintProgress(IDzPrinter.PrinterAddress address, IDzPrinter.PrintData printData, IDzPrinter.PrintProgress progress, Object addiInfo) {
            if (pendingPrintCall == null) return;

            if (progress == IDzPrinter.PrintProgress.Success) {
                if (printSettled.compareAndSet(false, true)) {
                    cancelPrintTimeout();
                    PluginCall call = pendingPrintCall;
                    pendingPrintCall = null;
                    JSObject ret = new JSObject();
                    ret.put("success", true);
                    call.resolve(ret);
                }
            } else if (progress == IDzPrinter.PrintProgress.Failed) {
                if (printSettled.compareAndSet(false, true)) {
                    cancelPrintTimeout();
                    PluginCall call = pendingPrintCall;
                    pendingPrintCall = null;
                    IDzPrinter.PrintFailReason reason = addiInfo instanceof IDzPrinter.PrintFailReason
                        ? (IDzPrinter.PrintFailReason) addiInfo
                        : null;
                    JSObject ret = new JSObject();
                    ret.put("success", false);
                    ret.put("reason", mapFailReason(reason));
                    call.resolve(ret);
                }
            }
        }

        @Override
        public void onPrinterDiscovery(IDzPrinter.PrinterAddress address, Object o) {
            if (address == null || address.macAddress == null) return;
            synchronized (discovered) {
                for (IDzPrinter.PrinterAddress existing : discovered) {
                    if (address.macAddress.equals(existing.macAddress)) return;
                }
                discovered.add(address);
            }
        }
    };

    @Override
    public void load() {
        api = LPAPI.Factory.createInstance(callback);
    }

    @Override
    protected void handleOnDestroy() {
        if (api != null) api.quit();
        super.handleOnDestroy();
    }

    private String activeAlias() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? "bluetoothModern" : "bluetoothLegacy";
    }

    private boolean hasBluetoothPermission() {
        return getPermissionState(activeAlias()) == PermissionState.GRANTED;
    }

    private JSObject connectionEvent(boolean connected) {
        JSObject event = new JSObject();
        event.put("connected", connected);
        return event;
    }

    // ---- listPrinters: ~4s discovery window (paired + newly discoverable
    // devices both surface via onPrinterDiscovery — LPAPI doesn't separate
    // them), then resolve with whatever was found. ----

    @PluginMethod
    public void listPrinters(PluginCall call) {
        if (!hasBluetoothPermission()) {
            requestPermissionForAlias(activeAlias(), call, "listPrintersPermCallback");
            return;
        }
        doListPrinters(call);
    }

    @PermissionCallback
    private void listPrintersPermCallback(PluginCall call) {
        if (hasBluetoothPermission()) {
            doListPrinters(call);
        } else {
            call.reject("Bluetooth uchun ruxsat berilmadi", "PERMISSION_DENIED");
        }
    }

    private void doListPrinters(PluginCall call) {
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
        if (adapter == null) {
            call.reject("Bu qurilmada Bluetooth mavjud emas", "BLUETOOTH_UNSUPPORTED");
            return;
        }
        if (!adapter.isEnabled()) {
            call.reject("Bluetooth yoqilmagan — uni yoqib, qayta urinib ko'ring", "BLUETOOTH_DISABLED");
            return;
        }

        discovered.clear();
        api.discovery();
        handler.postDelayed(() -> {
            api.stopDiscovery();
            JSArray printers = new JSArray();
            synchronized (discovered) {
                for (IDzPrinter.PrinterAddress addr : discovered) {
                    JSObject p = new JSObject();
                    p.put("address", addr.macAddress);
                    p.put("name", addr.shownName == null || addr.shownName.isEmpty() ? addr.macAddress : addr.shownName);
                    printers.put(p);
                }
            }
            JSObject ret = new JSObject();
            ret.put("printers", printers);
            call.resolve(ret);
        }, DISCOVERY_WINDOW_MS);
    }

    // ---- selectPrinter: connects and confirms via onStateChange. Also the
    // mechanism printLabel uses internally to reconnect a sleeping printer. ----

    @PluginMethod
    public void selectPrinter(PluginCall call) {
        if (!hasBluetoothPermission()) {
            requestPermissionForAlias(activeAlias(), call, "selectPrinterPermCallback");
            return;
        }
        doSelectPrinter(call);
    }

    @PermissionCallback
    private void selectPrinterPermCallback(PluginCall call) {
        if (hasBluetoothPermission()) {
            doSelectPrinter(call);
        } else {
            call.reject("Bluetooth uchun ruxsat berilmadi", "PERMISSION_DENIED");
        }
    }

    private void doSelectPrinter(PluginCall call) {
        String address = call.getString("address");
        if (address == null || address.isEmpty()) {
            call.reject("Printer manzili ko'rsatilmagan", "INVALID_ARGUMENT");
            return;
        }
        connectToAddress(new IDzPrinter.PrinterAddress(address, IDzPrinter.AddressType.SPP), new ConnectCallback() {
            @Override
            public void onConnected() {
                JSObject ret = new JSObject();
                ret.put("connected", true);
                call.resolve(ret);
            }

            @Override
            public void onFailed(String message, String code) {
                call.reject(message, code);
            }
        });
    }

    private void connectToAddress(IDzPrinter.PrinterAddress address, ConnectCallback cb) {
        // Only one connect attempt is tracked at a time. A second call
        // arriving mid-connect fails the first rather than leaving it
        // dangling until its own timeout.
        if (pendingConnectCallback != null && connectSettled.compareAndSet(false, true)) {
            cancelConnectTimeout();
            ConnectCallback prior = pendingConnectCallback;
            pendingConnectCallback = null;
            prior.onFailed("Yangi ulanish so'rovi boshlandi", "SUPERSEDED");
        }

        currentAddress = address;
        pendingConnectCallback = cb;
        connectSettled.set(false);

        boolean submitted = api.openPrinterByAddress(address);
        if (!submitted) {
            connectSettled.set(true);
            pendingConnectCallback = null;
            cb.onFailed("Printerga ulanib bo'lmadi", "CONNECTION_FAILED");
            return;
        }

        connectTimeoutRunnable = () -> {
            if (connectSettled.compareAndSet(false, true)) {
                ConnectCallback c = pendingConnectCallback;
                pendingConnectCallback = null;
                if (c != null) c.onFailed("Printerga ulanish vaqti tugadi", "TIMEOUT");
            }
        };
        handler.postDelayed(connectTimeoutRunnable, CONNECT_TIMEOUT_MS);
    }

    private void cancelConnectTimeout() {
        Runnable r = connectTimeoutRunnable;
        if (r != null) {
            handler.removeCallbacks(r);
            connectTimeoutRunnable = null;
        }
    }

    // ---- printLabel: draws natively at 40x30mm and prints. Auto-reconnects
    // to the last-selected printer once if it's gone idle (requirement D) —
    // Ombor just taps print, it doesn't hunt for a reconnect screen. ----

    @PluginMethod
    public void printLabel(PluginCall call) {
        if (!hasBluetoothPermission()) {
            requestPermissionForAlias(activeAlias(), call, "printLabelPermCallback");
            return;
        }
        doPrintLabel(call);
    }

    @PermissionCallback
    private void printLabelPermCallback(PluginCall call) {
        if (hasBluetoothPermission()) {
            doPrintLabel(call);
        } else {
            call.reject("Bluetooth uchun ruxsat berilmadi", "PERMISSION_DENIED");
        }
    }

    private void doPrintLabel(PluginCall call) {
        if (isPrinterReady()) {
            drawAndCommit(call);
            return;
        }
        if (currentAddress == null) {
            call.reject("Printer tanlanmagan", "NOT_CONNECTED");
            return;
        }
        reconnectThenPrint(call);
    }

    private void reconnectThenPrint(PluginCall call) {
        connectToAddress(currentAddress, new ConnectCallback() {
            @Override
            public void onConnected() {
                drawAndCommit(call);
            }

            @Override
            public void onFailed(String message, String code) {
                call.reject("Printer bilan aloqa yo'q — uni yoqing va qaytadan tanlang", "NOT_CONNECTED");
            }
        });
    }

    private boolean isPrinterReady() {
        IDzPrinter.PrinterState state = api.getPrinterState();
        return state != null && state != IDzPrinter.PrinterState.Disconnected && state != IDzPrinter.PrinterState.Connecting;
    }

    private void drawAndCommit(PluginCall call) {
        String barcode = call.getString("barcode");
        String serial = call.getString("serial");
        String typeName = call.getString("typeName");
        String calibreLabel = call.getString("calibreLabel"); // null for Barcode #1 (raw material)
        String clientName = call.getString("clientName");
        Double weightKg = call.getDouble("weightKg");

        if (isBlank(barcode) || isBlank(serial) || isBlank(typeName) || isBlank(clientName) || weightKg == null) {
            call.reject("Yorliq ma'lumotlari to'liq emas", "INVALID_ARGUMENT");
            return;
        }

        String weightStr = formatWeight(weightKg) + " kg";
        // Barcode #2: type + abbreviated calibre + weight on one line (KN /
        // K1-K8, not the full "Konditirskiy" / "Kalibr N" word -- see
        // abbreviateCalibre). Barcode #1 has no calibre yet, so it's just
        // type + weight. Type is kept (not dropped) per 2026-07-26 decision
        // — see DECISIONS.md.
        String infoLine = isBlank(calibreLabel)
            ? typeName + " · " + weightStr
            : typeName + " · " + abbreviateCalibre(calibreLabel) + " · " + weightStr;
        String clientLine = ellipsize(clientName, CLIENT_NAME_MAX_CHARS);

        // 40x30mm, no rotation — the stock is already landscape at these
        // dimensions. QR centered and dominant (16mm, the label's
        // functional core), 3 left-aligned lines below it: the barcode
        // value itself (fallback if scanning fails) · type+calibre+weight ·
        // client. The parent serial is dropped from the printed text
        // entirely (2026-07-26 redesign) -- it still lives inside the
        // encoded QR value below for lookups, unchanged. See DECISIONS.md
        // for the full layout rationale and how this differs from the
        // barcodeLabel.ts web preview.
        //
        // Barcode format: CODE_128 -> QR (DECISIONS.md same title). The
        // print-legibility fix (quiet zone + module width, prior entry)
        // measurably improved density but real printed 1D bars still failed
        // to scan reliably at 40x30mm — QR fits the same content in a small
        // square with built-in error correction and reads at any angle,
        // fixing the actual root cause instead of another density tweak.
        // Encoded value still drops the constant "PLT-" prefix (kept from
        // the prior fix, not reintroduced drift — see barcodeLabel.ts's
        // stripBarcode2Prefix, the same transform, so preview and print
        // agree on one encoded value) — OmborChiqimTab.processBarcode
        // re-prepends it before any DB lookup; this is purely a print-side
        // encoding change, it never touches what's actually stored or how
        // a scan resolves.
        String barcodeEncoded = barcode.startsWith("PLT-") ? barcode.substring(4) : barcode;

        api.startJob(LABEL_WIDTH_MM, LABEL_HEIGHT_MM, 0);
        // draw2DQRCode(content, x, y, size) — confirmed against the real
        // jar (javap on the concrete LPAPI class, not just the IAtBitmap
        // interface, which only exposes an int-typed overload this plugin
        // never calls) and against both real usages in the DothanTech demo
        // (MainActivity.java), which draws a SQUARE box: one call subtracts
        // the same `qrcodeWidth` from both the label's width and height when
        // computing x/y, which only makes sense if one size parameter drives
        // both dimensions. 16mm square (up from 10mm, 2026-07-26 redesign —
        // "bigger QR" was the explicit ask, it's the functional core of the
        // label), centered horizontally. Even larger real module pitch than
        // before; vertical room for it came from dropping the serial line
        // and merging weight into the type/calibre line, not from shrinking
        // anything else. Error-correction level left at the library
        // default: setDrawParam's ErrorCorrectionLevel constants exist on
        // the jar but have no real usage example anywhere in the demo to
        // verify the calling convention against (unlike draw2DQRCode
        // itself) — not guessing at an unverified native call when a
        // reasonable default already exists. Same reasoning applies to
        // MARGIN (no explicit quiet zone set here either) — generous
        // surrounding blank space (1.5mm above, 1.5mm before the text below)
        // substitutes for it, same tradeoff as before, just roomier.
        api.draw2DQRCode(barcodeEncoded, (LABEL_WIDTH_MM - 16) / 2, 1.5, 16);
        api.drawText(barcode, 2, 19.0, 36, 2.8, 2.2);
        api.drawText(infoLine, 2, 22.3, 36, 3.2, 2.5);
        api.drawText(clientLine, 2, 26.0, 36, 3.0, 2.3);

        pendingPrintCall = call;
        printSettled.set(false);

        boolean queued = api.commitJob();
        if (!queued) {
            printSettled.set(true);
            pendingPrintCall = null;
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("reason", "OTHER");
            call.resolve(ret);
            return;
        }

        printTimeoutRunnable = () -> {
            if (printSettled.compareAndSet(false, true)) {
                PluginCall c = pendingPrintCall;
                pendingPrintCall = null;
                if (c != null) c.reject("Chop etish vaqti tugadi", "TIMEOUT");
            }
        };
        handler.postDelayed(printTimeoutRunnable, PRINT_TIMEOUT_MS);
    }

    private void cancelPrintTimeout() {
        Runnable r = printTimeoutRunnable;
        if (r != null) {
            handler.removeCallbacks(r);
            printTimeoutRunnable = null;
        }
    }

    // ---- small helpers ----

    private boolean isBlank(String s) {
        return s == null || s.isEmpty();
    }

    private String ellipsize(String text, int maxChars) {
        if (text.length() <= maxChars) return text;
        return text.substring(0, Math.max(0, maxChars - 1)) + "…";
    }

    private String formatWeight(double kg) {
        if (kg == Math.floor(kg)) {
            return String.format(Locale.US, "%,.0f", kg);
        }
        return String.format(Locale.US, "%,.1f", kg);
    }

    // calibreLabel is "Kalibr N" or "Konditirskiy" (Sozlamalar-managed
    // master data, calibres.label) -- abbreviate for print only, the full
    // label is unchanged everywhere else in the app. Keep in sync with
    // barcodeLabel.ts's abbreviateCalibre.
    private String abbreviateCalibre(String label) {
        if ("Konditirskiy".equals(label)) return "KN";
        if (label != null && label.matches("^Kalibr \\d+$")) {
            return "K" + label.substring("Kalibr ".length());
        }
        return label;
    }

    // Maps LPAPI's 25 PrintFailReason values down to the 4 the UI treats
    // distinctly (requirement E) plus a shared generic fallback. Reasons
    // grouped under one message describe the same physical fix for Ombor
    // ("close the cover", "the roll is empty") even though LPAPI reports
    // them as separate enum values.
    private String mapFailReason(IDzPrinter.PrintFailReason reason) {
        if (reason == null) return "OTHER";
        switch (reason) {
            case No_Paper:
            case No_Label:
            case Usedup_Label:
                return "NO_PAPER";
            case CoverOpened:
            case TphOpened:
            case LabelCanOpend:
                return "COVER_OPEN";
            case VolTooLow:
                return "LOW_BATTERY";
            case Disconnected:
                return "NOT_CONNECTED";
            default:
                return "OTHER";
        }
    }
}
