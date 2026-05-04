package com.marinara.engine;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

public class MainActivity extends Activity {

    private static final String SERVER_URL = BuildConfig.MARINARA_SERVER_URL;
    private static final int RETRY_DELAY_MS = 2000;
    private static final int FILE_CHOOSER_REQUEST = 1001;

    private WebView webView;
    private View splashView;
    private ProgressBar spinner;
    private TextView statusText;
    private ValueCallback<Uri[]> fileUploadCallback;
    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(
                WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN
        );

        // Root layout
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF0A0A0F);

        // WebView (hidden initially)
        webView = new WebView(this);
        webView.setVisibility(View.INVISIBLE);
        webView.setBackgroundColor(0xFF0A0A0F);
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        // Splash screen overlay
        splashView = buildSplashView();
        root.addView(splashView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        setContentView(root);

        configureWebView();
        tryConnect();
    }

    private View buildSplashView() {
        FrameLayout splash = new FrameLayout(this);
        splash.setBackgroundColor(0xFF0A0A0F);

        // Vertical center container
        android.widget.LinearLayout container = new android.widget.LinearLayout(this);
        container.setOrientation(android.widget.LinearLayout.VERTICAL);
        container.setGravity(android.view.Gravity.CENTER);

        // Status text
        statusText = new TextView(this);
        statusText.setText("Connecting to Marinara Engine…");
        statusText.setTextColor(0xFFCCCCCC);
        statusText.setTextSize(16f);
        statusText.setGravity(android.view.Gravity.CENTER);
        statusText.setPadding(32, 0, 32, 24);
        container.addView(statusText);

        // Spinner
        spinner = new ProgressBar(this);
        spinner.setIndeterminate(true);
        container.addView(spinner);

        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT);
        lp.gravity = android.view.Gravity.CENTER;
        splash.addView(container, lp);
        return splash;
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUserAgentString(settings.getUserAgentString() + " MarinaraEngine/Android");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                // Keep loopback navigation inside the WebView
                if (url.startsWith("http://localhost") || url.startsWith("http://127.0.0.1")) {
                    return false;
                }
                // Open external links in the default browser
                Intent intent = new Intent(Intent.ACTION_VIEW, request.getUrl());
                startActivity(intent);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (url.startsWith(SERVER_URL)) {
                    showWebView();
                }
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                // Server not ready yet — retry
                retryConnection();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileUploadCallback != null) {
                    fileUploadCallback.onReceiveValue(null);
                }
                fileUploadCallback = callback;
                Intent intent = params.createIntent();
                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                } catch (Exception e) {
                    fileUploadCallback = null;
                    return false;
                }
                return true;
            }
        });
    }

    private void tryConnect() {
        statusText.setText("Connecting to Marinara Engine…");
        webView.loadUrl(SERVER_URL);
    }

    private void retryConnection() {
        statusText.setText("Waiting for server…\nMake sure Marinara Engine is running in Termux.");
        handler.postDelayed(this::tryConnect, RETRY_DELAY_MS);
    }

    private void showWebView() {
        splashView.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (fileUploadCallback != null) {
                Uri[] result = (resultCode == RESULT_OK && data != null)
                        ? new Uri[]{data.getData()}
                        : null;
                fileUploadCallback.onReceiveValue(result);
                fileUploadCallback = null;
            }
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
