'use client';

import { useState } from 'react';
import { Database, X, Copy, Check, RefreshCw, Trash2, AlertTriangle, Download } from 'lucide-react';
import { SafeUser } from '@/types/user';

interface McpKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  user: SafeUser | null;
}

export function McpKeyModal({ isOpen, onClose, onSaved, user }: McpKeyModalProps) {
  const [generating, setGenerating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!user) return;
    setGenerating(true);
    setError(null);
    setSuccess(null);
    setGeneratedKey(null);

    try {
      const response = await fetch(`/api/users/${user.id}/mcp-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to generate key');
      }
      const data = await response.json();
      setGeneratedKey(data.key);
      setSuccess('API key generated successfully');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleRevoke = async () => {
    if (!user) return;
    setRevoking(true);
    setError(null);
    setSuccess(null);
    setGeneratedKey(null);

    try {
      const response = await fetch(`/api/users/${user.id}/mcp-key`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to revoke key');
      }
      setSuccess('API key revoked');
      setTimeout(() => {
        onSaved();
      }, 1500);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRevoking(false);
    }
  };

  const handleRotate = async () => {
    if (!user) return;
    setRotating(true);
    setError(null);
    setSuccess(null);
    setGeneratedKey(null);

    try {
      const response = await fetch(`/api/users/${user.id}/mcp-key/rotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to rotate key');
      }
      const data = await response.json();
      setGeneratedKey(data.key);
      setSuccess('API key rotated successfully. Previous key has been revoked.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRotating(false);
    }
  };

  const handleCopy = async () => {
    if (!generatedKey) return;
    await navigator.clipboard.writeText(generatedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadConfig = () => {
    if (!generatedKey) return;
    const config = {
      mcpServers: {
        'savvy-bq': {
          type: 'http',
          url: 'https://savvy-mcp-server-e2vyxy5ipa-ue.a.run.app/mcp',
          headers: {
            Authorization: `Bearer ${generatedKey}`,
          },
        },
      },
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '.mcp.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClose = () => {
    setGeneratedKey(null);
    setError(null);
    setSuccess(null);
    setCopied(false);
    if (generatedKey || success) {
      onSaved();
    } else {
      onClose();
    }
  };

  if (!isOpen || !user) return null;

  const hasKey = user.hasMcpKey ?? false;
  const isLoading = generating || revoking || rotating;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={handleClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-full">
              <Database className="w-6 h-6 text-purple-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900">MCP API Key</h2>
          </div>
          <button
            onClick={handleClose}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-gray-600 mb-4">
          Manage BigQuery MCP API key for <strong>{user.name}</strong>
        </p>

        <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-gray-700">Key Status:</span>
            {hasKey ? (
              <span className="text-green-600 font-medium">Active</span>
            ) : (
              <span className="text-gray-400">No key</span>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
            {error}
          </div>
        )}

        {success && !generatedKey && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-600 text-sm">
            {success}
          </div>
        )}

        {generatedKey && (
          <div className="mb-4">
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-yellow-600" />
                <span className="text-sm font-medium text-yellow-800">
                  Copy this key now — it will not be shown again
                </span>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 p-2 bg-white border border-yellow-300 rounded text-sm font-mono text-gray-800 break-all">
                  {generatedKey}
                </code>
                <button
                  onClick={handleCopy}
                  className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors flex-shrink-0"
                  title="Copy to clipboard"
                >
                  {copied ? <Check className="w-5 h-5 text-green-600" /> : <Copy className="w-5 h-5" />}
                </button>
              </div>
              <button
                onClick={handleDownloadConfig}
                className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-purple-700 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors"
              >
                <Download className="w-4 h-4" />
                Download .mcp.json
              </button>
            </div>
            {success && (
              <p className="mt-2 text-sm text-green-600">{success}</p>
            )}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          {!hasKey && !generatedKey && (
            <button
              onClick={handleGenerate}
              disabled={isLoading}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? 'Generating...' : 'Generate Key'}
            </button>
          )}
          {hasKey && !generatedKey && (
            <>
              <button
                onClick={handleRotate}
                disabled={isLoading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw className="w-4 h-4" />
                {rotating ? 'Rotating...' : 'Rotate Key'}
              </button>
              <button
                onClick={handleRevoke}
                disabled={isLoading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-4 h-4" />
                {revoking ? 'Revoking...' : 'Revoke Key'}
              </button>
            </>
          )}
          {generatedKey && (
            <button
              onClick={handleClose}
              className="flex-1 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              Done
            </button>
          )}
          {!generatedKey && (
            <button
              onClick={handleClose}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
