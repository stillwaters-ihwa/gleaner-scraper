// Email checks that can be done honestly without sending mail: is the address well formed, is
// it a throwaway or role address, and can its domain receive mail at all (MX records). Whether
// one specific mailbox exists can only be known by the mail server, so that isn't claimed.
import { dns } from './domain';

const DISPOSABLE = new Set(
  '10minutemail.com 10minutemail.net 20minutemail.com 33mail.com anonaddy.com armyspy.com burnermail.io byom.de cuvox.de dayrep.com discard.email dispostable.com dropmail.me einrot.com emailondeck.com fakeinbox.com fakemail.net filzmail.com getairmail.com getnada.com grr.la guerrillamail.biz guerrillamail.com guerrillamail.de guerrillamail.info guerrillamail.net guerrillamail.org guerrillamailblock.com gustr.com harakirimail.com inboxbear.com incognitomail.org jetable.org jourrapide.com kasmail.com mail-temp.com mail.tm mailcatch.com maildrop.cc mailinator.com mailinator.net mailnesia.com mailpoof.com mailsac.com mintemail.com moakt.com mohmal.com mytemp.email mytrashmail.com nada.email nwytg.net one-time.email owlymail.com rhyta.com sharklasers.com spam4.me spambog.com spamgourmet.com spamex.com superrito.com teleworm.us temp-mail.io temp-mail.org tempail.com tempinbox.com tempmail.dev tempmail.net tempmailo.com tempr.email throwawaymail.com tmail.ws tmpmail.net tmpmail.org trash-mail.com trashmail.com trashmail.de trashmail.net wegwerfmail.de yopmail.com yopmail.fr yopmail.net zetmail.com'.split(' '),
);
const FREE = new Set('gmail.com googlemail.com yahoo.com yahoo.co.uk yahoo.co.jp ymail.com hotmail.com hotmail.co.uk outlook.com live.com msn.com aol.com icloud.com me.com mac.com proton.me protonmail.com gmx.com gmx.de web.de mail.ru yandex.ru yandex.com zoho.com naver.com hanmail.net daum.net kakao.com nate.com qq.com 163.com 126.com sina.com'.split(' '));
const ROLE = /^(info|contact|hello|hi|sales|support|help|admin|administrator|office|team|marketing|press|media|pr|billing|accounts?|finance|hr|jobs|careers|recruit(ing|ment)?|enquiries|inquiries|service|customerservice|cs|orders?|shop|store|webmaster|postmaster|hostmaster|abuse|noreply|no-reply|donotreply|privacy|legal|security|feedback|partners?|business|bd|wholesale)$/i;

// Practical address check (RFC 5322 allows more, but real mailboxes don't use it)
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

export interface EmailCheck {
  email: string;
  verdict: 'valid domain' | 'risky' | 'invalid' | 'no mail server';
  reason: string;
  format: 'ok' | 'bad';
  domain: string;
  mail_server: string;
  disposable: 'yes' | '';
  role_address: 'yes' | '';
  free_provider: 'yes' | '';
  suggestion: string;
}

const TYPOS: Record<string, string> = { 'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'hotmial.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'yaho.com': 'yahoo.com', 'yahoo.con': 'yahoo.com', 'outlok.com': 'outlook.com', 'iclod.com': 'icloud.com', 'naver.co': 'naver.com' };

/** Format, disposable, role and free-provider checks, with no network. */
export function emailBasics(raw: string): Omit<EmailCheck, 'mail_server' | 'verdict' | 'reason'> {
  const email = raw.trim().replace(/^mailto:/i, '').toLowerCase();
  const ok = EMAIL.test(email) && !email.includes('..') && !email.startsWith('.') && !email.split('@')[0].endsWith('.');
  const [local = '', domain = ''] = email.split('@');
  return {
    email,
    format: ok ? 'ok' : 'bad',
    domain,
    disposable: DISPOSABLE.has(domain) ? 'yes' : '',
    role_address: ROLE.test(local) ? 'yes' : '',
    free_provider: FREE.has(domain) ? 'yes' : '',
    suggestion: TYPOS[domain] ? `${local}@${TYPOS[domain]}` : '',
  };
}

/** Full check, including whether the domain has a mail server (one DNS lookup per domain). */
export async function checkEmail(raw: string, mxCache: Map<string, Promise<string[]>>, signal?: AbortSignal): Promise<EmailCheck> {
  const b = emailBasics(raw);
  if (b.format === 'bad') return { ...b, mail_server: '', verdict: 'invalid', reason: 'Not a valid email address' };
  if (!mxCache.has(b.domain)) mxCache.set(b.domain, dns(b.domain, 'MX', signal).then((r) => (r.length ? r : dns(b.domain, 'A', signal).then((a) => a.map(() => '(no MX, uses A record)')))));
  let mx: string[];
  try {
    mx = await mxCache.get(b.domain)!;
  } catch {
    return { ...b, mail_server: '', verdict: 'risky', reason: "Couldn't look up the domain right now" };
  }
  const server = mx.map((m) => m.split(' ').pop()).filter(Boolean)[0] ?? '';
  if (!mx.length) return { ...b, mail_server: '', verdict: 'no mail server', reason: `${b.domain} can't receive email` };
  if (b.suggestion) return { ...b, mail_server: server, verdict: 'risky', reason: `Possible typo, did you mean ${b.suggestion}?` };
  if (b.disposable) return { ...b, mail_server: server, verdict: 'risky', reason: 'Throwaway (disposable) email service' };
  return { ...b, mail_server: server ?? '', verdict: 'valid domain', reason: b.role_address ? 'Shared role address, not a person' : 'Address is well formed and the domain accepts mail' };
}
