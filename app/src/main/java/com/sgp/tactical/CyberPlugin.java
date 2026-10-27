package com.sgp.tactical;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.content.Context;
import android.net.ConnectivityManager;
import android.net.DhcpInfo;
import android.net.wifi.ScanResult;
import android.net.wifi.WifiConfiguration;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.Iterator;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.json.JSONException;
import org.json.JSONObject;

/* JADX INFO: loaded from: classes.dex */
@CapacitorPlugin(name = "CyberPlugin", permissions = {@Permission(alias = "location", strings = {"android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_COARSE_LOCATION"}), @Permission(alias = "bluetooth", strings = {"android.permission.BLUETOOTH_SCAN", "android.permission.BLUETOOTH_CONNECT"}), @Permission(alias = "wifi", strings = {"android.permission.NEARBY_WIFI_DEVICES"})})
public class CyberPlugin extends Plugin {
    private static final String TAG = "CyberPlugin";
    private ScanCallback bleScanCallback;
    private BluetoothLeScanner bleScanner;
    private BluetoothManager bluetoothManager;
    private ConnectivityManager connectivityManager;
    private WifiManager wifiManager;
    private final List<JSObject> bleResults = new ArrayList();
    private boolean bleScanning = false;
    private WifiManager.LocalOnlyHotspotReservation hotspotReservation = null;

    @Override // com.getcapacitor.Plugin
    public void load() {
        Context context = getContext();
        this.wifiManager = (WifiManager) context.getApplicationContext().getSystemService("wifi");
        this.bluetoothManager = (BluetoothManager) context.getSystemService("bluetooth");
        this.connectivityManager = (ConnectivityManager) context.getSystemService("connectivity");
    }

    @Override // com.getcapacitor.Plugin
    @PluginMethod
    public void requestPermissions(PluginCall pluginCall) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestAllPermissions(pluginCall, "permissionsCallback");
            return;
        }
        JSObject jSObject = new JSObject();
        jSObject.put("granted", true);
        pluginCall.resolve(jSObject);
    }

    @PermissionCallback
    private void permissionsCallback(PluginCall pluginCall) {
        JSObject jSObject = new JSObject();
        jSObject.put("granted", getPermissionState("location") == PermissionState.GRANTED);
        pluginCall.resolve(jSObject);
    }

    @PluginMethod
    public void scanWifiNetworks(PluginCall pluginCall) {
        if (this.wifiManager == null) {
            pluginCall.reject("WiFi not available");
        } else if (ActivityCompat.checkSelfPermission(getContext(), "android.permission.ACCESS_FINE_LOCATION") != 0) {
            requestAllPermissions(pluginCall, "wifiScanCallback");
        } else {
            performWifiScan(pluginCall);
        }
    }

    @PermissionCallback
    private void wifiScanCallback(PluginCall pluginCall) {
        if (getPermissionState("location") == PermissionState.GRANTED) {
            performWifiScan(pluginCall);
        } else {
            pluginCall.reject("Location permission required for WiFi scan");
        }
    }

    private void performWifiScan(final PluginCall pluginCall) {
        try {
            this.wifiManager.startScan();
            new Handler(Looper.getMainLooper()).postDelayed(new Runnable() { // from class: com.sgp.tactical.CyberPlugin$$ExternalSyntheticLambda3
                @Override // java.lang.Runnable
                public final void run() {
                    CyberPlugin.this.lambda$performWifiScan$0(pluginCall);
                }
            }, 1500L);
        } catch (Exception e) {
            pluginCall.reject("WiFi scan failed: " + e.getMessage());
        }
    }

    /* JADX INFO: Access modifiers changed from: private */
    public /* synthetic */ void lambda$performWifiScan$0(PluginCall pluginCall) {
        try {
            List<ScanResult> scanResults = this.wifiManager.getScanResults();
            JSArray jSArray = new JSArray();
            for (ScanResult scanResult : scanResults) {
                JSObject jSObject = new JSObject();
                jSObject.put("ssid", (scanResult.SSID == null || scanResult.SSID.isEmpty()) ? "[OCULTA]" : scanResult.SSID);
                jSObject.put("bssid", scanResult.BSSID);
                jSObject.put("rssi", scanResult.level);
                jSObject.put("frequency", scanResult.frequency);
                jSObject.put("channel", frequencyToChannel(scanResult.frequency));
                jSObject.put("band", scanResult.frequency > 4900 ? "5GHz" : "2.4GHz");
                jSObject.put("security", getSecurityType(scanResult));
                jSObject.put("width", getChannelWidth(scanResult));
                jSObject.put("signalPercent", WifiManager.calculateSignalLevel(scanResult.level, 100));
                jSArray.put(jSObject);
            }
            JSObject jSObject2 = new JSObject();
            jSObject2.put("networks", (Object) jSArray);
            jSObject2.put("count", scanResults.size());
            jSObject2.put("timestamp", System.currentTimeMillis());
            pluginCall.resolve(jSObject2);
        } catch (SecurityException e) {
            pluginCall.reject("Permission denied: " + e.getMessage());
        }
    }

    @PluginMethod
    public void getConnectedWifiInfo(PluginCall pluginCall) {
        WifiManager wifiManager = this.wifiManager;
        if (wifiManager == null) {
            pluginCall.reject("WiFi not available");
            return;
        }
        try {
            WifiInfo connectionInfo = wifiManager.getConnectionInfo();
            DhcpInfo dhcpInfo = this.wifiManager.getDhcpInfo();
            JSObject jSObject = new JSObject();
            jSObject.put("ssid", connectionInfo.getSSID() != null ? connectionInfo.getSSID().replace("\"", "") : "Unknown");
            jSObject.put("bssid", connectionInfo.getBSSID());
            jSObject.put("rssi", connectionInfo.getRssi());
            jSObject.put("linkSpeed", connectionInfo.getLinkSpeed());
            jSObject.put("frequency", connectionInfo.getFrequency());
            jSObject.put("channel", frequencyToChannel(connectionInfo.getFrequency()));
            jSObject.put("ip", intToIp(connectionInfo.getIpAddress()));
            jSObject.put("gateway", intToIp(dhcpInfo.gateway));
            jSObject.put("netmask", intToIp(dhcpInfo.netmask));
            jSObject.put("dns1", intToIp(dhcpInfo.dns1));
            jSObject.put("dns2", intToIp(dhcpInfo.dns2));
            jSObject.put("dhcpServer", intToIp(dhcpInfo.serverAddress));
            jSObject.put("macAddress", connectionInfo.getMacAddress());
            jSObject.put("networkId", connectionInfo.getNetworkId());
            jSObject.put("signalPercent", WifiManager.calculateSignalLevel(connectionInfo.getRssi(), 100));
            pluginCall.resolve(jSObject);
        } catch (Exception e) {
            pluginCall.reject("Failed to get WiFi info: " + e.getMessage());
        }
    }

    @PluginMethod
    public void scanLocalNetwork(final PluginCall pluginCall) {
        final int iIntValue = pluginCall.getInt("timeout", 300).intValue();
        final ExecutorService executorServiceNewFixedThreadPool = Executors.newFixedThreadPool(50);
        final Handler handler = new Handler(Looper.getMainLooper());
        executorServiceNewFixedThreadPool.execute(new Runnable() { // from class: com.sgp.tactical.CyberPlugin$$ExternalSyntheticLambda13
            @Override // java.lang.Runnable
            public final void run() {
                CyberPlugin.this.lambda$scanLocalNetwork$4(executorServiceNewFixedThreadPool, iIntValue, handler, pluginCall);
            }
        });
    }

    /* JADX INFO: Access modifiers changed from: private */
    public /* synthetic */ void lambda$scanLocalNetwork$4(ExecutorService executorService, int i, Handler handler, final PluginCall pluginCall) {
        try {
            final String strIntToIp = intToIp(this.wifiManager.getDhcpInfo().gateway);
            String strSubstring = strIntToIp.substring(0, strIntToIp.lastIndexOf(46) + 1);
            final JSArray jSArray = new JSArray();
            final CountDownLatch countDownLatch = new CountDownLatch(254);
            int i2 = 1;
            while (i2 <= 254) {
                final String str = strSubstring + i2;
                final int i3 = i;
                executorService.execute(new Runnable() { // from class: com.sgp.tactical.CyberPlugin$$ExternalSyntheticLambda9
                    @Override // java.lang.Runnable
                    public final void run() {
                        CyberPlugin.lambda$scanLocalNetwork$1(str, i3, strIntToIp, jSArray, countDownLatch);
                    }
                });
                i2++;
                i = i3;
            }
            countDownLatch.await(30L, TimeUnit.SECONDS);
            JSArray jSArrayMergeDevicesWithArp = mergeDevicesWithArp(jSArray, readArpTable());
            final JSObject jSObject = new JSObject();
            jSObject.put("devices", (Object) jSArrayMergeDevicesWithArp);
            jSObject.put("count", jSArrayMergeDevicesWithArp.length());
            jSObject.put("gateway", strIntToIp);
            jSObject.put("subnet", strSubstring + "0/24");
            jSObject.put("myIp", intToIp(this.wifiManager.getConnectionInfo().getIpAddress()));
            jSObject.put("timestamp", System.currentTimeMillis());
            handler.post(new Runnable() { // from class: com.sgp.tactical.CyberPlugin$$ExternalSyntheticLambda10
                @Override // java.lang.Runnable
                public final void run() {
                    pluginCall.resolve(jSObject);
                }
            });
        } catch (Exception e) {
            handler.post(new Runnable() { // from class: com.sgp.tactical.CyberPlugin$$ExternalSyntheticLambda11
                @Override // java.lang.Runnable
                public final void run() {
                    pluginCall.reject("Network scan failed: " + e.getMessage());
                }
            });
        }
    }

    static /* synthetic */ void lambda$scanLocalNetwork$1(String str, int i, String str2, JSArray jSArray, CountDownLatch countDownLatch) {
        try {
            try {
                InetAddress byName = InetAddress.getByName(str);
                boolean zIsReachable = byName.isReachable(i);
                if (!zIsReachable) {
                    try {
                        Socket socket = new Socket();
                        socket.connect(new InetSocketAddress(str, 80), i);
                        socket.close();
                        zIsReachable = true;
                    } catch (Exception unused) {
                    }
                }
                if (zIsReachable) {
                    JSObject jSObject = new JSObject();
                    jSObject.put("ip", str);
                    jSObject.put("hostname", byName.getCanonicalHostName());
                    jSObject.put("isGateway", str.equals(str2));
                    synchronized (jSArray) {
                        jSArray.put(jSObject);
                    }
                }
            } catch (Throwable th) {
                countDownLatch.countDown();
                throw th;
            }
        } catch (Exception unused2) {
        }
        countDownLatch.countDown();
    }

    @PluginMethod
    public void getArpTable(PluginCall pluginCall) {
        try {
            JSArray arpTable = readArpTable();
            JSObject jSObject = new JSObject();
            jSObject.put("entries", (Object) arpTable);
            jSObject.put("count", arpTable.length());
            pluginCall.resolve(jSObject);
        } catch (Exception e) {
            pluginCall.reject("Failed to read ARP table: " + e.getMessage());
        }
    }

    private JSArray readArpTable() {
        JSArray jSArray = new JSArray();
        try {
            BufferedReader bufferedReader = new BufferedReader(new InputStreamReader(new FileInputStream("/proc/net/arp")));
            boolean z = true;
            while (true) {
                String line = bufferedReader.readLine();
                if (line == null) {
                    bufferedReader.close();
                    return jSArray;
                }
                if (z) {
                    z = false;
                } else {
                    String[] strArrSplit = line.trim().split("\\s+");
                    if (strArrSplit.length >= 4) {
                        JSObject jSObject = new JSObject();
                        jSObject.put("ip", strArrSplit[0]);
                        jSObject.put("hwType", strArrSplit[1]);
                        jSObject.put("flags", strArrSplit[2]);
                        jSObject.put("mac", strArrSplit[3].toUpperCase());
                        if (strArrSplit.length >= 6) {
                            jSObject.put("device", strArrSplit[5]);
                        }
                        if (!"00:00:00:00:00:00".equals(strArrSplit[3])) {
                            jSArray.put(jSObject);
                        }
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Error reading ARP table: " + e.getMessage());
            return jSArray;
        }
    }

    private JSArray mergeDevicesWithArp(JSArray jSArray, JSArray jSArray2) {
        JSArray jSArray3 = new JSArray();
        for (int i = 0; i < jSArray.length(); i++) {
            try {
                JSONObject jSONObject = jSArray.getJSONObject(i);
                String string = jSONObject.getString("ip");
                for (int i2 = 0; i2 < jSArray2.length(); i2++) {
                    JSONObject jSONObject2 = jSArray2.getJSONObject(i2);
                    if (string.equals(jSONObject2.getString("ip"))) {
                        jSONObject.put("mac", jSONObject2.getString("mac"));
                        String string2 = jSONObject2.getString("mac");
                        jSONObject.put("oui", string2.substring(0, Math.min(8, string2.length())));
                        break;
                    }
                }
                if (!jSONObject.has("mac")) {
                    jSONObject.put("mac", "UNKNOWN");
                    jSONObject.put("oui", "");
                }
                jSArray3.put(jSONObject);
            } catch (JSONException e) {
                Log.e(TAG, "Error merging devices: " + e.getMessage());
                return jSArray3;
            }
        }
        try {
            for (int i3 = 0; i3 < jSArray2.length(); i3++) {
                JSONObject jSONObject3 = jSArray2.getJSONObject(i3);
                String string3 = jSONObject3.getString("ip");
                int i4 = 0;
                while (true) {
                    if (i4 < jSArray.length()) {
                        if (string3.equals(jSArray.getJSONObject(i4).getString("ip"))) {
                            break;
                        }
                        i4++;
                    } else {
                        JSObject jSObject = new JSObject();
                        jSObject.put("ip", string3);
                        String string4 = jSONObject3.getString("mac");
                        jSObject.put("mac", string4);
                        jSObject.put("oui", string4.substring(0, Math.min(8, string4.length())));
                        jSObject.put("hostname", string3);
                        jSObject.put("isGateway", false);
                        jSObject.put("arpOnly", true);
                        jSArray3.put(jSObject);
                        break;
                    }
                }
            }
        } catch (JSONException e) {
            Log.e(TAG, "Error merging devices: " + e.getMessage());
        }
        return jSArray3;
    }

    @PluginMethod
    public void getNetworkInfo(PluginCall pluginCall) {
        try {
            WifiInfo connectionInfo = this.wifiManager.getConnectionInfo();
            DhcpInfo dhcpInfo = this.wifiManager.getDhcpInfo();
            JSObject jSObject = new JSObject();
            jSObject.put("ip", intToIp(connectionInfo.getIpAddress()));
            jSObject.put("gateway", intToIp(dhcpInfo.gateway));
            jSObject.put("netmask", intToIp(dhcpInfo.netmask));
            jSObject.put("dns1", intToIp(dhcpInfo.dns1));
            jSObject.put("dns2", intToIp(dhcpInfo.dns2));
            jSObject.put("dhcpServer", intToIp(dhcpInfo.serverAddress));
            jSObject.put("leaseTime", dhcpInfo.leaseDuration);
            jSObject.put("ssid", connectionInfo.getSSID().replace("\"", ""));
            jSObject.put("bssid", connectionInfo.getBSSID());
            jSObject.put("linkSpeed", connectionInfo.getLinkSpeed() + " Mbps");
            jSObject.put("frequency", connectionInfo.getFrequency());
            jSObject.put("rssi", connectionInfo.getRssi());
            pluginCall.resolve(jSObject);
        } catch (Exception e) {
            pluginCall.reject("Failed to get network info: " + e.getMessage());
        }
    }

    @PluginMethod
    public void scanBleDevices(PluginCall pluginCall) {
        int iIntValue = pluginCall.getInt("duration", 8000).intValue();
        BluetoothManager bluetoothManager = this.bluetoothManager;
        if (bluetoothManager == null) {
            pluginCall.reject("Bluetooth not available");
            return;
        }
        BluetoothAdapter adapter = bluetoothManager.getAdapter();
        if (adapter == null || !adapter.isEnabled()) {
            pluginCall.reject("Bluetooth is disabled");
        } else if (ActivityCompat.checkSelfPermission(getContext(), "android.permission.BLUETOOTH_SCAN") != 0) {
            requestAllPermissions(pluginCall, "bleScanCallback");
        } else {
            performBleScan(pluginCall, iIntValue);
        }
    }

    @PermissionCallback
    private void bleScanCallback(PluginCall pluginCall) {
        if (getPermissionState("bluetooth") == PermissionState.GRANTED) {
            performBleScan(pluginCall, 8000);
        } else {
            pluginCall.reject("Bluetooth permission required");
        }
    }

    private void performBleScan(final PluginCall pluginCall, int i) {
        try {
            BluetoothLeScanner bluetoothLeScanner = this.bluetoothManager.getAdapter().getBluetoothLeScanner();
            this.bleScanner = bluetoothLeScanner;
            if (bluetoothLeScanner == null) {
                pluginCall.reject("BLE Scanner not available");
                return;
            }
            synchronized (this.bleResults) {
                this.bleResults.clear();
            }
            ScanCallback scanCallback = new ScanCallback() { // from class: com.sgp.tactical.CyberPlugin.1
                @Override // android.bluetooth.le.ScanCallback
                public void onScanResult(int i2, android.bluetooth.le.ScanResult scanResult) {
                    String name;
                    String str;
                    try {
                        JSObject jSObject = new JSObject();
                        BluetoothDevice device = scanResult.getDevice();
                        try {
                            name = device.getName();
                        } catch (SecurityException unused) {
                            name = null;
                        }
                        if (name == null) {
                            name = "Unknown";
                        }
                        jSObject.put("name", name);
                        jSObject.put("address", device.getAddress());
                        jSObject.put("rssi", scanResult.getRssi());
                        jSObject.put("bondState", device.getBondState());
                        int type = device.getType();
                        if (type == 1) {
                            str = "CLASSIC";
                        } else if (type == 2) {
                            str = "BLE";
                        } else if (type == 3) {
                            str = "DUAL";
                        } else {
                            str = "UNKNOWN";
                        }
                        jSObject.put("type", str);
                        jSObject.put("deviceClass", CyberPlugin.this.getBluetoothClassName(device.getBluetoothClass() != null ? device.getBluetoothClass().getMajorDeviceClass() : 0));
                        jSObject.put("distanceMeters", Math.round(Math.pow(10.0d, ((double) ((-69) - scanResult.getRssi())) / 20.0d) * 10.0d) / 10.0d);
                        synchronized (CyberPlugin.this.bleResults) {
                            for (int i3 = 0; i3 < CyberPlugin.this.bleResults.size(); i3++) {
                                try {
                                    if (((JSObject) CyberPlugin.this.bleResults.get(i3)).getString("address").equals(device.getAddress())) {
                                        CyberPlugin.this.bleResults.set(i3, jSObject);
                                    }
                                } catch (Throwable th) {
                                    throw th;
                                }
                            }
                            CyberPlugin.this.bleResults.add(jSObject);
                        }
                    } catch (Exception e) {
                        Log.w(CyberPlugin.TAG, "BLE result error: " + e.getMessage());
                    }
                }
            };
            this.bleScanCallback = scanCallback;
            this.bleScanner.startScan(scanCallback);
            this.bleScanning = true;
            new Handler(Looper.getMainLooper()).postDelayed(new Runnable() { // from class: com.sgp.tactical.CyberPlugin$$ExternalSyntheticLambda4
                @Override // java.lang.Runnable
                public final void run() {
                    CyberPlugin.this.lambda$performBleScan$5(pluginCall);
                }
            }, i);
        } catch (SecurityException e) {
            pluginCall.reject("Bluetooth permission denied: " + e.getMessage());
        } catch (Exception e2) {
            pluginCall.reject("BLE scan failed: " + e2.getMessage());
        }
    }

    /* JADX INFO: Access modifiers changed from: private */
    public /* synthetic */ void lambda$performBleScan$5(PluginCall pluginCall) {
        BluetoothLeScanner bluetoothLeScanner;
        try {
            if (this.bleScanning && (bluetoothLeScanner = this.bleScanner) != null) {
                bluetoothLeScanner.stopScan(this.bleScanCallback);
                this.bleScanning = false;
            }
        } catch (SecurityException unused) {
        }
        JSArray jSArray = new JSArray();
        synchronized (this.bleResults) {
            Iterator<JSObject> it = this.bleResults.iterator();
            while (it.hasNext()) {
                jSArray.put(it.next());
            }
        }
        JSObject jSObject = new JSObject();
        jSObject.put("devices", (Object) jSArray);
        jSObject.put("count", jSArray.length());
        jSObject.put("timestamp", System.currentTimeMillis());
        pluginCall.resolve(jSObject);
    }

    @PluginMethod
    public void stopBleScan(PluginCall pluginCall) {
        BluetoothLeScanner bluetoothLeScanner;
        ScanCallback scanCallback;
        try {
            if (this.bleScanning && (bluetoothLeScanner = this.bleScanner) != null && (scanCallback = this.bleScanCallback) != null) {
                bluetoothLeScanner.stopScan(scanCallback);
                this.bleScanning = false;
            }
            JSObject jSObject = new JSObject();
            jSObject.put("stopped", true);
            pluginCall.resolve(jSObject);
        } catch (SecurityException e) {
            pluginCall.reject("Permission denied: " + e.getMessage());
        }
    }

    @PluginMethod
    public void scanPorts(final PluginCall pluginCall) {
        final String string = pluginCall.getString("host", "");
        if (string.isEmpty()) {
            pluginCall.reject("Host required");
            return;
        }
        final int[] iArr = {21, 22, 23, 25, 53, 80, 110, 135, 139, 143, 443, 445, 993, 995, 1433, 1723, 3306, 3389, 5432, 5900, 8080, 8443, 8888};
        final ExecutorService executorServiceNewFixedThreadPool = Executors.newFixedThreadPool(20);
        final Handler handler = new Handler(Looper.getMainLooper());
        executorServiceNewFixedThreadPool.execute(new Runnable() { // from class: com.sgp.tactical.CyberPlugin$$ExternalSyntheticLambda12
            @Override // java.lang.Runnable
            public final void run() {
                CyberPlugin.this.lambda$scanPorts$8(iArr, executorServiceNewFixedThreadPool, string, handler, pluginCall);
            }
        });
    }

    /* JADX INFO: Access modifiers changed from: private */
    public /* synthetic */ void lambda$scanPorts$8(int[] iArr, ExecutorService executorService, final String str, Handler handler, final PluginCall pluginCall) {
        final JSArray jSArray = new JSArray();
        final CountDownLatch countDownLatch = new CountDownLatch(iArr.length);
        for (final int i : iArr) {
            executorService.execute(new Runnable() { // from class: com.sgp.tactical.CyberPlugin$$ExternalSyntheticLambda0
                @Override // java.lang.Runnable
                public final void run() {
                    CyberPlugin.this.lambda$scanPorts$6(str, i, jSArray, countDownLatch);
                }
            });
        }
        try {
            countDownLatch.await(15L, TimeUnit.SECONDS);
        } catch (InterruptedException unused) {
        }
        final JSObject jSObject = new JSObject();
        jSObject.put("host", str);
        jSObject.put("openPorts", (Object) jSArray);
        jSObject.put("count", jSArray.length());
        jSObject.put("portsScanned", iArr.length);
        handler.post(new Runnable() { // from class: com.sgp.tactical.CyberPlugin$$ExternalSyntheticLambda5
            @Override // java.lang.Runnable
            public final void run() {
                pluginCall.resolve(jSObject);
            }
        });
    }

    /* JADX INFO: Access modifiers changed from: private */
    public /* synthetic */ void lambda$scanPorts$6(String str, int i, JSArray jSArray, CountDownLatch countDownLatch) {
        try {
            Socket socket = new Socket();
            socket.connect(new InetSocketAddress(str, i), 500);
            socket.close();
            JSObject jSObject = new JSObject();
            jSObject.put("port", i);
            jSObject.put(NotificationCompat.CATEGORY_SERVICE, getServiceName(i));
            jSObject.put("state", "OPEN");
            synchronized (jSArray) {
                jSArray.put(jSObject);
            }
            countDownLatch.countDown();
        } catch (Exception unused) {
            countDownLatch.countDown();
        } catch (Throwable th) {
            countDownLatch.countDown();
            throw th;
        }
    }

    private int frequencyToChannel(int i) {
        if (i >= 2412 && i <= 2484) {
            return ((i - 2412) / 5) + 1;
        }
        if (i < 5170 || i > 5825) {
            return 0;
        }
        return ((i - 5170) / 5) + 34;
    }

    private String getSecurityType(ScanResult scanResult) {
        String str = scanResult.capabilities;
        if (str.contains("WPA3")) {
            return "WPA3";
        }
        if (str.contains("WPA2")) {
            return "WPA2";
        }
        if (str.contains("WPA")) {
            return "WPA";
        }
        if (str.contains("WEP")) {
            return "WEP";
        }
        if (str.contains("OWE")) {
            return "OWE";
        }
        return "OPEN";
    }

    private String getChannelWidth(ScanResult scanResult) {
        int i = scanResult.channelWidth;
        if (i == 0) {
            return "20 MHz";
        }
        if (i == 1) {
            return "40 MHz";
        }
        if (i == 2) {
            return "80 MHz";
        }
        if (i == 3) {
            return "160 MHz";
        }
        return "Unknown";
    }

    private String intToIp(int i) {
        return (i & 255) + "." + ((i >> 8) & 255) + "." + ((i >> 16) & 255) + "." + ((i >> 24) & 255);
    }

    /* JADX INFO: Access modifiers changed from: private */
    public String getBluetoothClassName(int i) {
        if (i == 256) {
            return "COMPUTER";
        }
        if (i == 512) {
            return "PHONE";
        }
        if (i == 768) {
            return "NETWORKING";
        }
        if (i == 1024) {
            return "AUDIO_VIDEO";
        }
        if (i == 1280) {
            return "PERIPHERAL";
        }
        if (i == 1536) {
            return "IMAGING";
        }
        if (i == 1792) {
            return "WEARABLE";
        }
        if (i == 2048) {
            return "TOY";
        }
        if (i == 2304) {
            return "HEALTH";
        }
        return "MISC";
    }

    private String getServiceName(int i) {
        switch (i) {
            case 21:
                return "FTP";
            case 22:
                return "SSH";
            case 23:
                return "Telnet";
            case 25:
                return "SMTP";
            case 53:
                return "DNS";
            case 80:
                return "HTTP";
            case 110:
                return "POP3";
            case 135:
                return "MSRPC";
            case 139:
                return "NetBIOS";
            case 143:
                return "IMAP";
            case 443:
                return "HTTPS";
            case 445:
                return "SMB";
            case 993:
                return "IMAPS";
            case 995:
                return "POP3S";
            case 1433:
                return "MSSQL";
            case 1723:
                return "PPTP";
            case 3306:
                return "MySQL";
            case 3389:
                return "RDP";
            case 5432:
                return "PostgreSQL";
            case 5900:
                return "VNC";
            case 8080:
                return "HTTP-Alt";
            case 8443:
                return "HTTPS-Alt";
            case 8888:
                return "HTTP-Proxy";
            default:
                return "Unknown";
        }
    }

    @PluginMethod
    public void createHotspot(final PluginCall pluginCall) {
        final String string = pluginCall.getString("ssid", "SGP_Tactical_AP");
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                this.wifiManager.startLocalOnlyHotspot(new WifiManager.LocalOnlyHotspotCallback() { // from class: com.sgp.tactical.CyberPlugin.2
                    @Override // android.net.wifi.WifiManager.LocalOnlyHotspotCallback
                    public void onStarted(WifiManager.LocalOnlyHotspotReservation localOnlyHotspotReservation) {
                        CyberPlugin.this.hotspotReservation = localOnlyHotspotReservation;
                        WifiConfiguration wifiConfiguration = localOnlyHotspotReservation.getWifiConfiguration();
                        JSObject jSObject = new JSObject();
                        jSObject.put("active", true);
                        jSObject.put("ssid", wifiConfiguration != null ? wifiConfiguration.SSID : string);
                        jSObject.put("password", wifiConfiguration != null ? wifiConfiguration.preSharedKey : "");
                        jSObject.put("type", "LocalOnly");
                        pluginCall.resolve(jSObject);
                    }

                    @Override // android.net.wifi.WifiManager.LocalOnlyHotspotCallback
                    public void onFailed(int i) {
                        JSObject jSObject = new JSObject();
                        jSObject.put("active", false);
                        jSObject.put("error", "Hotspot failed, reason: " + i);
                        pluginCall.resolve(jSObject);
                    }
                }, new Handler(Looper.getMainLooper()));
            } else {
                pluginCall.reject("Hotspot requires Android 8.0+");
            }
        } catch (SecurityException e) {
            pluginCall.reject("Permission denied: " + e.getMessage());
        } catch (Exception e2) {
            pluginCall.reject("Hotspot error: " + e2.getMessage());
        }
    }

    @PluginMethod
    public void stopHotspot(PluginCall pluginCall) {
        try {
            WifiManager.LocalOnlyHotspotReservation localOnlyHotspotReservation = this.hotspotReservation;
            if (localOnlyHotspotReservation != null) {
                localOnlyHotspotReservation.close();
                this.hotspotReservation = null;
            }
            JSObject jSObject = new JSObject();
            jSObject.put("stopped", true);
            pluginCall.resolve(jSObject);
        } catch (Exception e) {
            pluginCall.reject("Stop hotspot error: " + e.getMessage());
        }
    }

    @PluginMethod
    public void executeCommand(final PluginCall pluginCall) {
        final String string = pluginCall.getString("command", "");
        final boolean zBooleanValue = pluginCall.getBoolean("root", false).booleanValue();
        if (string.isEmpty()) {
            pluginCall.reject("Command required");
            return;
        }
        ExecutorService executorServiceNewSingleThreadExecutor = Executors.newSingleThreadExecutor();
        final Handler handler = new Handler(Looper.getMainLooper());
        executorServiceNewSingleThreadExecutor.execute(new Runnable() { // from class: com.sgp.tactical.CyberPlugin$$ExternalSyntheticLambda2
            @Override // java.lang.Runnable
            public final void run() {
                CyberPlugin.lambda$executeCommand$11(zBooleanValue, string, handler, pluginCall);
            }
        });
    }

    static /* synthetic */ void lambda$executeCommand$11(boolean z, String str, Handler handler, final PluginCall pluginCall) {
        Process processExec;
        boolean z2 = true;
        try {
            if (z) {
                processExec = Runtime.getRuntime().exec(new String[]{"su", "-c", str});
            } else {
                processExec = Runtime.getRuntime().exec(str);
            }
            BufferedReader bufferedReader = new BufferedReader(new InputStreamReader(processExec.getInputStream()));
            BufferedReader bufferedReader2 = new BufferedReader(new InputStreamReader(processExec.getErrorStream()));
            StringBuilder sb = new StringBuilder();
            StringBuilder sb2 = new StringBuilder();
            while (true) {
                String line = bufferedReader.readLine();
                if (line == null) {
                    break;
                } else {
                    sb.append(line).append("\n");
                }
            }
            while (true) {
                String line2 = bufferedReader2.readLine();
                if (line2 == null) {
                    break;
                } else {
                    sb2.append(line2).append("\n");
                }
            }
            int iWaitFor = processExec.waitFor();
            final JSObject jSObject = new JSObject();
            jSObject.put("exitCode", iWaitFor);
            jSObject.put("output", sb.toString().trim());
            jSObject.put("error", sb2.toString().trim());
            jSObject.put("success", iWaitFor == 0);
            if (!z || iWaitFor != 0) {
                z2 = false;
            }
            jSObject.put("hasRoot", z2);
            handler.post(new Runnable() { // from class: com.sgp.tactical.CyberPlugin$$ExternalSyntheticLambda7
                @Override // java.lang.Runnable
                public final void run() {
                    pluginCall.resolve(jSObject);
                }
            });
        } catch (Exception e) {
            final JSObject jSObject2 = new JSObject();
            jSObject2.put("exitCode", -1);
            jSObject2.put("output", "");
            jSObject2.put("error", e.getMessage());
            jSObject2.put("success", false);
            jSObject2.put("hasRoot", false);
            handler.post(new Runnable() { // from class: com.sgp.tactical.CyberPlugin$$ExternalSyntheticLambda8
                @Override // java.lang.Runnable
                public final void run() {
                    pluginCall.resolve(jSObject2);
                }
            });
        }
    }

    @PluginMethod
    public void checkRootAccess(final PluginCall pluginCall) {
        ExecutorService executorServiceNewSingleThreadExecutor = Executors.newSingleThreadExecutor();
        final Handler handler = new Handler(Looper.getMainLooper());
        executorServiceNewSingleThreadExecutor.execute(new Runnable() { // from class: com.sgp.tactical.CyberPlugin$$ExternalSyntheticLambda1
            @Override // java.lang.Runnable
            public final void run() {
                CyberPlugin.lambda$checkRootAccess$13(handler, pluginCall);
            }
        });
    }

    static /* synthetic */ void lambda$checkRootAccess$13(Handler handler, final PluginCall pluginCall) {
        String str;
        boolean z;
        boolean z2 = true;
        String[] strArr = {"/system/bin/su", "/system/xbin/su", "/sbin/su", "/data/local/xbin/su", "/data/local/bin/su"};
        int i = 0;
        while (true) {
            if (i >= 5) {
                str = PluginMethod.RETURN_NONE;
                z = false;
                break;
            } else {
                if (new File(strArr[i]).exists()) {
                    str = "su_binary";
                    z = true;
                    break;
                }
                i++;
            }
        }
        if (!z) {
            try {
                Process processExec = Runtime.getRuntime().exec(new String[]{"su", "-c", "id"});
                String line = new BufferedReader(new InputStreamReader(processExec.getInputStream())).readLine();
                if (line == null || !line.contains("uid=0")) {
                    z2 = z;
                } else {
                    str = "su_exec";
                }
                try {
                    processExec.destroy();
                } catch (Exception unused) {
                }
            } catch (Exception unused2) {
                z2 = z;
            }
            z = z2;
        }
        final JSObject jSObject = new JSObject();
        jSObject.put("hasRoot", z);
        jSObject.put("method", str);
        handler.post(new Runnable() { // from class: com.sgp.tactical.CyberPlugin$$ExternalSyntheticLambda6
            @Override // java.lang.Runnable
            public final void run() {
                pluginCall.resolve(jSObject);
            }
        });
    }

    @PluginMethod
    public void getWifiInterface(PluginCall pluginCall) {
        byte[] hardwareAddress;
        try {
            JSObject jSObject = new JSObject();
            Enumeration<NetworkInterface> networkInterfaces = NetworkInterface.getNetworkInterfaces();
            JSArray jSArray = new JSArray();
            while (networkInterfaces.hasMoreElements()) {
                NetworkInterface networkInterfaceNextElement = networkInterfaces.nextElement();
                JSObject jSObject2 = new JSObject();
                jSObject2.put("name", networkInterfaceNextElement.getName());
                jSObject2.put("displayName", networkInterfaceNextElement.getDisplayName());
                jSObject2.put("isUp", networkInterfaceNextElement.isUp());
                jSObject2.put("isLoopback", networkInterfaceNextElement.isLoopback());
                jSObject2.put("isVirtual", networkInterfaceNextElement.isVirtual());
                try {
                    hardwareAddress = networkInterfaceNextElement.getHardwareAddress();
                } catch (Exception unused) {
                    hardwareAddress = null;
                }
                if (hardwareAddress != null) {
                    StringBuilder sb = new StringBuilder();
                    for (int i = 0; i < hardwareAddress.length; i++) {
                        sb.append(String.format("%02X", Byte.valueOf(hardwareAddress[i])));
                        if (i < hardwareAddress.length - 1) {
                            sb.append(":");
                        }
                    }
                    jSObject2.put("mac", sb.toString());
                }
                Enumeration<InetAddress> inetAddresses = networkInterfaceNextElement.getInetAddresses();
                JSArray jSArray2 = new JSArray();
                while (inetAddresses.hasMoreElements()) {
                    jSArray2.put(inetAddresses.nextElement().getHostAddress());
                }
                jSObject2.put("addresses", (Object) jSArray2);
                jSArray.put(jSObject2);
            }
            jSObject.put("interfaces", (Object) jSArray);
            pluginCall.resolve(jSObject);
        } catch (Exception e) {
            pluginCall.reject("Failed to get interfaces: " + e.getMessage());
        }
    }
}
