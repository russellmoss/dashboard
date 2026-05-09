'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@tremor/react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

type RevealPolicy = 'manual' | 'auto_delay' | 'auto_immediate';

interface SettingsResponse {
  settings: {
    rep_id: string;
    policy: RevealPolicy;
    delay_minutes: number | null;
    reminder_minutes: number | null;
  } | null;
  notice?: string;
  error?: string;
}

const POLICY_LABEL: Record<RevealPolicy, string> = {
  manual: 'Manual — reviewer reveals each evaluation.',
  auto_delay: 'Auto with delay — reveal after N minutes.',
  auto_immediate: 'Auto-immediate — reveal as soon as evaluation completes.',
};

export default function SettingsTab() {
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [policy, setPolicy] = useState<RevealPolicy>('manual');
  const [delayMinutes, setDelayMinutes] = useState<number | null>(null);
  const [reminderMinutes, setReminderMinutes] = useState<number | null>(null);
  const [hasSettings, setHasSettings] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/call-intelligence/settings', { cache: 'no-store' });
        const json: SettingsResponse = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setNotice(json.error ?? `HTTP ${res.status}`);
          setHasSettings(false);
        } else if (json.settings === null) {
          setNotice(json.notice ?? 'No coaching account.');
          setHasSettings(false);
        } else {
          setPolicy(json.settings.policy);
          setDelayMinutes(json.settings.delay_minutes);
          setReminderMinutes(json.settings.reminder_minutes);
          setHasSettings(true);
        }
      } catch (err) {
        if (!cancelled) setNotice(err instanceof Error ? err.message : 'Failed to load settings');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  function handlePolicyChange(next: RevealPolicy) {
    setPolicy(next);
    setFieldErrors({});
    if (next !== 'auto_delay') {
      setDelayMinutes(null);
      setReminderMinutes(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setSaveSuccess(false);
    setFieldErrors({});

    if (policy === 'auto_delay' && (delayMinutes === null || delayMinutes < 1)) {
      setFieldErrors({
        delay_minutes: delayMinutes === 0
          ? "Use 'Auto-immediate' for no delay; minimum delay is 1 minute."
          : 'delay_minutes is required when policy is auto_delay (min 1).',
      });
      return;
    }
    if (
      reminderMinutes !== null &&
      delayMinutes !== null &&
      reminderMinutes >= delayMinutes
    ) {
      setFieldErrors({ reminder_minutes: 'reminder_minutes must be less than delay_minutes' });
      return;
    }

    setSaving(true);
    try {
      const body: { policy: RevealPolicy; delay_minutes: number | null; reminder_minutes: number | null } = {
        policy,
        delay_minutes: policy === 'auto_delay' ? delayMinutes : null,
        reminder_minutes: policy === 'auto_delay' ? reminderMinutes : null,
      };
      const res = await fetch('/api/call-intelligence/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        if (Array.isArray(json.issues)) {
          const next: Record<string, string> = {};
          for (const iss of json.issues as Array<{ path: (string | number)[]; message: string }>) {
            const key = String(iss.path[0] ?? 'form');
            next[key] = iss.message;
          }
          setFieldErrors(next);
        } else {
          setSaveError(json.error ?? `HTTP ${res.status}`);
        }
        return;
      }
      setSaveSuccess(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Card className="dark:bg-gray-800 dark:border-gray-700">
        <div className="py-12 flex justify-center"><LoadingSpinner /></div>
      </Card>
    );
  }

  if (!hasSettings) {
    return (
      <Card className="dark:bg-gray-800 dark:border-gray-700">
        <div className="py-8 px-4 text-sm text-gray-600 dark:text-gray-300">
          {notice ?? "Your account isn't registered as a coaching representative. Contact RevOps to provision a rep profile."}
        </div>
      </Card>
    );
  }

  return (
    <Card className="dark:bg-gray-800 dark:border-gray-700">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white">My Reveal Settings</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        How AI evaluations of your calls are revealed to you.
      </p>

      <div className="mb-4 px-4 py-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded text-sm text-amber-800 dark:text-amber-200">
        This policy applies to new evaluations going forward. Existing evaluations use the policy that was in effect when they were created.
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <fieldset>
          <legend className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Reveal policy</legend>
          {(Object.keys(POLICY_LABEL) as RevealPolicy[]).map((opt) => (
            <label key={opt} className="flex items-start gap-2 py-1 cursor-pointer">
              <input
                type="radio"
                name="policy"
                value={opt}
                checked={policy === opt}
                onChange={() => handlePolicyChange(opt)}
                className="mt-1"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">{POLICY_LABEL[opt]}</span>
            </label>
          ))}
        </fieldset>

        {policy === 'auto_delay' && (
          <div className="space-y-3 pl-6 border-l-2 border-gray-200 dark:border-gray-700">
            <div>
              <label htmlFor="delay_minutes" className="block text-sm font-medium text-gray-900 dark:text-gray-100">
                Delay (minutes)
              </label>
              <input
                id="delay_minutes"
                type="number"
                min={1}
                max={10080}
                value={delayMinutes ?? ''}
                onChange={(e) => setDelayMinutes(e.target.value === '' ? null : Number(e.target.value))}
                className="mt-1 block w-32 rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 shadow-sm text-sm"
              />
              {fieldErrors.delay_minutes && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.delay_minutes}</p>
              )}
              {delayMinutes === 0 && (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Use &apos;Auto-immediate&apos; for no delay; minimum delay is 1 minute.
                </p>
              )}
            </div>
            <div>
              <label htmlFor="reminder_minutes" className="block text-sm font-medium text-gray-900 dark:text-gray-100">
                Reminder (minutes, optional)
              </label>
              <input
                id="reminder_minutes"
                type="number"
                min={1}
                value={reminderMinutes ?? ''}
                onChange={(e) => setReminderMinutes(e.target.value === '' ? null : Number(e.target.value))}
                className="mt-1 block w-32 rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 shadow-sm text-sm"
              />
              {fieldErrors.reminder_minutes && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.reminder_minutes}</p>
              )}
            </div>
          </div>
        )}

        {saveError && (
          <div className="px-4 py-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded">{saveError}</div>
        )}
        {saveSuccess && (
          <div className="px-4 py-2 text-sm text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/20 rounded">Settings saved.</div>
        )}

        <div>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded"
          >
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </form>

      <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
          Refinement requests
        </h3>
        <Link
          href="/dashboard/call-intelligence/my-refinements"
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          My refinement requests →
        </Link>
      </div>
    </Card>
  );
}
