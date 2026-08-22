'use client';
import { useEffect, useState } from 'react';

const CATEGORIES = ['gst_rate', 'vendor_tds_rate', 'statutory_rate', 'income_tax_slab', 'professional_tax_slab'];

export default function Page() {
  const [adminKey, setAdminKey] = useState('');
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    category: CATEGORIES[0], payload: '{}', effective_from: '', effective_to: '', source_ref: '', submitted_by: ''
  });

  async function load() {
    if (!adminKey) return;
    const res = await fetch('/api/rates', { headers: { 'x-admin-key': adminKey } });
    if (!res.ok) { setError('Unauthorized or error loading rows'); setRows([]); return; }
    setError('');
    setRows(await res.json());
  }

  useEffect(() => { load(); }, [adminKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e.preventDefault();
    let payload;
    try { payload = JSON.parse(form.payload); } catch { setError('payload must be valid JSON'); return; }
    const res = await fetch('/api/rates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
      body: JSON.stringify({ ...form, payload })
    });
    if (!res.ok) { setError((await res.json()).error || 'Failed to save'); return; }
    setError('');
    setForm({ ...form, payload: '{}', effective_from: '', effective_to: '', source_ref: '', submitted_by: '' });
    load();
  }

  async function doApprove(id) {
    const res = await fetch(`/api/rates/${id}/approve`, { method: 'POST', headers: { 'x-admin-key': adminKey } });
    if (!res.ok) { setError((await res.json()).error || 'Failed to approve'); return; }
    load();
  }

  return (
    <main>
      <h1>Statutory Rates Hub</h1>
      <label>
        Admin key: <input type="password" value={adminKey} onChange={e => setAdminKey(e.target.value)} placeholder="x-admin-key" />
      </label>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      <h2>New draft</h2>
      <form onSubmit={submit}>
        <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <textarea rows={4} value={form.payload} onChange={e => setForm({ ...form, payload: e.target.value })}
          placeholder='payload JSON, e.g. {"hsn_code":"8481","rate_pct":18}' />
        <input type="date" value={form.effective_from} onChange={e => setForm({ ...form, effective_from: e.target.value })} required />
        <input type="date" value={form.effective_to} onChange={e => setForm({ ...form, effective_to: e.target.value })} placeholder="effective_to (optional)" />
        <input value={form.source_ref} onChange={e => setForm({ ...form, source_ref: e.target.value })} placeholder="source_ref: notification no. / URL" />
        <input value={form.submitted_by} onChange={e => setForm({ ...form, submitted_by: e.target.value })} placeholder="submitted_by" />
        <button type="submit">Save draft</button>
      </form>

      <h2>All rows</h2>
      <table>
        <thead><tr><th>id</th><th>category</th><th>payload</th><th>effective</th><th>source</th><th>status</th><th></th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td>{r.id}</td>
              <td>{r.category}</td>
              <td><code>{JSON.stringify(r.payload)}</code></td>
              <td>{r.effective_from}{r.effective_to ? ` → ${r.effective_to}` : ''}</td>
              <td>{r.source_ref}</td>
              <td className={r.approved_at ? 'approved' : 'draft'}>{r.approved_at ? `approved (${r.approved_by})` : 'draft'}</td>
              <td>{!r.approved_at && <button onClick={() => doApprove(r.id)}>Approve</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
