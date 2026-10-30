import { describe, expect, it } from 'vitest';
import { LOAD_MORE } from '@/lib/dom/more';

describe('load more buttons', () => {
  it('knows "load more" labels, with a count after them too', () => {
    for (const t of ['Show 10 more', 'Load more', 'See more reviews (101,798)', 'More reviews (52)', 'View all reviews', 'クチコミをもっと見る（1,234 件）', '리뷰 더보기']) expect(LOAD_MORE.test(t), t).toBe(true);
  });
  it('leaves other buttons alone', () => {
    for (const t of ['Read more', 'More', 'Write a review', 'Show more of this', 'Sign in']) expect(LOAD_MORE.test(t), t).toBe(false);
  });
});
