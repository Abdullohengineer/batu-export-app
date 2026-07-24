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

        String typeLine = isBlank(calibreLabel) ? typeName : typeName + " · " + calibreLabel;
        String weightLine = formatWeight(weightKg) + " kg";
        String clientLine = ellipsize(clientName, CLIENT_NAME_MAX_CHARS);

        // 40x30mm, no rotation — the stock is already landscape at these
        // dimensions. Left-aligned, top to bottom: bars (with LPAPI's own
        // built-in human-readable text under them) · serial · type+calibre ·
        // weight · client. See DECISIONS.md for the full layout rationale
        // and how this differs from the barcodeLabel.ts web preview.
        api.startJob(LABEL_WIDTH_MM, LABEL_HEIGHT_MM, 0);
        api.draw1DBarcode(barcode, LPAPI.BarcodeType.CODE128, 2, 1.5, 36, 10, 2.5);
        api.drawText(serial, 2, 13, 36, 4, 3.2);
        api.drawText(typeLine, 2, 17.3, 36, 3.5, 2.6);
        api.drawText(weightLine, 2, 21, 36, 4.2, 3.4);
        api.drawText(clientLine, 2, 25.5, 36, 3, 2.3);

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
