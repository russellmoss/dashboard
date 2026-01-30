'use client';

import { useState } from 'react';
import { Send, AlertCircle, CheckCircle, Loader2, Upload, X } from 'lucide-react';
import { dashboardRequestsApi } from '@/lib/api-client';
import {
  CreateRequestInput,
  RequestType,
  RequestPriority,
  DASHBOARD_PAGES,
  TYPE_LABELS,
  PRIORITY_LABELS,
  DashboardRequestCard,
} from '@/types/dashboard-request';
import { RecentSubmissions } from './RecentSubmissions';

interface RequestFormProps {
  onSuccess?: () => void;
}

type FormData = {
  requestType: RequestType | '';
  title: string;
  description: string;
  priority: RequestPriority | '';
  affectedPage: string;
  // Data error specific fields
  filtersApplied: string;
  valueSeen: string;
  valueExpected: string;
  errorOccurredAt: string;
};

const initialFormData: FormData = {
  requestType: '',
  title: '',
  description: '',
  priority: '',
  affectedPage: '',
  filtersApplied: '',
  valueSeen: '',
  valueExpected: '',
  errorOccurredAt: '',
};

// Shared input styles for dark mode support
const inputStyles = "w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-400";
const selectStyles = "w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white";
const labelStyles = "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1";
const helperTextStyles = "mt-1 text-xs text-gray-500 dark:text-gray-400";

export function RequestForm({ onSuccess }: RequestFormProps) {
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const isDataError = formData.requestType === 'DATA_ERROR';

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    // Clear success/error when user starts editing
    if (success) setSuccess(false);
    if (error) setError(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      const validTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
      if (!validTypes.includes(file.type)) {
        setError('Please select a valid image file (PNG, JPEG, GIF, or WebP)');
        return;
      }
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        setError('File size must be less than 5MB');
        return;
      }
      setSelectedFile(file);
      setError(null);
    }
  };

  const removeFile = () => {
    setSelectedFile(null);
  };

  const handleSimilarRequestClick = (request: DashboardRequestCard) => {
    // Open the request in a new context or modal
    // For now, we'll just show an alert - this will be enhanced in Phase 8
    window.open(`/dashboard/requests?view=${request.id}`, '_blank');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Validate required fields
      if (!formData.requestType) {
        throw new Error('Please select a request type');
      }
      if (!formData.title.trim()) {
        throw new Error('Please enter a title');
      }
      if (!formData.description.trim()) {
        throw new Error('Please enter a description');
      }

      const input: CreateRequestInput = {
        title: formData.title.trim(),
        description: formData.description.trim(),
        requestType: formData.requestType as RequestType,
        priority: formData.priority ? (formData.priority as RequestPriority) : undefined,
        affectedPage: formData.affectedPage || undefined,
      };

      // Add data error specific fields
      if (isDataError) {
        if (formData.filtersApplied.trim()) {
          input.filtersApplied = formData.filtersApplied.trim();
        }
        if (formData.valueSeen.trim()) {
          input.valueSeen = formData.valueSeen.trim();
        }
        if (formData.valueExpected.trim()) {
          input.valueExpected = formData.valueExpected.trim();
        }
        if (formData.errorOccurredAt) {
          input.errorOccurredAt = formData.errorOccurredAt;
        }
      }

      await dashboardRequestsApi.create(input);

      // TODO: Handle file upload in Phase 9 (Wrike integration)
      // For now, we'll just note that a file was selected
      if (selectedFile) {
        console.log('File upload will be implemented with Wrike integration:', selectedFile.name);
      }

      setSuccess(true);
      setFormData(initialFormData);
      setSelectedFile(null);
      onSuccess?.();

      // Clear success message after 5 seconds
      setTimeout(() => setSuccess(false), 5000);
    } catch (err: any) {
      console.error('Failed to submit request:', err);
      setError(err.message || 'Failed to submit request. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Success Message */}
      {success && (
        <div className="p-4 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg flex items-start gap-3">
          <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-green-800 dark:text-green-200 font-medium">Request submitted successfully!</p>
            <p className="text-green-700 dark:text-green-300 text-sm mt-1">
              Your request has been added to the queue. You can track its progress on the Request Board.
            </p>
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {/* Request Type */}
      <div>
        <label htmlFor="requestType" className={labelStyles}>
          Request Type <span className="text-red-500">*</span>
        </label>
        <select
          id="requestType"
          name="requestType"
          value={formData.requestType}
          onChange={handleChange}
          required
          className={selectStyles}
        >
          <option value="">Select a type...</option>
          <option value="FEATURE_REQUEST">{TYPE_LABELS.FEATURE_REQUEST}</option>
          <option value="DATA_ERROR">{TYPE_LABELS.DATA_ERROR}</option>
        </select>
        <p className={helperTextStyles}>
          {formData.requestType === 'FEATURE_REQUEST' &&
            'Request new features, enhancements, or improvements to the dashboard.'}
          {formData.requestType === 'DATA_ERROR' &&
            'Report incorrect, missing, or unexpected data in the dashboard.'}
        </p>
      </div>

      {/* Title */}
      <div>
        <label htmlFor="title" className={labelStyles}>
          Title <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          id="title"
          name="title"
          value={formData.title}
          onChange={handleChange}
          required
          maxLength={200}
          placeholder="Brief summary of your request"
          className={inputStyles}
        />
        <RecentSubmissions
          searchText={formData.title}
          onSelectRequest={handleSimilarRequestClick}
        />
      </div>

      {/* Description */}
      <div>
        <label htmlFor="description" className={labelStyles}>
          Description <span className="text-red-500">*</span>
        </label>
        <textarea
          id="description"
          name="description"
          value={formData.description}
          onChange={handleChange}
          required
          rows={4}
          placeholder={
            isDataError
              ? 'Describe the data issue you encountered. What did you expect to see vs. what you actually saw?'
              : 'Describe your feature request in detail. What problem would it solve?'
          }
          className={`${inputStyles} resize-y`}
        />
      </div>

      {/* Priority (Optional) */}
      <div>
        <label htmlFor="priority" className={labelStyles}>
          Priority <span className="text-gray-400 dark:text-gray-500">(optional)</span>
        </label>
        <select
          id="priority"
          name="priority"
          value={formData.priority}
          onChange={handleChange}
          className={selectStyles}
        >
          <option value="">Select priority...</option>
          <option value="LOW">{PRIORITY_LABELS.LOW}</option>
          <option value="MEDIUM">{PRIORITY_LABELS.MEDIUM}</option>
          <option value="HIGH">{PRIORITY_LABELS.HIGH}</option>
          <option value="IMMEDIATE">{PRIORITY_LABELS.IMMEDIATE}</option>
        </select>
        <p className={helperTextStyles}>
          How urgent is this request? The RevOps team will review and adjust priority as needed.
        </p>
      </div>

      {/* Affected Page (Optional) */}
      <div>
        <label htmlFor="affectedPage" className={labelStyles}>
          Affected Page <span className="text-gray-400 dark:text-gray-500">(optional)</span>
        </label>
        <select
          id="affectedPage"
          name="affectedPage"
          value={formData.affectedPage}
          onChange={handleChange}
          className={selectStyles}
        >
          <option value="">Select a page...</option>
          {DASHBOARD_PAGES.map((page) => (
            <option key={page.id} value={page.name}>
              {page.name}
            </option>
          ))}
          <option value="Multiple Pages">Multiple Pages</option>
          <option value="Other">Other</option>
        </select>
      </div>

      {/* Data Error Specific Fields */}
      {isDataError && (
        <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Data Error Details <span className="text-gray-400 dark:text-gray-500">(all optional but helpful)</span>
          </h3>

          {/* Filters Applied */}
          <div>
            <label htmlFor="filtersApplied" className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
              Filters Applied
            </label>
            <textarea
              id="filtersApplied"
              name="filtersApplied"
              value={formData.filtersApplied}
              onChange={handleChange}
              rows={2}
              placeholder="e.g., Date range: Jan 1 - Jan 31, Channel: Organic, SGA: John Smith"
              className={`${inputStyles} resize-y text-sm`}
            />
          </div>

          {/* Value Seen */}
          <div>
            <label htmlFor="valueSeen" className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
              Value Seen (Incorrect)
            </label>
            <input
              type="text"
              id="valueSeen"
              name="valueSeen"
              value={formData.valueSeen}
              onChange={handleChange}
              placeholder="e.g., Shows 150 SQOs"
              className={`${inputStyles} text-sm`}
            />
          </div>

          {/* Value Expected */}
          <div>
            <label htmlFor="valueExpected" className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
              Value Expected (Correct)
            </label>
            <input
              type="text"
              id="valueExpected"
              name="valueExpected"
              value={formData.valueExpected}
              onChange={handleChange}
              placeholder="e.g., Should show 175 SQOs based on Salesforce report"
              className={`${inputStyles} text-sm`}
            />
          </div>

          {/* Error Occurred At */}
          <div>
            <label htmlFor="errorOccurredAt" className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
              When did you notice this?
            </label>
            <input
              type="datetime-local"
              id="errorOccurredAt"
              name="errorOccurredAt"
              value={formData.errorOccurredAt}
              onChange={handleChange}
              className={`${inputStyles} text-sm`}
            />
          </div>
        </div>
      )}

      {/* Screenshot Upload */}
      <div>
        <label className={labelStyles}>
          Screenshot <span className="text-gray-400 dark:text-gray-500">(optional)</span>
        </label>
        {selectedFile ? (
          <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{selectedFile.name}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {(selectedFile.size / 1024).toFixed(1)} KB
              </p>
            </div>
            <button
              type="button"
              onClick={removeFile}
              className="p-1 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        ) : (
          <label className="flex items-center justify-center gap-2 p-4 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
            <Upload className="w-5 h-5 text-gray-400 dark:text-gray-500" />
            <span className="text-sm text-gray-600 dark:text-gray-400">Click to upload a screenshot</span>
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
          </label>
        )}
        <p className={helperTextStyles}>
          PNG, JPEG, GIF, or WebP. Max 5MB.
        </p>
      </div>

      {/* Submit Button */}
      <div className="pt-4">
        <button
          type="submit"
          disabled={loading || !formData.requestType || !formData.title || !formData.description}
          className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Submitting...
            </>
          ) : (
            <>
              <Send className="w-5 h-5" />
              Submit Request
            </>
          )}
        </button>
      </div>
    </form>
  );
}
