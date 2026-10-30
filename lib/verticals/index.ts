// The industry readers by name, so the panel, the page script and the crawler share one list.
import { extractJobs, JOB_COLUMNS } from './jobs';
import { extractProperties, PROPERTY_COLUMNS } from './realestate';
import { extractArticle, ARTICLE_COLUMNS } from './news';
import { extractBusinesses, extractTravel, BUSINESS_COLUMNS, TRAVEL_COLUMNS } from './places';
import { extractReviews, REVIEW_COLUMNS } from './reviews';
import type { Row } from './structured';

export type VerticalKind = 'jobs' | 'realestate' | 'articles' | 'travel' | 'business' | 'reviews';

export interface Vertical {
  label: string;
  /** One row, or many, read from a page (live or fetched). */
  extract: (doc: Document, url: string) => Row[];
  columns: readonly (readonly [string, string])[];
  /** Identity of a row, to drop the same item seen on two pages. */
  key: (r: Row) => string;
}

export const VERTICALS: Record<VerticalKind, Vertical> = {
  jobs: { label: 'jobs', extract: extractJobs, columns: JOB_COLUMNS, key: (r) => r.url || `${r.title}|${r.company}|${r.location}` },
  realestate: { label: 'properties', extract: extractProperties, columns: PROPERTY_COLUMNS, key: (r) => r.listing_id || r.url || `${r.address}|${r.price}` },
  articles: { label: 'articles', extract: (d, u) => [extractArticle(d, u)], columns: ARTICLE_COLUMNS, key: (r) => r.url || r.title },
  travel: { label: 'places', extract: extractTravel, columns: TRAVEL_COLUMNS, key: (r) => `${r.url}|${r.name}|${r.address}` },
  business: { label: 'businesses', extract: extractBusinesses, columns: BUSINESS_COLUMNS, key: (r) => `${r.url}|${r.name}|${r.phone}|${r.address}` },
  reviews: { label: 'reviews', extract: extractReviews, columns: REVIEW_COLUMNS, key: (r) => r.review_id || `${r.rating}|${r.title}|${(r.text ?? '').slice(0, 80)}|${r.date}|${(r.photos ?? '').slice(0, 60)}` },
};

/** A short fingerprint of what a page shows, to tell when the next page has loaded. */
export function rowsSignature(rows: Row[], key: (r: Row) => string): string {
  return `${rows.length}|${rows[0] ? key(rows[0]) : ''}|${rows.length ? key(rows[rows.length - 1]) : ''}`;
}
