// Juntos para iPhone/iPad y Android: abre Juntos (https://30.abis.party) a pantalla completa como app nativa:
// sin zoom, sin rebote ni gestos de navegador, con micrófono para la voz, video en línea, AirPlay y PiP.
import { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, Pressable, ActivityIndicator, Linking, StyleSheet, Image, AppState, Animated, KeyboardAvoidingView, Platform, Settings, Modal, BackHandler } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { WebView } from 'react-native-webview';
import Constants from 'expo-constants';
import { setAudioModeAsync } from 'expo-audio';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as NavigationBar from 'expo-navigation-bar';
import { Accelerometer } from 'expo-sensors';
import { Dimensions } from 'react-native';

// Teléfono (no tableta): fuera del video en pantalla completa se queda en vertical.
const PHONE = Math.min(Dimensions.get('screen').width, Dimensions.get('screen').height) < 600;
const O = ScreenOrientation.OrientationLock;
// Anuncios (AdMob): por ahora solo en Android. En iPhone la librería ni se carga.
const Ads = Platform.OS === 'android' ? (() => { try { return require('react-native-google-mobile-ads'); } catch { return null; } })() : null;

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
// En Android, el navegador integrado se presenta como Chrome para celular (sin la marca de "vista web").
const CHROME_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36';
const NAV_UA = Platform.OS === 'android' ? CHROME_UA : SAFARI_UA;
const APP_TAG = Platform.OS === 'android' ? 'JuntosAndroid/1.1' : 'JuntosiOS/1.0'; // (no cambiar: la página reconoce la app por esta marca)

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
  window.juntosAds = ${Ads ? 1 : 0}; // la app puede mostrar un banner pequeño en las listas (solo Android)
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
  return <SafeAreaProvider><Juntos /></SafeAreaProvider>;
}

function Juntos() {
  // iPhone: la página respeta muesca y bordes por su cuenta (viewport-fit=cover). Android: se deja el espacio aquí.
  const ins = useSafeAreaInsets();
  // Pantalla completa del video (la pide la página): se quitan las barras del sistema y el margen de los bordes,
  // y si se tocó el botón de pantalla completa se gira a horizontal (como YouTube).
  const [full, setFull] = useState(false);
  const fullRef = useRef(false);
  const autoRef = useRef(false);   // la pantalla completa la causó acostar el teléfono (no el botón)
  const sawLandRef = useRef(false); // ya en pantalla completa, el teléfono estuvo acostado
  const armedRef = useRef(true);    // acostar el teléfono puede abrir la pantalla completa (se rearma al enderezarlo)
  const setFullscreen = useCallback(async (on, lock) => {
    const was = fullRef.current;
    setFull(!!on); fullRef.current = !!on;
    if (on && !was) { autoRef.current = !lock; sawLandRef.current = !lock; }
    if (!on && was) armedRef.current = false; // salió acostado: no se vuelve a abrir hasta enderezarlo
    try {
      if (Platform.OS === 'android') {
        await NavigationBar.setVisibilityAsync(on ? 'hidden' : 'visible');
        try { await NavigationBar.setBehaviorAsync('overlay-swipe'); } catch { /* sistemas nuevos: ya es así */ }
      }
      if (on) await ScreenOrientation.lockAsync(O.LANDSCAPE); // horizontal (cualquiera de los dos lados)
      else if (PHONE) await ScreenOrientation.lockAsync(O.PORTRAIT_UP); // todo lo demás, siempre en vertical
      else await ScreenOrientation.unlockAsync();
    } catch { /* sin permiso del sistema: se queda como está */ }
  }, []);
  useEffect(() => { if (PHONE) ScreenOrientation.lockAsync(O.PORTRAIT_UP).catch(() => {}); }, []);
  const pad = Platform.OS === 'android' && !full ? { paddingTop: ins.top, paddingBottom: ins.bottom, paddingLeft: ins.left, paddingRight: ins.right } : null;
  const navCanBack = useRef(false);
  const [status, setStatus] = useState('cargando'); // cargando | listo | error
  const [reloadKey, setReloadKey] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [ytLogin, setYtLogin] = useState(false); // hoja para iniciar sesión en YouTube dentro de la app
  // Anuncio: la página dice dónde va (hueco arriba de la barra de abajo) y cuándo se puede ver (nunca en la sala,
  // en pantalla completa, con ventanas abiertas o con el teclado). La configuración (activo / bloque) viene del servidor.
  const [ad, setAd] = useState(null); // { visible, rect }
  const [adCfg, setAdCfg] = useState(null);
  const [adKey, setAdKey] = useState(0); // cambiarlo vuelve a pedir un anuncio (reintento si no llegó)
  const adFilled = useRef(false), adRetry = useRef(null);
  // Se le avisa a la página si ya hay anuncio: solo así reserva el hueco (sin anuncio no se ve una franja vacía).
  const tellAd = (ok) => { adFilled.current = ok; if (web.current) web.current.injectJavaScript('window.__juntosAdState && window.__juntosAdState(' + (ok ? 'true' : 'false') + '); true;'); };
  // Anuncio de video antes de crear sala (sin Plus). La página solo continúa si se vio completo; si no carga, no se bloquea.
  const toPage = (fn, v) => { if (web.current) web.current.injectJavaScript('window.' + fn + ' && window.' + fn + '(' + js(v) + '); true;'); };
  const showRewarded = () => {
    if (!Ads) return toPage('__juntosRewarded', { error: 'sin anuncios' });
    let earned = false, finished = false;
    const finish = (v) => { if (finished) return; finished = true; toPage('__juntosRewarded', v); };
    try {
      const ad2 = Ads.RewardedAd.createForAdRequest((adCfg && adCfg.rewarded) || Ads.TestIds.REWARDED, { requestNonPersonalizedAdsOnly: true });
      const subs = [];
      const off = () => subs.forEach((u) => { try { u(); } catch { /* */ } });
      subs.push(ad2.addAdEventListener(Ads.RewardedAdEventType.LOADED, () => { dbgNativo('anuncio de video: cargó'); ad2.show().catch(() => { off(); finish({ error: 'no se pudo mostrar' }); }); }));
      subs.push(ad2.addAdEventListener(Ads.RewardedAdEventType.EARNED_REWARD, () => { earned = true; }));
      subs.push(ad2.addAdEventListener(Ads.AdEventType.CLOSED, () => { off(); finish({ ok: earned }); }));
      subs.push(ad2.addAdEventListener(Ads.AdEventType.ERROR, (e) => { dbgNativo('anuncio de video: no cargó ' + (e && (e.code || e.message))); off(); finish({ error: 'no cargó' }); }));
      ad2.load();
      setTimeout(() => { if (!finished && !ad2.loaded) { off(); finish({ error: 'tardó demasiado' }); } }, 20000);
    } catch (e) { finish({ error: String(e && e.message) }); }
  };
  // Inicio con Google: navegador del sistema (Google no deja iniciar sesión dentro de vistas web) y regreso con juntos://
  const authGoogle = async (url) => {
    try {
      const WebBrowser = require('expo-web-browser');
      const r = await WebBrowser.openAuthSessionAsync(url, 'juntos://auth');
      if (r.type !== 'success' || !r.url) return toPage('__juntosAuthResult', { cancel: true });
      const q = new URLSearchParams(r.url.split('?')[1] || '');
      toPage('__juntosAuthResult', q.get('token') ? { token: q.get('token') } : { error: q.get('error') || 'No se pudo iniciar sesión con Google.' });
    } catch (e) { toPage('__juntosAuthResult', { error: 'No se pudo abrir el inicio de sesión de Google.' }); }
  };
  // Inicio con Apple (solo iPhone): Apple da un token firmado y el servidor lo verifica.
  const authApple = async () => {
    try {
      const AppleAuth = require('expo-apple-authentication');
      const c = await AppleAuth.signInAsync({ requestedScopes: [AppleAuth.AppleAuthenticationScope.FULL_NAME, AppleAuth.AppleAuthenticationScope.EMAIL] });
      toPage('__juntosAuthResult', { identityToken: c.identityToken, givenName: c.fullName && c.fullName.givenName, familyName: c.fullName && c.fullName.familyName });
    } catch (e) { toPage('__juntosAuthResult', e && e.code === 'ERR_REQUEST_CANCELED' ? { cancel: true } : { error: 'No se pudo iniciar sesión con Apple.' }); }
  };
  const adShow = !!(ad && ad.visible && ad.rect && !full);
  const adRect = (ad && ad.rect) || { x: 0, y: 0, w: 360, h: 58 };
  useEffect(() => {
    if (!Ads) return;
    Ads.default().initialize().catch(() => {});
    fetch(SERVER + '/api/anuncios?real=1', { cache: 'no-store' }).then((r) => r.json()).then((j) => setAdCfg((j && j.android) || null)).catch(() => {});
  }, []);
  const web = useRef(null);
  // Navegador integrado: una vista web real colocada justo encima del hueco del video de la sala.
  // La página de Juntos dice dónde va (rect), qué abrir y le manda órdenes; aquí se le regresa lo que reporta la página.
  const [nav, setNav] = useState(null); // { id, url, mode, rect: {x, y, w, h}, visible, pre, n }
  const navRef = useRef(null), navId = useRef(null), preCache = useRef('');
  // Sensor: acostado ⇒ pantalla completa del video (si hay uno en la sala); enderezado ⇒ regresa a la sala.
  useEffect(() => {
    if (!PHONE) return undefined;
    let pose = null, since = 0, lastCmd = 0;
    Accelerometer.setUpdateInterval(250);
    const sub = Accelerometer.addListener(({ x, y }) => {
      const ax = Math.abs(x), ay = Math.abs(y);
      const p = ax > 0.7 && ay < 0.45 ? 'land' : ay > 0.7 && ax < 0.45 ? 'port' : null; // acostado sobre la mesa: no cuenta
      if (!p) { pose = null; return; }
      if (p !== pose) { pose = p; since = Date.now(); return; }
      if (Date.now() - since < 450 || Date.now() - lastCmd < 1500 || !web.current) return;
      if (p === 'port') {
        armedRef.current = true;
        if (fullRef.current && (autoRef.current || sawLandRef.current)) { lastCmd = Date.now(); web.current.injectJavaScript('window.__juntosExitFull && window.__juntosExitFull(); true;'); }
      } else if (fullRef.current) sawLandRef.current = true;
      else if (armedRef.current && AppState.currentState === 'active') { armedRef.current = false; lastCmd = Date.now(); web.current.injectJavaScript('window.__juntosAutoFull && window.__juntosAutoFull(); true;'); }
    });
    return () => sub.remove();
  }, []);
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
    else if (m && m.type === 'fullscreen') setFullscreen(!!m.on, !!m.lock);
    else if (m && m.type === 'ad') setAd({ visible: !!m.visible, rect: m.rect || null });
    else if (m && m.type === 'ad-rewarded') showRewarded();
    else if (m && m.type === 'auth-google') authGoogle(m.url);
    else if (m && m.type === 'auth-apple') authApple();
  };
  // Al llegar a YouTube con la sesión iniciada se cierra la hoja y se recarga Juntos (comparten la sesión).
  const onLoginNav = (nav) => {
    if (!nav.loading && /^https:\/\/(m|www)\.youtube\.com\//i.test(nav.url || '')) { setYtLogin(false); setTimeout(() => web.current && web.current.reload(), 300); }
  };
  const fade = useRef(new Animated.Value(1)).current;
  const webCanBack = useRef(false);
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (ytLogin) { setYtLogin(false); return true; }
      // en pantalla completa, "atrás" solo sale de ella (como en YouTube), no de la sala
      if (fullRef.current && web.current) { web.current.injectJavaScript("window.__juntosExitFull && window.__juntosExitFull(); true;"); return true; }
      if (navId.current && navRef.current && navCanBack.current) { navRef.current.goBack(); return true; }
      if (webCanBack.current && web.current) { web.current.goBack(); return true; }
      return false;
    });
    return () => sub.remove();
  }, [ytLogin]);

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
    <KeyboardAvoidingView style={[styles.fill, pad]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <StatusBar style="light" hidden={full} />
      <View style={styles.fill}>
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
        dataDetectorTypes={["none"]}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        hideKeyboardAccessoryView
        keyboardDisplayRequiresUserAction={false}
        setSupportMultipleWindows={false}
        applicationNameForUserAgent={APP_TAG}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        onNavigationStateChange={(s) => { webCanBack.current = !!s.canGoBack; }}
        androidLayerType="hardware"
        mixedContentMode="never"
        injectedJavaScriptBeforeContentLoaded={BEFORE}
        onShouldStartLoadWithRequest={onShouldStart}
        onOpenWindow={(e) => { const u = e.nativeEvent.targetUrl; if (u) Linking.openURL(u).catch(() => {}); }}
        onLoadStart={(e) => { dbgNativo('onLoadStart ' + e.nativeEvent.url); navId.current = null; setNav(null); setFullscreen(false); }}
        onLoadEnd={(e) => { dbgNativo('onLoadEnd ' + e.nativeEvent.url); setStatus((s) => (s === 'error' ? s : 'listo')); if (adFilled.current) setTimeout(() => tellAd(true), 800); }}
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
            userAgent={NAV_UA}
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
            onNavigationStateChange={(s) => { navCanBack.current = !!s.canGoBack; toWeb({ id: nav.id, t: 'nav', url: s.url, title: s.title, loading: s.loading, canGoBack: s.canGoBack, canGoForward: s.canGoForward }); }}
            onError={(e) => { dbgNativo('navegador: error ' + JSON.stringify(e.nativeEvent).slice(0, 200)); toWeb({ id: nav.id, t: 'fail', code: e.nativeEvent.code, desc: e.nativeEvent.description }); }}
            onContentProcessDidTerminate={() => { dbgNativo('navegador: el proceso web se cerró, recargando'); navRef.current && navRef.current.reload(); }}
            onMessage={onNavMessage}
          />
        </View>
      )}

      {Ads && adCfg && adCfg.activo !== false && (
        // El banner se tiene listo fuera de la pantalla; solo se coloca en su hueco cuando la página lo permite.
        <View pointerEvents={adShow ? 'box-none' : 'none'} style={{ position: 'absolute', left: adShow ? adRect.x : -3000, top: adShow ? adRect.y : 0, width: adRect.w, height: adRect.h, alignItems: 'center', justifyContent: 'center', opacity: adShow ? 1 : 0 }}>
          <Ads.BannerAd
            key={adKey}
            unitId={adCfg.banner || Ads.TestIds.BANNER}
            size={Ads.BannerAdSize.BANNER}
            requestOptions={{ requestNonPersonalizedAdsOnly: true }}
            onAdLoaded={() => { dbgNativo('anuncio: cargó'); tellAd(true); }}
            onAdFailedToLoad={(e) => {
              dbgNativo('anuncio: no cargó ' + (e && (e.code || e.message)));
              tellAd(false); clearTimeout(adRetry.current); adRetry.current = setTimeout(() => setAdKey((k) => k + 1), 45000);
            }}
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
      </View>
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
