// Se corre solo después de "npm install" (postinstall). Parche para react-native-webview en ANDROID:
// el guion "antes de cargar" se registra como guion de inicio de documento (DOCUMENT_START_SCRIPT), así:
//  - corre antes que los guiones de la página (como en iPhone), y
//  - si la vista pide "no solo el marco principal", también corre dentro de cada iframe. Sin esto, el navegador de
//    la sala en Android no reconoce videos que están en un reproductor incrustado (jkanime, noticias, etc.).
// No toca nada de iPhone. Si ya está aplicado, no hace nada.
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', 'node_modules', 'react-native-webview', 'android', 'src', 'main', 'java', 'com', 'reactnativecommunity', 'webview');
const J = path.join(D, 'RNCWebView.java'), K = path.join(D, 'RNCWebViewManagerImpl.kt');
if (!fs.existsSync(J) || !fs.existsSync(K)) { console.log('parche-webview: no está react-native-webview, nada que hacer'); process.exit(0); }
let j = fs.readFileSync(J, 'utf8'), k = fs.readFileSync(K, 'utf8');
if (j.includes('documentStartHandler')) { console.log('parche-webview: ya estaba aplicado'); process.exit(0); }
const rep = (s, a, b, f) => { if (!s.includes(a)) { console.error('parche-webview: no encontré en ' + f + ': ' + a.slice(0, 70)); process.exit(1); } return s.replace(a, b); };
j = rep(j, 'import androidx.webkit.JavaScriptReplyProxy;', 'import androidx.webkit.JavaScriptReplyProxy;\nimport androidx.webkit.ScriptHandler;', 'RNCWebView.java');
j = rep(j, '    protected boolean injectedJavaScriptBeforeContentLoadedForMainFrameOnly = true;\n', `    protected boolean injectedJavaScriptBeforeContentLoadedForMainFrameOnly = true;
    // Juntos: guion de inicio de documento (todas las páginas y, si se pide, todos los iframes)
    protected @Nullable ScriptHandler documentStartHandler = null;
    public void applyDocumentStartScript() {
        if (documentStartHandler != null) { try { documentStartHandler.remove(); } catch (Exception e) { } documentStartHandler = null; }
        if (injectedJSBeforeContentLoaded == null || TextUtils.isEmpty(injectedJSBeforeContentLoaded)) return;
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return;
        String body = "(function() {\\n" + injectedJSBeforeContentLoaded + ";\\n})();";
        String js = injectedJavaScriptBeforeContentLoadedForMainFrameOnly ? "if (window === window.top) {\\n" + body + "\\n}" : body;
        try { documentStartHandler = WebViewCompat.addDocumentStartJavaScript(this, js, java.util.Collections.singleton("*")); } catch (Exception e) { documentStartHandler = null; }
    }
`, 'RNCWebView.java');
j = rep(j, '    public void callInjectedJavaScriptBeforeContentLoaded() {\n', '    public void callInjectedJavaScriptBeforeContentLoaded() {\n        if (documentStartHandler != null) { injectJavascriptObject(); return; } // ya corre al inicio de cada documento\n', 'RNCWebView.java');
k = rep(k, '        view.injectedJSBeforeContentLoaded = value\n', '        view.injectedJSBeforeContentLoaded = value\n        view.applyDocumentStartScript()\n', 'RNCWebViewManagerImpl.kt');
k = rep(k, '        view.injectedJavaScriptBeforeContentLoadedForMainFrameOnly = value\n', '        view.injectedJavaScriptBeforeContentLoadedForMainFrameOnly = value\n        view.applyDocumentStartScript()\n', 'RNCWebViewManagerImpl.kt');
fs.writeFileSync(J, j); fs.writeFileSync(K, k);
console.log('parche-webview: aplicado (Android: guion al inicio del documento y en iframes)');
