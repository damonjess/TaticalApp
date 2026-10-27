package com.sgp.tactical;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Native aisstream.io client.
 *
 * aisstream.io rejects direct browser (WebView) connections and sends binary
 * frames, so the socket has to live on the native side. Positions are merged per
 * MMSI and pushed to JS once a second as a single "aisVessels" event.
 */
@CapacitorPlugin(name = "AisPlugin")
public class AisPlugin extends Plugin {
    private static final String TAG = "AisPlugin";
    private static final String URL = "wss://stream.aisstream.io/v0/stream";
    private static final int MAX_VESSELS = 3000;

    private final Object lock = new Object();
    private final Map<String, JSObject> vessels = new HashMap<>();
    private final Set<String> dirty = new HashSet<>();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Random rnd = new Random();

    private OkHttpClient client;
    private WebSocket socket;
    private String apiKey;
    private JSONArray boxes;
    private JSONArray types;
    private boolean wanted = false;
    private int generation = 0;
    private int attempt = 0;

    private final Runnable flusher = new Runnable() {
        @Override public void run() {
            flush();
            if (wanted) main.postDelayed(this, 1000);
        }
    };

    @Override
    public void load() {
        client = new OkHttpClient.Builder()
                .pingInterval(30, TimeUnit.SECONDS)
                .readTimeout(0, TimeUnit.MILLISECONDS)
                .build();
    }

    @PluginMethod
    public void start(PluginCall call) {
        String key = call.getString("apiKey");
        JSArray b = call.getArray("boxes");
        if (key == null || key.trim().isEmpty() || b == null) {
            call.reject("apiKey and boxes are required");
            return;
        }
        shutdown();
        synchronized (lock) { vessels.clear(); dirty.clear(); }
        apiKey = key.trim();
        boxes = b;
        types = call.getArray("types");
        wanted = true;
        attempt = 0;
        connect();
        main.removeCallbacks(flusher);
        main.postDelayed(flusher, 1000);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        shutdown();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        shutdown();
    }

    private void shutdown() {
        wanted = false;
        generation++;
        main.removeCallbacks(flusher);
        main.removeCallbacksAndMessages(null);
        if (socket != null) {
            try { socket.cancel(); } catch (Exception ignored) {}
            socket = null;
        }
        synchronized (lock) { vessels.clear(); dirty.clear(); }
    }

    private void connect() {
        final int gen = ++generation;
        status("connecting", "", 0);
        Request req = new Request.Builder().url(URL).build();
        socket = client.newWebSocket(req, new WebSocketListener() {
            @Override public void onOpen(WebSocket ws, Response r) {
                if (gen != generation) { ws.close(1000, "stale"); return; }
                attempt = 0;
                status("open", "", 0);
                try {
                    JSONObject sub = new JSONObject();
                    sub.put("APIKey", apiKey);
                    sub.put("BoundingBoxes", boxes);
                    if (types != null) sub.put("FilterMessageTypes", types);
                    ws.send(sub.toString()); // must arrive within 3s of connect
                } catch (Exception e) {
                    status("error", "subscription failed: " + e.getMessage(), 0);
                }
            }

            @Override public void onMessage(WebSocket ws, String text) {
                if (gen == generation) handle(text);
            }

            // aisstream sends BINARY frames containing UTF-8 JSON
            @Override public void onMessage(WebSocket ws, ByteString bytes) {
                if (gen == generation) handle(bytes.utf8());
            }

            @Override public void onClosed(WebSocket ws, int code, String reason) {
                if (gen != generation) return;
                status("closed", reason, code);
                scheduleReconnect();
            }

            @Override public void onFailure(WebSocket ws, Throwable t, Response r) {
                if (gen != generation) return;
                String why = t.getMessage() == null ? t.toString() : t.getMessage();
                if (r != null) why = "HTTP " + r.code() + " " + r.message() + " (" + why + ")";
                Log.w(TAG, "AIS socket failure: " + why);
                status("error", why, r != null ? r.code() : 0);
                scheduleReconnect();
            }
        });
    }

    private void scheduleReconnect() {
        if (!wanted) return;
        long delay = Math.min(30000L, (1000L << Math.min(attempt, 5))) + rnd.nextInt(1000);
        attempt++;
        final int gen = generation;
        main.postDelayed(new Runnable() {
            @Override public void run() {
                if (wanted && gen == generation) connect();
            }
        }, delay);
    }

    private void handle(String text) {
        try {
            JSONObject msg = new JSONObject(text);
            if (msg.has("error")) {
                // e.g. invalid API key: retrying will not help
                wanted = false;
                generation++;
                status("error", msg.optString("error"), 0);
                return;
            }
            String type = msg.optString("MessageType", "");
            if ("SubscriptionConfirmation".equals(type)) {
                status("subscribed", "", 0);
                return;
            }
            JSONObject md = msg.optJSONObject("MetaData");
            JSONObject m = msg.optJSONObject("Message");
            JSONObject body = m != null ? m.optJSONObject(type) : null;
            if (md == null) return;

            long mmsiL = md.optLong("MMSI", body != null ? body.optLong("UserID", 0) : 0);
            if (mmsiL == 0) return;
            String mmsi = String.valueOf(mmsiL);

            double lat = pick(md, "Latitude", "latitude", body);
            double lon = pick(md, "Longitude", "longitude", body);
            String name = md.optString("ShipName", "").trim();
            if ("ShipStaticData".equals(type) && body != null) {
                String n = body.optString("Name", "").trim();
                if (!n.isEmpty()) name = n;
            }

            synchronized (lock) {
                JSObject v = vessels.get(mmsi);
                boolean isNew = (v == null);
                if (isNew) {
                    if (Double.isNaN(lat) || Double.isNaN(lon)) return;
                    if (vessels.size() >= MAX_VESSELS) { vessels.clear(); dirty.clear(); }
                    v = new JSObject();
                    v.put("mmsi", mmsi);
                    v.put("sog", 0);
                    v.put("cog", 0);
                    v.put("heading", 0);
                    v.put("status", 15);
                    v.put("name", "");
                    vessels.put(mmsi, v);
                }
                if (!Double.isNaN(lat) && !Double.isNaN(lon)
                        && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
                        && !(lat == 0 && lon == 0)) {
                    v.put("lat", lat);
                    v.put("lon", lon);
                }
                if (!name.isEmpty()) v.put("name", name);
                if (body != null && body.has("Sog")) {
                    v.put("sog", body.optDouble("Sog", 0));
                    v.put("cog", body.optDouble("Cog", 0));
                    int th = body.optInt("TrueHeading", 511);
                    if (th != 511) v.put("heading", th);
                    if (body.has("NavigationalStatus")) v.put("status", body.optInt("NavigationalStatus", 15));
                }
                if (v.has("lat")) dirty.add(mmsi);
            }
        } catch (Exception e) {
            Log.w(TAG, "bad AIS message: " + e.getMessage());
        }
    }

    private static double pick(JSONObject md, String a, String b, JSONObject body) {
        if (md.has(a)) return md.optDouble(a, Double.NaN);
        if (md.has(b)) return md.optDouble(b, Double.NaN);
        if (body != null && body.has(a)) return body.optDouble(a, Double.NaN);
        return Double.NaN;
    }

    private void flush() {
        JSArray out = new JSArray();
        synchronized (lock) {
            for (String id : dirty) {
                JSObject v = vessels.get(id);
                if (v != null) out.put(v);
            }
            dirty.clear();
        }
        if (out.length() == 0) return;
        JSObject ev = new JSObject();
        ev.put("vessels", out);
        notifyListeners("aisVessels", ev);
    }

    private void status(String state, String message, int code) {
        JSObject ev = new JSObject();
        ev.put("state", state);
        ev.put("message", message == null ? "" : message);
        ev.put("code", code);
        notifyListeners("aisStatus", ev);
    }
}
