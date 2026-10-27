package com.sgp.tactical;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle bundle) {
        registerPlugin(CyberPlugin.class);
        registerPlugin(AisPlugin.class);
        super.onCreate(bundle);
    }
}
