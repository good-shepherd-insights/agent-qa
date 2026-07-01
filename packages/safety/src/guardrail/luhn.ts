export function luhnValid(digits: string): boolean {
  if (digits.length < 11 || digits.length > 19) {
    return false
  }

  let sum = 0
  let shouldDouble = false

  for (let i = digits.length - 1; i >= 0; i--) {
    const digit = digits.charCodeAt(i) - 48

    if (digit < 0 || digit > 9) {
      return false
    }

    if (shouldDouble) {
      const doubled = digit * 2
      sum += doubled > 9 ? doubled - 9 : doubled
    } else {
      sum += digit
    }

    shouldDouble = !shouldDouble
  }

  return sum % 10 === 0
}
