import { describe, it, expect } from 'vitest';
import { imapConfigFromAccount } from '../src/services/email/imapReader.ts';

describe('imapConfigFromAccount', () => {
  it('maps the gmail provider to its IMAP host/port', () => {
    const cfg = imapConfigFromAccount({ provider: 'gmail', address: 'me@gmail.com', config: { appPassword: 'abcd efgh ijkl mnop' } });
    expect(cfg).toEqual({ host: 'imap.gmail.com', port: 993, secure: true, user: 'me@gmail.com', pass: 'abcd efgh ijkl mnop' });
  });

  it('maps outlook and icloud', () => {
    expect(imapConfigFromAccount({ provider: 'outlook', address: 'me@outlook.com', config: { appPassword: 'x' } })?.host)
      .toBe('outlook.office365.com');
    expect(imapConfigFromAccount({ provider: 'icloud', address: 'me@icloud.com', config: { appPassword: 'x' } })?.host)
      .toBe('imap.mail.me.com');
  });

  it('uses explicit host/port for a custom provider', () => {
    const cfg = imapConfigFromAccount({ provider: 'custom', address: 'me@corp.com', config: { appPassword: 'x', host: 'mail.corp.com', port: 143, secure: false } });
    expect(cfg).toEqual({ host: 'mail.corp.com', port: 143, secure: false, user: 'me@corp.com', pass: 'x' });
  });

  it('returns null when the app password is missing', () => {
    expect(imapConfigFromAccount({ provider: 'gmail', address: 'me@gmail.com', config: {} })).toBeNull();
  });

  it('returns null when a custom provider has no host', () => {
    expect(imapConfigFromAccount({ provider: 'custom', address: 'me@corp.com', config: { appPassword: 'x' } })).toBeNull();
  });
});
