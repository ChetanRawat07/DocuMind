import {
  type Analytics,
  type AnalyticsRange,
  type ConfidenceBucket,
  type DocumentType,
  isTimeZone,
} from '@documind/shared';
import { DOCUMENT_TYPE_LABEL } from './document-labels';
import { formatPercent } from './format';

/** The viewer's IANA timezone, which decides where their days start; UTC when unknown. */
export function viewerTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return zone && isTimeZone(zone) ? zone : 'UTC';
}

/** API path of the viewer's analytics for the last `days` days. */
export function analyticsPath(days: AnalyticsRange, timeZone = viewerTimeZone()): string {
  return `/analytics?days=${String(days)}&tz=${encodeURIComponent(timeZone)}`;
}

export const CONFIDENCE_BUCKET_LABEL: Record<ConfidenceBucket, string> = {
  below_50: 'Below 50%',
  '50_to_70': '50–70%',
  '70_to_90': '70–90%',
  '90_and_above': '90% and above',
};

export function documentTypeLabel(type: DocumentType | 'unclassified'): string {
  return type === 'unclassified' ? 'Unclassified' : DOCUMENT_TYPE_LABEL[type];
}

/** The correction-rate KPI's value and its explanation, shared by both pages. */
export function correctionRateKpi(analytics: Analytics): { value: string | null; hint: string } {
  const { corrections } = analytics;
  return corrections.rate === null
    ? { value: null, hint: 'No reviewed values yet' }
    : {
        value: formatPercent(corrections.rate),
        hint: `of ${corrections.reviewedFields.toLocaleString()} reviewed values were corrected`,
      };
}
