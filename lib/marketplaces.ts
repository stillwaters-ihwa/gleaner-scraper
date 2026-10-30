// Marketplace searches and ASIN lookups, built on the store extractor. A search opens the
// marketplace's own results page and reads it page by page, like "This page" in the Store
// extractor; an ASIN lookup reads each product page.

export interface Marketplace {
  id: string;
  name: string;
  origin: string;
  search: (q: string) => string;
}

const enc = encodeURIComponent;
export const MARKETPLACES: Marketplace[] = [
  { id: 'amazon-us', name: 'Amazon.com', origin: 'https://www.amazon.com', search: (q) => `https://www.amazon.com/s?k=${enc(q)}` },
  { id: 'amazon-uk', name: 'Amazon.co.uk', origin: 'https://www.amazon.co.uk', search: (q) => `https://www.amazon.co.uk/s?k=${enc(q)}` },
  { id: 'amazon-de', name: 'Amazon.de', origin: 'https://www.amazon.de', search: (q) => `https://www.amazon.de/s?k=${enc(q)}` },
  { id: 'amazon-jp', name: 'Amazon.co.jp', origin: 'https://www.amazon.co.jp', search: (q) => `https://www.amazon.co.jp/s?k=${enc(q)}` },
  { id: 'amazon-ca', name: 'Amazon.ca', origin: 'https://www.amazon.ca', search: (q) => `https://www.amazon.ca/s?k=${enc(q)}` },
  { id: 'walmart', name: 'Walmart', origin: 'https://www.walmart.com', search: (q) => `https://www.walmart.com/search?q=${enc(q)}` },
  { id: 'ebay', name: 'eBay', origin: 'https://www.ebay.com', search: (q) => `https://www.ebay.com/sch/i.html?_nkw=${enc(q)}` },
  { id: 'etsy', name: 'Etsy', origin: 'https://www.etsy.com', search: (q) => `https://www.etsy.com/search?q=${enc(q)}` },
  { id: 'target', name: 'Target', origin: 'https://www.target.com', search: (q) => `https://www.target.com/s?searchTerm=${enc(q)}` },
  { id: 'aliexpress', name: 'AliExpress', origin: 'https://www.aliexpress.com', search: (q) => `https://www.aliexpress.com/w/wholesale-${enc(q.trim().replace(/\s+/g, '-'))}.html` },
  { id: 'alibaba', name: 'Alibaba', origin: 'https://www.alibaba.com', search: (q) => `https://www.alibaba.com/trade/search?SearchText=${enc(q)}` },
  { id: 'yesstyle', name: 'YesStyle', origin: 'https://www.yesstyle.com', search: (q) => `https://www.yesstyle.com/en/list.html?q=${enc(q)}` },
  { id: 'oliveyoung', name: 'Olive Young Global', origin: 'https://global.oliveyoung.com', search: (q) => `https://global.oliveyoung.com/display/search?query=${enc(q)}` },
  { id: 'stylevana', name: 'Stylevana', origin: 'https://www.stylevana.com', search: (q) => `https://www.stylevana.com/en_US/catalogsearch/result/?q=${enc(q)}` },
];

/** ASINs from pasted text: bare ASINs or any Amazon product link. */
export function parseAsins(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:\/dp\/|\/gp\/product\/|\/product\/|asin=)([A-Z0-9]{10})|\b(B0[A-Z0-9]{8})\b|\b(\d{9}[\dX])\b/gi)) out.add((m[1] ?? m[2] ?? m[3]).toUpperCase());
  return [...out];
}

export const asinUrl = (origin: string, asin: string) => `${origin}/dp/${asin}`;
