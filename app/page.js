'use client';
import { useEffect, useState } from 'react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem,
} from '@/components/ui/select';

const CATEGORIES = ['gst_rate', 'vendor_tds_rate', 'statutory_rate', 'income_tax_slab', 'professional_tax_slab'];

export default function Page() {
  const [adminKey, setAdminKey] = useState('');
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [refreshStatus, setRefreshStatus] = useState(null);
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
    setSelected(new Set());
  }

  async function loadRefreshStatus() {
    if (!adminKey) return;
    const res = await fetch('/api/refresh', { headers: { 'x-admin-key': adminKey } });
    if (res.ok) setRefreshStatus(await res.json());
  }

  useEffect(() => { load(); loadRefreshStatus(); }, [adminKey]); // eslint-disable-line react-hooks/exhaustive-deps

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

  async function doApproveSelected() {
    if (!selected.size) return;
    const res = await fetch('/api/rates/bulk-approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
      body: JSON.stringify({ ids: [...selected] })
    });
    if (!res.ok) { setError((await res.json()).error || 'Failed to approve selected'); return; }
    load();
  }

  async function doRetract(id) {
    const retraction_reason = window.prompt('Reason for retracting this approved row (required — explain why it was wrong from inception, not a later change):');
    if (!retraction_reason) return; // cancelled, or empty — refuse a reasonless retraction from the UI too
    const res = await fetch(`/api/rates/${id}/retract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
      body: JSON.stringify({ retraction_reason })
    });
    if (!res.ok) { setError((await res.json()).error || 'Failed to retract'); return; }
    load();
  }

  function toggleSelected(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function StatusBadge({ r }) {
    if (r.retracted_at) return <Badge variant="destructive">retracted ({r.retracted_by})</Badge>;
    if (r.approved_at) return <Badge>approved ({r.approved_by})</Badge>;
    return <Badge variant="secondary">draft</Badge>;
  }

  return (
    <main className="mx-auto max-w-5xl p-6 flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Statutory Rates Hub</h1>
        <div className="mt-3 max-w-xs">
          <Label htmlFor="admin-key">Admin key</Label>
          <Input id="admin-key" type="password" value={adminKey} onChange={e => setAdminKey(e.target.value)} placeholder="x-admin-key" />
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {refreshStatus && (
        <Alert variant={refreshStatus.status === 'failed' ? 'destructive' : 'default'}>
          <AlertTitle>Daily refresh: {refreshStatus.status}</AlertTitle>
          <AlertDescription>
            {refreshStatus.completed_at || refreshStatus.started_at} — created {refreshStatus.created}, unchanged {refreshStatus.unchanged}, rejected {refreshStatus.rejected}
            {refreshStatus.error_message && <div>{refreshStatus.error_message}</div>}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>New draft</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-3 max-w-lg">
            <div className="flex flex-col gap-1.5">
              <Label>Category</Label>
              <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Payload (JSON)</Label>
              <Textarea rows={4} value={form.payload} onChange={e => setForm({ ...form, payload: e.target.value })}
                placeholder='e.g. {"hsn_code":"8481","rate_pct":18}' />
            </div>
            <div className="flex gap-3">
              <div className="flex flex-col gap-1.5 flex-1">
                <Label>Effective from</Label>
                <Input type="date" value={form.effective_from} onChange={e => setForm({ ...form, effective_from: e.target.value })} required />
              </div>
              <div className="flex flex-col gap-1.5 flex-1">
                <Label>Effective to (optional)</Label>
                <Input type="date" value={form.effective_to} onChange={e => setForm({ ...form, effective_to: e.target.value })} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Source</Label>
              <Input value={form.source_ref} onChange={e => setForm({ ...form, source_ref: e.target.value })} placeholder="notification no. / URL" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Submitted by</Label>
              <Input value={form.submitted_by} onChange={e => setForm({ ...form, submitted_by: e.target.value })} />
            </div>
            <Button type="submit" className="w-fit">Save draft</Button>
          </form>
        </CardContent>
      </Card>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">All rows</h2>
          <Button variant="outline" size="sm" onClick={doApproveSelected} disabled={!selected.size}>
            Approve selected ({selected.size})
          </Button>
        </div>
        <div className="overflow-x-auto rounded-lg ring-1 ring-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>id</TableHead>
                <TableHead>category</TableHead>
                <TableHead>payload</TableHead>
                <TableHead>effective</TableHead>
                <TableHead>source</TableHead>
                <TableHead>status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id}>
                  <TableCell>
                    {!r.approved_at && (
                      <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggleSelected(r.id)} />
                    )}
                  </TableCell>
                  <TableCell>{r.id}</TableCell>
                  <TableCell>{r.category}</TableCell>
                  <TableCell className="max-w-xs whitespace-normal">
                    <code className="text-xs bg-muted rounded px-1 py-0.5 whitespace-normal break-words">{JSON.stringify(r.payload)}</code>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {r.effective_from}{r.effective_to ? ` → ${r.effective_to}` : ''}
                  </TableCell>
                  <TableCell className="max-w-sm whitespace-normal text-sm text-muted-foreground">{r.source_ref}</TableCell>
                  <TableCell className="max-w-xs whitespace-normal">
                    <StatusBadge r={r} />
                    {r.retracted_at && r.retraction_reason && (
                      <div className="mt-1 text-xs text-muted-foreground">{r.retraction_reason}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    {!r.approved_at && <Button size="sm" variant="outline" onClick={() => doApprove(r.id)}>Approve</Button>}
                    {r.approved_at && !r.retracted_at && <Button size="sm" variant="destructive" onClick={() => doRetract(r.id)}>Retract</Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </main>
  );
}
