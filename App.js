// Juntos para iPhone/iPad: abre Juntos (https://30.abis.party) a pantalla completa como app nativa:
// sin zoom, sin rebote ni gestos de navegador, con micrófono para la voz, video en línea, AirPlay y PiP.
import { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, Pressable, ActivityIndicator, Linking, StyleSheet, Image, AppState, Animated, KeyboardAvoidingView, Platform, Settings, Modal } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { WebView } from 'react-native-webview';
import Constants from 'expo-constants';
import { setAudioModeAsync } from 'expo-audio';

// Solo para pruebas automáticas en el simulador (argumentos de arranque -juntosToken / -juntosRuta / -juntosServidor);
// un usuario normal no puede pasarlos. El servidor de pruebas solo puede ser uno local de la Mac (localhost).
let E2E_TOKEN = null, E2E_RUTA = null, E2E_SERVIDOR = null;
try {
  if (Platform.OS === 'ios' && Settings) {
    E2E_TOKEN = Settings.get('juntosToken') || null; E2E_RUTA = Settings.get('juntosRuta') || null;
    const s = Settings.get('juntosServidor'); if (s && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(String(s))) E2E_SERVIDOR = String(s);
  }
} catch { /* sin ajustes */ }
const SERVER = (E2E_SERVIDOR || Constants.expoConfig?.extra?.servidor || 'https://30.abis.party').replace(/\/+$/, '');
const ORIGIN = SERVER.replace(/^(https?:\/\/[^/]+).*$/, '$1');
const BG = '#0d0f14';
// Para el inicio de sesión de Google se usa la identidad de Safari (Google rechaza navegadores "integrados").
const SAFARI_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

// Sonido de la app: suena aunque el iPhone esté en silencio, sigue en segundo plano y sale por la bocina
// (no por el auricular de llamadas) también cuando el micrófono está activo.
setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, allowsRecording: true, shouldRouteThroughEarpiece: false, interruptionMode: 'mixWithOthers' }).catch(() => {});

// Diagnóstico: anota cargas de página y cambios de estado de la app (el servidor solo lo guarda si está encendido).
const dbgNativo = (m) => { fetch(SERVER + '/api/dbg', { method: 'POST', body: JSON.stringify({ m: '[nativo] ' + m }) }).catch(() => {}); };
// Navegador integrado: identidad de Safari (los sitios rechazan navegadores "incrustados") y texto para pasar datos como código.
const js = (v) => JSON.stringify(v === undefined ? null : v).split(String.fromCharCode(0x2028)).join('').split(String.fromCharCode(0x2029)).join('');
// Guion que se inyecta en cada página (y cada iframe) del navegador integrado.
const NL = String.fromCharCode(10);
const navScript = (mode, pre) => 'window.__juntosMode = ' + js(mode) + ';' + NL + pre + NL + ';true;';
const START_URL = SERVER + (E2E_RUTA && /^[\w-]+$/.test(String(E2E_RUTA)) ? '/r/' + E2E_RUTA : '');

// Se inyecta antes de cargar la página: marca la app, fija el viewport y bloquea zoom/gestos de navegador.
const BEFORE = `
  window.juntosIOS = true;
  window.juntosNav = 1; // esta versión trae navegador integrado (YouTube completo, servicios y páginas dentro de la sala)
  ${E2E_SERVIDOR ? 'window.juntosE2E = true;' : ''}
  ${E2E_TOKEN ? `try { localStorage.setItem('juntos-token', ${JSON.stringify(String(E2E_TOKEN))}); } catch (e) {}` : ''}
  (function () {
    function viewport() {
      var m = document.querySelector('meta[name=viewport]');
      if (!m) { m = document.createElement('meta'); m.name = 'viewport'; (document.head || document.documentElement).appendChild(m); }
      m.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
    }
    viewport(); document.addEventListener('DOMContentLoaded', viewport);
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (t) { document.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false }); });
  })();
  true;`;

export default function App() {
  const [status, setStatus] = useState('cargando'); // cargando | listo | error
  const [reloadKey, setReloadKey] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [ytLogin, setYtLogin] = useState(false); // hoja para iniciar sesión en YouTube dentro de la app
  const web = useRef(null);
  // Navegador integrado: una vista web real colocada justo encima del hueco del video de la sala.
  // La página de Juntos dice dónde va (rect), qué abrir y le manda órdenes; aquí se le regresa lo que reporta la página.
  const [nav, setNav] = useState(null); // { id, url, mode, rect: {x, y, w, h}, visible, pre, n }
  const navRef = useRef(null), navId = useRef(null), preCache = useRef('');
  const toWeb = (m) => { if (web.current) web.current.injectJavaScript('window.__juntosNav && window.__juntosNav(' + js(m) + '); true;'); };
  const onNavCmd = async (m) => {
    if (m.op === 'open') {
      navId.current = m.id;
      // El guion que controla el video se baja del servidor cada vez: se puede mejorar sin publicar otra versión de la app.
      let pre = preCache.current;
      try { const r = await fetch(SERVER + '/ios/preload.js', { cache: 'no-store' }); if (r.ok) { pre = await r.text(); preCache.current = pre; } } catch { /* se usa el último bajado */ }
      if (navId.current !== m.id) return; // ya se cerró o se abrió otro mientras bajaba
      dbgNativo('navegador: abrir ' + m.mode + ' ' + m.url + ' guion=' + pre.length);
      setNav({ id: m.id, url: m.url, mode: m.mode, rect: m.rect, visible: m.visible !== false, pre, n: Date.now() });
      return;
    }
    if (m.id !== navId.current) return;
    if (m.op === 'rect') return setNav((n) => (n && n.id === m.id ? { ...n, rect: m.rect, visible: !!m.visible } : n));
    if (m.op === 'close') { navId.current = null; dbgNativo('navegador: cerrar'); return setNav((n) => (n && n.id === m.id ? null : n)); }
    const v = navRef.current; if (!v) return;
    if (m.op === 'send') v.injectJavaScript('window.__juntosCmd && window.__juntosCmd(' + js(m.ch) + ', ' + js(m.data) + ', ' + js(m.fid || null) + '); true;');
    else if (m.op === 'load' && /^https?:[/][/]/i.test(m.url || '')) v.injectJavaScript('location.href = ' + js(m.url) + '; true;');
    else if (m.op === 'back') v.goBack();
    else if (m.op === 'forward') v.goForward();
    else if (m.op === 'reload') v.reload();
  };
  const onNavMessage = (e) => {
    let d = null; try { d = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (d && d.j === 1 && navId.current) toWeb({ id: navId.current, t: 'ipc', ch: String(d.ch), args: d.args, fid: d.fid });
  };

  // Mensajes de la página: por ahora solo "inicia sesión en YouTube" (verificación "no soy un bot" / edad).
  const onMessage = (e) => {
    let m = null; try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (m && m.type === 'youtube-login') setYtLogin(true);
    else if (m && m.type === 'nav') onNavCmd(m);
  };
  // Al llegar a YouTube con la sesión iniciada se cierra la hoja y se recarga Juntos (comparten la sesión).
  const onLoginNav = (nav) => {
    if (!nav.loading && /^https:\/\/(m|www)\.youtube\.com\//i.test(nav.url || '')) { setYtLogin(false); setTimeout(() => web.current && web.current.reload(), 300); }
  };
  const fade = useRef(new Animated.Value(1)).current;

  const retry = useCallback(() => { dbgNativo('retry: se vuelve a montar la WebView'); fade.setValue(1); setHidden(false); setStatus('cargando'); setReloadKey((k) => k + 1); }, [fade]);

  // Al volver a la app, si quedó sin conexión se reintenta sola.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { dbgNativo('AppState ' + s + ' (estado ' + status + ')'); if (s === 'active' && status === 'error') retry(); });
    return () => sub.remove();
  }, [status, retry]);

  useEffect(() => {
    // Al terminar de cargar, la capa se desvanece y se quita por completo (no debe quedar ocupando la pantalla).
    if (status === 'listo') Animated.timing(fade, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => setHidden(true));
  }, [status, fade]);

  // Juntos y los reproductores incrustados (YouTube, Vimeo, Twitch, Drive…) se quedan dentro;
  // los demás enlaces que abren una página completa se abren en Safari.
  const onShouldStart = (req) => {
    const url = req.url || '';
    if (!/^https?:/i.test(url)) return /^(about:|data:|blob:)/i.test(url);
    if (req.isTopFrame === false) return true;
    if (url.startsWith(ORIGIN)) return true;
    Linking.openURL(url).catch(() => {});
    return false;
  };

  return (
    // La vista se encoge cuando aparece el teclado: lo que escribes queda siempre visible arriba de él.
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />
      <WebView
        key={reloadKey}
        ref={web}
        source={{ uri: START_URL }}
        style={styles.fill}
        containerStyle={styles.fill}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        cacheEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowsFullscreenVideo
        allowsAirPlayForMediaPlayback
        allowsPictureInPictureMediaPlayback
        mediaCapturePermissionGrantType="grant"
        // Sensación de app: sin zoom, sin rebote, sin deslizar para "atrás", sin vista previa de enlaces
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        allowsBackForwardNavigationGestures={false}
        allowsLinkPreview={false}
        pullToRefreshEnabled={false}
        textInteractionEnabled
        dataDetectorTypes="none"
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        hideKeyboardAccessoryView
        keyboardDisplayRequiresUserAction={false}
        setSupportMultipleWindows={false}
        applicationNameForUserAgent="JuntosiOS/1.0"
        injectedJavaScriptBeforeContentLoaded={BEFORE}
        onShouldStartLoadWithRequest={onShouldStart}
        onOpenWindow={(e) => { const u = e.nativeEvent.targetUrl; if (u) Linking.openURL(u).catch(() => {}); }}
        onLoadStart={(e) => { dbgNativo('onLoadStart ' + e.nativeEvent.url); navId.current = null; setNav(null); }}
        onLoadEnd={(e) => { dbgNativo('onLoadEnd ' + e.nativeEvent.url); setStatus((s) => (s === 'error' ? s : 'listo')); }}
        onError={(e) => { dbgNativo('onError ' + JSON.stringify(e.nativeEvent).slice(0, 300)); setStatus('error'); }}
        onHttpError={(e) => { if (e.nativeEvent.statusCode >= 500) setStatus('error'); }}
        onContentProcessDidTerminate={() => { dbgNativo('EL PROCESO WEB SE CERRÓ: recargando'); web.current && web.current.reload(); }}
        onMessage={onMessage}
      />

      {nav && (
        <View pointerEvents={nav.visible ? 'auto' : 'none'} style={{ position: 'absolute', left: nav.rect.x, top: nav.rect.y, width: nav.rect.w, height: nav.rect.h, opacity: nav.visible ? 1 : 0, backgroundColor: '#000', overflow: 'hidden' }}>
          <WebView
            key={nav.id}
            ref={navRef}
            source={{ uri: nav.url }}
            style={{ flex: 1, backgroundColor: '#000' }}
            userAgent={SAFARI_UA}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            cacheEnabled
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            allowsFullscreenVideo={false}
            allowsAirPlayForMediaPlayback
            allowsBackForwardNavigationGestures
            allowsLinkPreview={false}
            setSupportMultipleWindows={false}
            bounces={false}
            automaticallyAdjustContentInsets={false}
            contentInsetAdjustmentBehavior="never"
            injectedJavaScriptBeforeContentLoaded={navScript(nav.mode, nav.pre)}
            injectedJavaScriptBeforeContentLoadedForMainFrameOnly={false}
            injectedJavaScript={navScript(nav.mode, nav.pre)}
            injectedJavaScriptForMainFrameOnly={false}
            // Solo páginas web: nada de saltar a otras apps (netflix://, itms-apps://…)
            onShouldStartLoadWithRequest={(r) => /^(https?:|about:|blob:|data:)/i.test(r.url || '')}
            onNavigationStateChange={(s) => toWeb({ id: nav.id, t: 'nav', url: s.url, title: s.title, loading: s.loading, canGoBack: s.canGoBack, canGoForward: s.canGoForward })}
            onError={(e) => { dbgNativo('navegador: error ' + JSON.stringify(e.nativeEvent).slice(0, 200)); toWeb({ id: nav.id, t: 'fail', code: e.nativeEvent.code, desc: e.nativeEvent.description }); }}
            onContentProcessDidTerminate={() => { dbgNativo('navegador: el proceso web se cerró, recargando'); navRef.current && navRef.current.reload(); }}
            onMessage={onNavMessage}
          />
        </View>
      )}

      <Modal visible={ytLogin} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setYtLogin(false)}>
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Iniciar sesión en YouTube</Text>
            <Pressable hitSlop={12} onPress={() => setYtLogin(false)}><Text style={styles.sheetClose}>Cerrar</Text></Pressable>
          </View>
          <WebView
            source={{ uri: 'https://accounts.google.com/ServiceLogin?service=youtube&hl=es&continue=' + encodeURIComponent('https://m.youtube.com/') }}
            style={styles.fill}
            sharedCookiesEnabled
            domStorageEnabled
            javaScriptEnabled
            userAgent={SAFARI_UA}
            onNavigationStateChange={onLoginNav}
          />
        </View>
      </Modal>

      {status !== 'error' && !hidden && (
        <Animated.View style={[styles.overlay, styles.center, { opacity: fade }]} pointerEvents={status === 'listo' ? 'none' : 'auto'}>
          <Image source={require('./assets/icon.png')} style={styles.logo} />
          <Text style={styles.brand}>Juntos</Text>
          <ActivityIndicator color="#2dd4bf" style={{ marginTop: 26 }} />
        </Animated.View>
      )}

      {status === 'error' && (
        <View style={[styles.overlay, styles.center, { paddingHorizontal: 32 }]}>
          <View style={styles.card}>
            <Image source={require('./assets/icon.png')} style={[styles.logo, { width: 64, height: 64, borderRadius: 16 }]} />
            <Text style={styles.title}>Sin conexión con Juntos</Text>
            <Text style={styles.text}>No pudimos conectar con el servidor. Revisa tu internet e inténtalo de nuevo en un momento.</Text>
            <Pressable style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]} onPress={retry}>
              <Text style={styles.btnText}>Reintentar</Text>
            </Pressable>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: BG },
  sheet: { flex: 1, backgroundColor: '#ffffff' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 14, backgroundColor: BG },
  sheetTitle: { color: '#e8ebf2', fontSize: 16, fontWeight: '700' },
  sheetClose: { color: '#2dd4bf', fontSize: 16, fontWeight: '600' },
  // Capa encima de toda la pantalla (StyleSheet.absoluteFillObject ya no existe en React Native 0.86)
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: BG, zIndex: 10 },
  center: { alignItems: 'center', justifyContent: 'center' },
  logo: { width: 88, height: 88, borderRadius: 22 },
  brand: { color: '#e8ebf2', fontSize: 26, fontWeight: '800', marginTop: 16, letterSpacing: 0.3 },
  card: { width: '100%', maxWidth: 420, alignItems: 'center', backgroundColor: '#151922', borderColor: '#262c3a', borderWidth: 1, borderRadius: 22, padding: 26 },
  title: { color: '#e8ebf2', fontSize: 20, fontWeight: '700', marginTop: 16, marginBottom: 8, textAlign: 'center' },
  text: { color: '#8b93a7', fontSize: 15, textAlign: 'center', lineHeight: 21 },
  btn: { marginTop: 22, backgroundColor: '#2dd4bf', paddingVertical: 14, borderRadius: 14, alignItems: 'center', alignSelf: 'stretch' },
  btnText: { color: '#04211d', fontWeight: '700', fontSize: 16 }
});
