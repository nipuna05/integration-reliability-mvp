import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Android emulator reaches the dev machine at 10.0.2.2; use your hosted HTTPS URL in production.
const DEFAULT_URL = 'http://10.0.2.2:3000';

export default function App() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_URL);
  const [draftUrl, setDraftUrl] = useState(DEFAULT_URL);
  const [checks, setChecks] = useState([]);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, h] = await Promise.all(['/api/checks', '/api/history'].map((p) => fetch(serverUrl + p).then((r) => r.json())));
      setChecks(c);
      setHistory(h);
      setError(null);
    } catch (e) {
      setError(`Cannot reach ${serverUrl}`);
    } finally {
      setLoading(false);
    }
  }, [serverUrl]);

  useEffect(() => {
    AsyncStorage.getItem('serverUrl').then((u) => {
      if (u) { setServerUrl(u); setDraftUrl(u); }
    });
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const runNow = async () => {
    setRunning(true);
    try { await fetch(serverUrl + '/api/run', { method: 'POST' }); await load(); } catch { setError(`Cannot reach ${serverUrl}`); }
    setRunning(false);
  };

  const saveUrl = async () => {
    const url = draftUrl.trim().replace(/\/$/, '');
    await AsyncStorage.setItem('serverUrl', url);
    setServerUrl(url);
  };

  const failing = checks.filter((c) => history.find((h) => h.id === c.id && !h.ok)).length;

  return (
    <View style={s.screen}>
      <StatusBar style="auto" />
      <Text style={s.title}>Integration Reliability</Text>
      <Text style={[s.summary, failing ? s.bad : s.ok]}>
        {loading ? 'Loading…' : failing ? `${failing} check(s) failing` : 'All checks passing'}
      </Text>
      {error && <Text style={s.bad}>{error}</Text>}

      <FlatList
        data={checks}
        keyExtractor={(c) => c.id}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
        ListEmptyComponent={loading ? <ActivityIndicator /> : <Text style={s.muted}>No checks configured.</Text>}
        renderItem={({ item }) => {
          const runs = history.filter((h) => h.id === item.id);
          const last = runs[0];
          return (
            <View style={s.card}>
              <View style={s.row}>
                <Text style={s.name}>{item.name}</Text>
                <Text style={[s.pill, !last ? s.muted : last.ok ? s.ok : s.bad]}>{!last ? 'NOT RUN' : last.ok ? 'PASS' : 'FAIL'}</Text>
              </View>
              {last && !last.ok && <Text style={s.bad}>{last.failedStep}: {last.failures.join('; ')}</Text>}
              {last && <Text style={s.muted}>{new Date(last.at).toLocaleString()} · {last.ms}ms</Text>}
              <View style={s.spark}>
                {runs.slice(0, 30).reverse().map((r) => <View key={r.at} style={[s.tick, !r.ok && s.tickBad]} />)}
              </View>
            </View>
          );
        }}
      />

      <Pressable style={s.button} onPress={runNow} disabled={running}>
        <Text style={s.buttonText}>{running ? 'Running…' : 'Run checks now'}</Text>
      </Pressable>

      <TextInput style={s.input} value={draftUrl} onChangeText={setDraftUrl} onSubmitEditing={saveUrl} onBlur={saveUrl}
        autoCapitalize="none" autoCorrect={false} placeholder="Server URL" />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f6f7f9', paddingTop: 56, paddingHorizontal: 16, paddingBottom: 16 },
  title: { fontSize: 22, fontWeight: '700', color: '#1c2430' },
  summary: { fontSize: 16, marginVertical: 8, fontWeight: '600' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e3e6eb' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  name: { flex: 1, fontWeight: '600', color: '#1c2430' },
  pill: { fontWeight: '700' },
  ok: { color: '#1a7f4b' }, bad: { color: '#c62828' }, muted: { color: '#6b7686', fontSize: 13 },
  spark: { flexDirection: 'row', gap: 3, marginTop: 8 },
  tick: { width: 8, height: 16, borderRadius: 2, backgroundColor: '#1a7f4b' }, tickBad: { backgroundColor: '#c62828' },
  button: { backgroundColor: '#1c2430', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#e3e6eb', backgroundColor: '#fff', borderRadius: 8, padding: 10, marginTop: 8, color: '#1c2430' },
});
