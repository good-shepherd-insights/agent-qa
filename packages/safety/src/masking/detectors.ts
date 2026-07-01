export const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

export function detectEmails(text: string): string[] {
  const matcher = new RegExp(EMAIL_RE.source, EMAIL_RE.flags)
  const seen = new Set<string>()
  const emails: string[] = []

  for (const match of text.matchAll(matcher)) {
    const email = match[0]
    if (seen.has(email)) continue
    seen.add(email)
    emails.push(email)
  }

  return emails
}
