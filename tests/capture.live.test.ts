// Live check of the trusted timestamp (RFC 3161) against freetsa.org. Only a fingerprint is sent.
// Runs only with GLEANER_LIVE=1.
import { describe, expect, it } from 'vitest';
import { requestTimestamp } from '@/lib/capture/record';
import { sha256 } from '@/lib/capture/formats';

const live = process.env.GLEANER_LIVE ? describe : describe.skip;
live('trusted timestamp', () => {
  it('freetsa.org grants a timestamp for a fingerprint', async () => {
    const sha = await sha256('Gleaner timestamp test');
    const tsr = await requestTimestamp(sha);
    // TimeStampResp ::= SEQUENCE { status PKIStatusInfo (SEQUENCE { INTEGER 0 = granted }), timeStampToken }
    const hex = [...tsr.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(tsr[0]).toBe(0x30);
    expect(hex).toMatch(/3003020100|3003020101/);
    // The signed token contains our fingerprint
    const all = [...tsr].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(all).toContain(sha);
    expect(tsr.length).toBeGreaterThan(1000);
  }, 30000);
});
