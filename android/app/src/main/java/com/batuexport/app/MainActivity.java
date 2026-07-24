package com.batuexport.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(P1PrinterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
