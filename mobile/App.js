import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createApi } from './src/api.js';
import { fmtAgo, fmtDuration, lastRunFor, normalizeUrl, overallState, scheduleLabel } from './src/format.js';
import { registerForPush } from './src/push.js';

// 10.0.2.2 is how the Android emulator reaches the PC it runs on. On a real phone use the PC's address, e.g. 192.168.1.20:3000.
const DEFAULT_URL = 'http://10.0.2.2:3000';
const TABS = [['status', 'Status'], ['incidents', 'Incidents'], ['add', 'Add'], ['settings', 'Settings']];

const theme = (dark) => dark
  ? { bg: '#12161c', card: '#1b212a', text: '#e6e9ee', muted: '#8c96a5', ok: '#4cc38a', bad: '#ff6b6b', line: '#2a323d', accent: '#8da2fb', onAccent: '#12161c' }
  : { bg: '#f6f7f9', card: '#ffffff', text: '#1c2430', muted: '#6b7686', ok: '#1a7f4b', bad: '#c62828', line: '#e3e6eb', accent: '#1c2430', onAccent: '#ffffff' };

export default function App() {
  const dark = useColorScheme() === 'dark';
  const t = useMemo(() => theme(dark), [dark]);
  const s = useMemo(() => makeStyles(t), [t]);

  const [booting, setBooting] = useState(true);
  const [serverUrl, setServerUrl] = useState('');
  const [token, setToken] = useState('');
  const [session, setSession] = useState(null);
  const [tab, setTab] = useState('status');
  const [data, setData] = useState({ checks: [], history: [], stats: { checks: {}, incidents: [] } });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const api = useMemo(() => (serverUrl ? createApi({ baseUrl: serverUrl, token }) : null), [serverUrl, token]);

  useEffect(() => {
    (async () => {
      const [u, tk] = await Promise.all([AsyncStorage.getItem('serverUrl'), AsyncStorage.getItem('token')]);
      if (u) setServerUrl(u);
      if (tk) setToken(tk);
      setBooting(false);
    })();
  }, []);

  useEffect(() => {
    if (!api) { setSession(null); return; }
    api.session().then(setSession).catch((e) => setSession({ error: e.message }));
  }, [api]);

  const needsConnect = !api || session?.error || (session && session.authRequired && !session.authed && !session.publicRead);

  const refresh = useCallback(async () => {
    if (!api || needsConnect || !session) return;
    setLoading(true);
    try {
      const [checks, history, stats] = await Promise.all([api.checks(), api.history(), api.stats()]);
      setData({ checks, history, stats });
      setError('');
    } catch (e) {
      setError(e.status === 401 ? 'Your sign-in expired. Open Settings and sign in again.' : e.message);
    } finally { setLoading(false); }
  }, [api, needsConnect, session]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function connect({ url, password, stay }) {
    const base = normalizeUrl(url);
    if (!base) throw new Error('Type the server address first.');
    const probe = createApi({ baseUrl: base });
    const sess = await probe.session();
    let newToken = '';
    if (sess.authRequired && password) newToken = await probe.login(password);
    else if (sess.authRequired && !sess.publicRead) throw new Error('This server needs a password.');
    await AsyncStorage.multiSet([['serverUrl', base], ['token', newToken]]);
    setToken(newToken);
    setServerUrl(base);
    if (!stay) setTab('status'); // signing in from Settings keeps you on Settings
  }

  async function disconnect() {
    await AsyncStorage.multiRemove(['serverUrl', 'token', 'pushToken']);
    setToken(''); setServerUrl(''); setSession(null);
    setData({ checks: [], history: [], stats: { checks: {}, incidents: [] } });
  }

  if (booting) return <View style={[s.screen, s.center]}><ActivityIndicator /></View>;

  if (needsConnect) {
    return (
      <View style={s.screen}>
        <StatusBar style={dark ? 'light' : 'dark'} />
        <Connect s={s} t={t} initialUrl={serverUrl || DEFAULT_URL} previousError={session?.error} onConnect={connect} />
      </View>
    );
  }

  const failingNow = overallState(data.checks, data.history).failing;
  return (
    <View style={s.screen}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Text style={s.title}>Integration Reliability</Text>
      {session && !session.authed && <Text style={s.guest}>Viewing as guest. Sign in under Settings to add checks and get phone alerts.</Text>}
      {!!error && <Text style={s.error}>{error}</Text>}
      <View style={{ flex: 1 }}>
        {tab === 'status' && <StatusTab s={s} t={t} data={data} session={session} api={api} loading={loading} refresh={refresh} />}
        {tab === 'incidents' && <IncidentsTab s={s} t={t} data={data} loading={loading} refresh={refresh} />}
        {tab === 'add' && <AddTab s={s} t={t} api={api} session={session} refresh={refresh} goSettings={() => setTab('settings')} />}
        {tab === 'settings' && <SettingsTab s={s} t={t} api={api} session={session} serverUrl={serverUrl} onDisconnect={disconnect} onSignIn={connect} />}
      </View>
      <View style={s.tabs}>
        {TABS.map(([key, label]) => (
          <Pressable key={key} style={s.tab} onPress={() => setTab(key)}>
            <Text style={[s.tabText, tab === key && s.tabActive]}>{label}{key === 'status' && failingNow ? ` (${failingNow})` : ''}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ---------- first screen: server address + password ----------
function Connect({ s, t, initialUrl, previousError, onConnect }) {
  const [url, setUrl] = useState(initialUrl);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function go() {
    setBusy(true); setErr('');
    try { await onConnect({ url, password }); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Text style={s.title}>Integration Reliability</Text>
      <Text style={s.muted}>Connect to your server to watch your checks from your phone.</Text>
      <View style={s.card}>
        <Text style={s.label}>Server address</Text>
        <TextInput style={s.input} value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="http://192.168.1.20:3000" placeholderTextColor={t.muted} />
        <Text style={s.hint}>On a real phone use your PC's address on the same Wi-Fi. The Android emulator uses 10.0.2.2.</Text>
        <Text style={s.label}>Password</Text>
        <TextInput style={s.input} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" placeholder="Leave empty to look around as a guest" placeholderTextColor={t.muted} />
        {!!(err || previousError) && <Text style={s.error}>{err || previousError}</Text>}
        <Btn s={s} primary label={busy ? 'Connecting…' : 'Connect'} onPress={go} disabled={busy} />
      </View>
    </ScrollView>
  );
}

// ---------- Status ----------
function StatusTab({ s, t, data, session, api, loading, refresh }) {
  const [running, setRunning] = useState(false);
  const sum = overallState(data.checks, data.history);
  const banner = sum.state === 'ok' ? { text: 'All checks passing', color: t.ok } : sum.state === 'bad' ? { text: `${sum.failing} of ${sum.total} checks failing`, color: t.bad } : { text: 'Waiting for the first run', color: t.muted };
  async function runNow() { setRunning(true); try { await api.run(); await refresh(); } catch { /* the error line shows on the next refresh */ } finally { setRunning(false); } }
  return (
    <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />} contentContainerStyle={{ paddingBottom: 16 }}>
      <Text style={[s.banner, { color: banner.color }]}>{banner.text}</Text>
      {data.checks.map((c) => {
        const last = lastRunFor(data.history, c.id);
        const up = data.stats.checks[c.id]?.uptime7d;
        return (
          <View key={c.id} style={s.card}>
            <View style={s.row}>
              <Text style={s.name}>{c.name}</Text>
              <Text style={[s.pill, { color: !last ? t.muted : last.ok ? t.ok : t.bad }]}>{!last ? 'NOT RUN' : last.ok ? 'PASS' : 'FAIL'}</Text>
            </View>
            <Text style={s.muted}>
              {last ? `${fmtAgo(last.at)} · ` : ''}{scheduleLabel(c, session?.defaultIntervalSec || 60)}{up && up.pct !== null ? ` · uptime ${up.pct}% (7d)` : ''}
            </Text>
            {last && !last.ok && <Text style={s.fail}>{last.failedStep}: {last.failures.join('; ')}</Text>}
            {last && !last.ok && last.explanation && <Text style={s.cause}>Likely cause: {last.explanation.text}</Text>}
            <View style={s.spark}>
              {data.history.filter((h) => h.id === c.id).slice(0, 30).reverse().map((h) => <View key={h.at} style={[s.tick, { backgroundColor: h.ok ? t.ok : t.bad }]} />)}
            </View>
          </View>
        );
      })}
      {!data.checks.length && <Text style={s.muted}>No checks yet. Use the Add tab.</Text>}
      <Btn s={s} primary label={running ? 'Running…' : 'Run checks now'} onPress={runNow} disabled={running} />
    </ScrollView>
  );
}

// ---------- Incidents ----------
function IncidentsTab({ s, t, data, loading, refresh }) {
  const list = data.stats.incidents;
  return (
    <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />} contentContainerStyle={{ paddingBottom: 16 }}>
      {!list.length && <Text style={s.muted}>No incidents recorded yet. When a check fails you will see it here, with how long it lasted and the likely cause.</Text>}
      {list.map((i) => (
        <View key={i.id} style={s.card}>
          <View style={s.row}>
            <Text style={s.name}>{i.name}</Text>
            <Text style={[s.pill, { color: i.ongoing ? t.bad : t.ok }]}>{i.ongoing ? 'ONGOING' : 'RESOLVED'}</Text>
          </View>
          <Text style={s.muted}>{new Date(i.startedAt).toLocaleString()} · {i.ongoing ? 'broken for' : 'lasted'} {fmtDuration(i.durationSec)}</Text>
          {!!i.failure && <Text style={s.fail}>{i.failedStep ? `${i.failedStep}: ` : ''}{i.failure}</Text>}
          {!!i.cause && <Text style={s.cause}>Likely cause: {i.cause}</Text>}
        </View>
      ))}
    </ScrollView>
  );
}

// ---------- Add a check from a curl command ----------
function AddTab({ s, t, api, session, refresh, goSettings }) {
  const [command, setCommand] = useState('');
  const [result, setResult] = useState(null);
  const [picked, setPicked] = useState({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  if (!session?.canEdit) {
    return (
      <View style={s.card}>
        <Text style={s.name}>Sign in to add checks</Text>
        <Text style={s.muted}>Adding a check makes the server call an address, so it needs your password.</Text>
        <Btn s={s} label="Go to Settings" onPress={goSettings} />
      </View>
    );
  }

  async function tryIt() {
    setBusy(true); setMsg(''); setResult(null); setPicked({});
    try { setResult(await api.curlImport(command)); } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }
  async function add() {
    setBusy(true);
    try {
      const fields = result.preview.fields.filter((f) => picked[f.path]);
      const c = await api.addCheck(result.check, fields);
      setMsg(`Added "${c.name}". It now runs automatically.`);
      setResult(null); setCommand('');
      await refresh();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
      <View style={s.card}>
        <Text style={s.name}>Paste a curl command</Text>
        <Text style={s.hint}>From API docs, Postman, or the browser (Network tab, Copy as cURL). The server calls it once, hides any key as a secret, and builds the check.</Text>
        <TextInput style={[s.input, { minHeight: 90, textAlignVertical: 'top' }]} multiline value={command} onChangeText={setCommand} autoCapitalize="none" autoCorrect={false} placeholder="curl https://api.example.com/status" placeholderTextColor={t.muted} />
        <Btn s={s} label={busy && !result ? 'Trying…' : 'Try it'} onPress={tryIt} disabled={busy || !command.trim()} />
      </View>
      {!!msg && <Text style={msg.startsWith('Added') ? s.okText : s.error}>{msg}</Text>}
      {result && (
        <View style={s.card}>
          <Text style={s.name}>The API answered with status {result.preview.status}</Text>
          {!!result.secretsSaved.length && <Text style={s.hint}>Saved {result.secretsSaved.length} key(s) as secrets: {result.secretsSaved.join(', ')}.</Text>}
          {!!result.preview.fields.length && <Text style={s.hint}>Also require these values (tick only stable ones, not times or IDs):</Text>}
          {result.preview.fields.map((f) => (
            <Pressable key={f.path} style={s.checkRow} onPress={() => setPicked((p) => ({ ...p, [f.path]: !p[f.path] }))}>
              <Text style={s.tickbox}>{picked[f.path] ? '☑' : '☐'}</Text>
              <Text style={s.text}>{f.path} = {JSON.stringify(f.value)}</Text>
            </Pressable>
          ))}
          <Btn s={s} primary label={busy ? 'Adding…' : 'Add this check'} onPress={add} disabled={busy} />
        </View>
      )}
    </ScrollView>
  );
}

// ---------- Settings: account, phone alerts ----------
function SettingsTab({ s, t, api, session, serverUrl, onDisconnect, onSignIn }) {
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [pushOn, setPushOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { AsyncStorage.getItem('pushToken').then((v) => setPushOn(!!v)); }, []);

  async function signIn() {
    setBusy(true); setMsg('');
    try { await onSignIn({ url: serverUrl, password, stay: true }); setPassword(''); } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }
  async function turnOn() {
    setBusy(true); setMsg('');
    try {
      const { token, label } = await registerForPush();
      await api.registerDevice(token, label);
      await AsyncStorage.setItem('pushToken', token);
      setPushOn(true);
      setMsg('Phone alerts are on. Use "Send a test alert" to check.');
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }
  async function turnOff() {
    setBusy(true); setMsg('');
    try {
      const tk = await AsyncStorage.getItem('pushToken');
      if (tk) await api.unregisterDevice(tk);
      await AsyncStorage.removeItem('pushToken');
      setPushOn(false);
      setMsg('Phone alerts are off for this phone.');
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }
  async function test() {
    setBusy(true); setMsg('');
    try { const r = await api.testAlert(); setMsg(`Phone push: ${r.push}\nEmail: ${r.email}\nChat: ${r.webhook}`); } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
      <View style={s.card}>
        <Text style={s.name}>Server</Text>
        <Text style={s.muted}>{serverUrl}</Text>
        <Text style={s.muted}>{session?.authed ? 'Signed in' : 'Guest (read only)'}</Text>
        {!session?.authed && (
          <>
            <Text style={s.label}>Password</Text>
            <TextInput style={s.input} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" placeholder="Server password" placeholderTextColor={t.muted} />
            <Btn s={s} primary label="Sign in" onPress={signIn} disabled={busy || !password} />
          </>
        )}
        <Btn s={s} label="Change server / sign out" onPress={onDisconnect} />
      </View>
      <View style={s.card}>
        <Text style={s.name}>Phone alerts</Text>
        <Text style={s.muted}>Get a notification when a check fails and when it recovers.</Text>
        {!session?.authed
          ? <Text style={s.hint}>Sign in first. Alerts are tied to your account.</Text>
          : (
            <>
              {pushOn ? <Btn s={s} label="Turn off alerts on this phone" onPress={turnOff} disabled={busy} /> : <Btn s={s} primary label="Turn on phone alerts" onPress={turnOn} disabled={busy} />}
              <Btn s={s} label="Send a test alert" onPress={test} disabled={busy} />
            </>
          )}
      </View>
      {!!msg && <Text style={msg.startsWith('Phone alerts are') || msg.startsWith('Phone push') ? s.okText : s.error}>{msg}</Text>}
    </ScrollView>
  );
}

function Btn({ s, label, onPress, primary, disabled }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[s.btn, primary && s.btnPrimary, disabled && { opacity: 0.5 }]}>
      <Text style={[s.btnText, primary && s.btnTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (t) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.bg, paddingTop: 52, paddingHorizontal: 16 },
  center: { alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700', color: t.text, marginBottom: 8 },
  banner: { fontSize: 17, fontWeight: '700', marginBottom: 10 },
  card: { backgroundColor: t.card, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: t.line },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 2 },
  name: { flex: 1, fontWeight: '600', fontSize: 15, color: t.text },
  pill: { fontWeight: '700', fontSize: 13 },
  muted: { color: t.muted, fontSize: 13, marginTop: 2 },
  hint: { color: t.muted, fontSize: 12, marginTop: 6, marginBottom: 4 },
  text: { color: t.text, fontSize: 14, flex: 1 },
  label: { color: t.text, fontWeight: '600', marginTop: 10, marginBottom: 4 },
  fail: { color: t.bad, fontSize: 13, marginTop: 6 },
  cause: { color: t.text, fontSize: 13, marginTop: 6, padding: 8, borderLeftWidth: 3, borderLeftColor: t.bad, backgroundColor: t.bg },
  error: { color: t.bad, fontSize: 13, marginVertical: 8 },
  okText: { color: t.ok, fontSize: 13, marginVertical: 8 },
  guest: { color: t.muted, fontSize: 12, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: t.line, backgroundColor: t.bg, color: t.text, borderRadius: 8, padding: 10, marginTop: 4 },
  spark: { flexDirection: 'row', gap: 3, marginTop: 8 },
  tick: { width: 8, height: 16, borderRadius: 2 },
  btn: { borderWidth: 1, borderColor: t.line, borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 10, backgroundColor: t.card },
  btnPrimary: { backgroundColor: t.accent, borderColor: t.accent },
  btnText: { color: t.text, fontWeight: '600' },
  btnTextPrimary: { color: t.onAccent },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  tickbox: { color: t.text, fontSize: 20 },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: t.line, paddingVertical: 10 },
  tab: { flex: 1, alignItems: 'center' },
  tabText: { color: t.muted, fontWeight: '600' },
  tabActive: { color: t.text, textDecorationLine: 'underline' },
});
