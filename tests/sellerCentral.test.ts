// @vitest-environment happy-dom
// Seller Central's Manage All Inventory rows, laid out like the real page (values read through
// web components' shadow roots, the price in an input box).
import { describe, expect, it } from 'vitest';
import { deepLines, listingBlocks, readListing, sellerNextPage, sellerSignature } from '@/lib/dom/sellerCentral';

const LISTINGS = [
  { status: 'Active', updated: 'Oct 10, 2025, 04:13 PM', created: 'May 5, 2022, 05:56 PM', title: 'Women’s Skull & Halloween Print Leggings, Eye Furry Balls, One Size', asin: 'B07YMQFWC8', sku: 'S810-OS', fnsku: 'X002MZALDN', sales: '--', units: '--', views: '--', rank: '106,255', onHand: '50', available: '50', inbound: '0', unf: '0', reserved: '0', price: '13.99', sale: '$10.99', featured: '$10.99', fees: '$6.25', fba: '$5.70' },
  { status: 'Active', updated: 'Mar 29, 2026, 12:24 AM', created: 'May 5, 2022, 05:56 PM', title: 'Women’s Skull & Halloween Print Leggings, Crafty Ghosts, One Size', asin: 'B07HCV2PCF', sku: 'S602-OS', fnsku: 'X001W92M2X', sales: '$390', units: '36', views: '1,501', rank: '39,097', onHand: '24', available: '24', inbound: '0', unf: '0', reserved: '6', price: '13.99', sale: '', featured: '$13.99', fees: '$6.40', fba: '$5.70' },
];

/** A <kat-label>-style component whose text lives in its shadow root. */
function kat(doc: Document, text: string) {
  const el = doc.createElement('kat-label');
  el.attachShadow({ mode: 'open' }).innerHTML = `<span>${text}</span>`;
  return el;
}

function page() {
  const doc = document.implementation.createHTMLDocument('Manage All Inventory');
  const body = doc.body;
  const table = doc.createElement('div');
  table.className = 'mt-table';
  for (const l of LISTINGS) {
    const row = doc.createElement('div');
    row.className = 'mt-row';
    row.innerHTML = `
      <div class="col status"><div>${l.status}</div><div>${l.updated}</div><div>${l.created}</div></div>
      <div class="col details"><img src="https://m.media-amazon.com/images/I/${l.asin}.jpg"><a href="/abis/listing/edit?asin=${l.asin}">${l.title}</a><div>Sugar Skull, Pumpkin &amp; Ghost Prints, C...</div>
        <div class="kv"><span>ASIN</span><span>${l.asin}</span></div><div class="kv"><span>SKU</span><a>${l.sku}</a></div><div class="kv"><span>FNSKU</span><span>${l.fnsku}</span></div></div>
      <div class="col perf"><div class="kv"><span>Sales</span><span>${l.sales}</span></div><div class="kv"><span>Units sold</span><span>${l.units}</span></div><div class="kv"><span>Page views</span><span>${l.views}</span></div><div class="kv"><span>Sales rank</span><span>${l.rank}</span></div><div>(Clothing, Shoes &amp; Jewelry)</div></div>
      <div class="col inv"><div class="kv"><span>On-hand</span><span class="alert" aria-label="Low inventory alert">${l.onHand}</span></div><div>(FBA)</div><div class="kv"><span>Available</span><span>${l.available}</span></div><div class="kv"><span>Inbound</span><span>${l.inbound}</span></div><div class="kv"><span>Unfulfillable</span><span>${l.unf}</span></div><div class="kv"><span>Reserved</span><span>${l.reserved}</span></div></div>
      <div class="col price"><div class="kv"><span>Price</span><span>USD</span><span class="box"></span></div><div class="kv"><span>Shipping cost</span><span>+ $0.00</span></div>
        ${l.sale ? `<div class="kv"><span>Sale price</span><span>${l.sale} + $0.00</span></div>` : ''}<div class="kv"><span>Featured offer</span><span>${l.featured} + $0.00</span></div><div class="kv"><span>Competitive price</span><span>--</span></div><div class="kv"><span>Business price</span><span>Set</span></div></div>
      <div class="col fees"><div class="kv"><span>Total fees</span><span>${l.fees}</span></div><div class="kv"><span>FBA fee</span><span>${l.fba}</span></div></div>`;
    // The price box is an input inside a web component's shadow root, as on the real page
    const box = doc.createElement('kat-input');
    box.attachShadow({ mode: 'open' }).innerHTML = `<input type="text" value="${l.price}">`;
    row.querySelector('.box')!.append(box);
    // A label drawn inside a component
    row.querySelector('.status')!.append(kat(doc, ''));
    table.append(row);
  }
  body.append(table);
  // Pagination inside a component's shadow root
  const pager = doc.createElement('kat-pagination');
  pager.attachShadow({ mode: 'open' }).innerHTML = `<button aria-label="Previous page" disabled>‹</button><span aria-current="page">1</span><button aria-label="Next page" id="next">›</button>`;
  body.append(pager);
  return { doc, pager };
}

describe('Seller Central inventory', () => {
  it('finds one block per listing', () => {
    const { doc } = page();
    expect(listingBlocks(doc)).toHaveLength(2);
  });

  it('reads every value of a listing, the price from its input box', () => {
    const { doc } = page();
    const [a, b] = listingBlocks(doc).map((el) => readListing(el));
    expect(a).toMatchObject({
      status: 'Active',
      last_updated: 'Oct 10, 2025, 04:13 PM',
      created: 'May 5, 2022, 05:56 PM',
      asin: 'B07YMQFWC8',
      sku: 'S810-OS',
      fnsku: 'X002MZALDN',
      title: 'Women’s Skull & Halloween Print Leggings, Eye Furry Balls, One Size',
      sales_rank: '106255',
      rank_category: 'Clothing, Shoes & Jewelry',
      fulfilled_by: 'FBA',
      on_hand: '50',
      available: '50',
      inbound: '0',
      unfulfillable: '0',
      reserved: '0',
      price: '13.99',
      currency: 'USD',
      sale_price: '$10.99',
      featured_offer: '$10.99',
      total_fees: '$6.25',
      fba_fee: '$5.70',
      product_url: 'https://www.amazon.com/dp/B07YMQFWC8',
    });
    expect(a.sales).toBeUndefined(); // "--" means none
    expect(b).toMatchObject({ asin: 'B07HCV2PCF', sales: '$390', units_sold: '36', page_views: '1501', sales_rank: '39097', reserved: '6', featured_offer: '$13.99' });
    expect(b.sale_price).toBeUndefined();
  });

  it('reads through shadow roots and input values', () => {
    const { doc } = page();
    expect(deepLines(listingBlocks(doc)[0])).toContain('[input] 13.99');
  });

  it('finds the next page button inside the pager component and tells pages apart', () => {
    const { doc, pager } = page();
    let clicked = false;
    pager.shadowRoot!.getElementById('next')!.addEventListener('click', () => (clicked = true));
    expect(sellerNextPage(doc)).toBe(true);
    expect(clicked).toBe(true);
    expect(sellerSignature(doc)).toBe('2|B07YMQFWC8|B07HCV2PCF');
    (pager.shadowRoot!.getElementById('next') as HTMLButtonElement).disabled = true;
    expect(sellerNextPage(doc)).toBe(false);
  });
});
