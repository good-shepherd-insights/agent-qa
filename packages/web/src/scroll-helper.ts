import type { Page } from 'playwright-core'

interface ScrollRefData {
  role: string
  name?: string
  nth?: number
}

interface ScrollResult {
  bounds: { x: number; y: number; width: number; height: number } | null
  scrolledContainer: 'element' | 'ancestor' | 'documentElement' | 'notFound'
  scrolled: boolean
  /** The scrolled container's offset on the swiped axis before and after, and its largest offset. */
  offsets: { before: number; after: number; max: number }
}

export async function scrollWithRef(
  page: Page,
  refData: ScrollRefData,
  deltaX: number,
  deltaY: number,
  scrollAxis: 'horizontal' | 'vertical',
): Promise<ScrollResult> {
  return page.evaluate(
    (args: [string, string | undefined, number, number, number, string]) => {
      const [role, name, nth, dx, dy, axis] = args
      const doc = (globalThis as any).document
      const win = (globalThis as any).window

      const IMPLICIT_ROLES: Record<string, string> = {
        button: 'button', a: 'link', input: 'textbox', select: 'combobox',
        textarea: 'textbox', h1: 'heading', h2: 'heading', h3: 'heading',
        h4: 'heading', h5: 'heading', h6: 'heading', nav: 'navigation',
        main: 'main', aside: 'complementary', footer: 'contentinfo',
        header: 'banner', form: 'form', table: 'table', img: 'img',
        ul: 'list', ol: 'list', li: 'listitem', dialog: 'dialog',
        details: 'group', summary: 'button', progress: 'progressbar',
        meter: 'meter', output: 'status', article: 'article',
        section: 'region', fieldset: 'group', legend: 'legend',
      }
      const INPUT_TYPE_ROLES: Record<string, string> = {
        checkbox: 'checkbox', radio: 'radio', range: 'slider',
        number: 'spinbutton', search: 'searchbox', email: 'textbox',
        tel: 'textbox', url: 'textbox', password: 'textbox',
      }

      function getAccessibleName(el: any): string {
        const label = el.getAttribute('aria-label')
        if (label) return label.trim()
        const labelledBy = el.getAttribute('aria-labelledby')
        if (labelledBy) {
          const parts = labelledBy.split(/\s+/).map((id: string) => {
            const ref = doc.getElementById(id)
            return ref ? (ref.textContent || '').trim() : ''
          }).filter(Boolean)
          if (parts.length) return parts.join(' ')
        }
        const title = el.getAttribute('title')
        if (title) return title.trim()
        const alt = el.getAttribute('alt')
        if (alt) return alt.trim()
        return (el.textContent || '').trim()
      }

      function getImplicitRole(el: any): string | null {
        const tag = el.tagName.toLowerCase()
        if (tag === 'input') {
          const type = (el.getAttribute('type') || 'text').toLowerCase()
          return INPUT_TYPE_ROLES[type] || 'textbox'
        }
        if (tag === 'a' && el.hasAttribute('href')) return 'link'
        return IMPLICIT_ROLES[tag] || null
      }

      const candidates: any[] = []
      doc.querySelectorAll(`[role="${role}"]`).forEach((el: any) => candidates.push(el))
      doc.querySelectorAll('*').forEach((el: any) => {
        if (el.getAttribute('role')) return
        if (getImplicitRole(el) === role) candidates.push(el)
      })

      let matched = candidates
      if (name) {
        matched = candidates.filter((el: any) =>
          getAccessibleName(el).toLowerCase().includes(name.toLowerCase())
        )
      }

      const prop = axis === 'horizontal' ? 'scrollLeft' : 'scrollTop'
      const maxOf = (el: any): number => axis === 'horizontal'
        ? el.scrollWidth - el.clientWidth
        : el.scrollHeight - el.clientHeight

      const target = matched[nth]
      if (!target) {
        const scroller = doc.scrollingElement || doc.documentElement
        const before = scroller[prop]
        win.scrollBy(dx, dy)
        const after = scroller[prop]
        return {
          bounds: null,
          scrolledContainer: 'notFound' as const,
          scrolled: before !== after,
          offsets: { before, after, max: maxOf(scroller) },
        }
      }

      // Check target element itself for scrollability
      const targetStyle = win.getComputedStyle(target)
      const targetOverflow = axis === 'horizontal' ? targetStyle.overflowX : targetStyle.overflowY
      const targetScrollable = targetOverflow === 'auto' || targetOverflow === 'scroll' || targetOverflow === 'hidden'
      const targetHasContent = axis === 'horizontal'
        ? target.scrollWidth > target.clientWidth
        : target.scrollHeight > target.clientHeight
      if (targetScrollable && targetHasContent) {
        const before = target[prop]
        target.scrollBy(dx, dy)
        const after = target[prop]
        const rect = target.getBoundingClientRect()
        return {
          bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
          scrolledContainer: 'element' as const,
          scrolled: before !== after,
          offsets: { before, after, max: maxOf(target) },
        }
      }

      // Walk ancestors
      let parent = target.parentElement
      while (parent && parent !== doc.documentElement) {
        const style = win.getComputedStyle(parent)
        const overflow = axis === 'horizontal' ? style.overflowX : style.overflowY
        const isScrollable = overflow === 'auto' || overflow === 'scroll' || overflow === 'hidden'
        const hasContent = axis === 'horizontal'
          ? parent.scrollWidth > parent.clientWidth
          : parent.scrollHeight > parent.clientHeight
        if (isScrollable && hasContent) {
          const before = parent[prop]
          parent.scrollBy(dx, dy)
          const after = parent[prop]
          const rect = target.getBoundingClientRect()
          return {
            bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
            scrolledContainer: 'ancestor' as const,
            scrolled: before !== after,
            offsets: { before, after, max: maxOf(parent) },
          }
        }
        parent = parent.parentElement
      }

      const before = doc.documentElement[prop]
      doc.documentElement.scrollBy(dx, dy)
      const after = doc.documentElement[prop]
      const rect = target.getBoundingClientRect()
      return {
        bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        scrolledContainer: 'documentElement' as const,
        scrolled: before !== after,
        offsets: { before, after, max: maxOf(doc.documentElement) },
      }
    },
    [refData.role, refData.name, refData.nth ?? 0, deltaX, deltaY, scrollAxis] as [string, string | undefined, number, number, number, string],
  )
}
