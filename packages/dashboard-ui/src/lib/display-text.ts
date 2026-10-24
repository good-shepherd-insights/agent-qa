export function truncateText(
  text: string,
  maxWords: number,
): { readonly text: string; readonly isTruncated: boolean } {
  const words = text.split(/\s+/u).filter((word) => word !== '')
  // At or under the budget the input is returned unnormalised, byte for byte.
  if (words.length <= maxWords) return { text, isTruncated: false }
  return { text: `${words.slice(0, maxWords).join(' ')}...`, isTruncated: true }
}
