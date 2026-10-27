package com.sgp.tactical;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/* JADX INFO: loaded from: classes.dex */
public class MainActivity extends BridgeActivity {
    @Override // com.getcapacitor.BridgeActivity, androidx.fragment.app.FragmentActivity, androidx.activity.ComponentActivity, androidx.core.app.ComponentActivity, android.app.Activity
    public void onCreate(Bundle bundle) {
        registerPlugin(CyberPlugin.class);
        super.onCreate(bundle);
    }
}
