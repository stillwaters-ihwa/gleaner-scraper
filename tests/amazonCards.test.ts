// @vitest-environment happy-dom
// Amazon search result cards: the price to pay, the struck list price (not the per-unit price),
// the review count (not the star rating), and the sponsored flag.
import { describe, expect, it } from 'vitest';
import { cardProduct } from '@/lib/dom/cards';

const card = (inner: string) => {
  document.body.innerHTML = `<div data-component-type="s-search-result" data-asin="B00TEST001">${inner}</div>`;
  return cardProduct(document.body.firstElementChild!);
};

const BODY = `
  <div data-cy="title-recipe"><h2 aria-label="COSRX Snail Mucin 96% Power Repairing Essence 3.38 fl.oz"><span>COSRX Snail Mucin 96% Power Repairing Essence 3.38 fl.oz</span></h2></div>
  <div><span class="a-icon-alt">4.6 out of 5 stars</span><a href="/dp/B00TEST001#customerReviews" aria-label="108,570 ratings"><span class="s-underline-text">108,570</span></a></div>
  <span class="a-size-base a-color-secondary">10K+ bought in past month</span>
  <span class="a-price" data-a-size="xl"><span class="a-offscreen">$17.00</span></span>
  <span class="a-size-base a-color-secondary">(<span class="a-price a-text-price" data-a-size="b"><span class="a-offscreen">$5.03</span></span>/Fl Oz)</span>
  <div class="a-section aok-inline-block"><span class="a-size-base a-color-secondary">List: </span><span class="a-price a-text-price" data-a-strike="true"><span class="a-offscreen">$25.00</span></span></div>`;

describe('Amazon search result cards', () => {
  it('reads price, list price, unit price and review count', () => {
    const p = card(BODY);
    expect(p.price).toBe('17.00');
    expect(p.compare_at_price).toBe('25.00');
    expect(p.unit_price).toMatch(/\$5\.03\/Fl Oz/);
    expect(p.review_count).toBe('108570');
    expect(p.rating).toBe('4.6');
    expect(p.bought_past_month).toBe('10K+');
    expect(p.sponsored).toBe('');
  });

  it('never takes a per-unit price as the "was" price', () => {
    const p = card(BODY.replace(/<div class="a-section aok-inline-block">[\s\S]*$/, ''));
    expect(p.compare_at_price).toBe('');
    expect(p.price).toBe('17.00');
  });

  it('flags sponsored results', () => {
    expect(card(`<span class="puis-sponsored-label-text">Sponsored</span>${BODY}`).sponsored).toBe('yes');
  });
});
