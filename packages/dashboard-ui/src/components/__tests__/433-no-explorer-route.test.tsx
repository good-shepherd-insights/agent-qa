// @vitest-environment jsdom

// 433 D-22 (UI-011, PXH-UAT-03): no standalone Memory or Knowledge explorer is routed. Every
// explorer-shaped path, in plural, case, trailing-slash, hyphenated and sub-path spellings, must
// fall through the router's catch-all to Runs. The shipped-bundle twin is
// NO-EXPLORER-IN-SHIPPED-BUNDLE in packages/cli/src/__tests__/conformance/dashboard-dom.test.ts, and
// the static half is packages/arch/src/__tests__/433-knowledge-explorer-absent.test.ts.
//
// The setup below is a copy of `renderAppAt` and its mocks from update-banner.test.tsx, not an
// import: the 430 mutation gate counts that file's cells, so it stays untouched.

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const apiMock = vi.hoisted(() => ({
  fetchAppMetadata: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  fetchAppMetadata: apiMock.fetchAppMetadata,
}))

vi.mock('@/pages/runs', () => ({ default: () => <div data-testid="runs-page">Runs Page</div> }))
vi.mock('@/pages/run-detail', () => ({
  default: () => <div data-testid="run-detail-page">Run Detail Page</div>,
}))
vi.mock('@/pages/live-run', () => ({
  default: () => <div data-testid="live-run-page">Live Run Page</div>,
}))
vi.mock('@/pages/tests', () => ({ default: () => <div data-testid="tests-page">Tests Page</div> }))
vi.mock('@/pages/hooks', () => ({ default: () => <div data-testid="hooks-page">Hooks Page</div> }))
vi.mock('@/pages/hook-editor', () => ({
  default: () => <div data-testid="hook-editor-page">Hook Editor Page</div>,
}))
vi.mock('@/pages/hook-viewer', () => ({
  default: () => <div data-testid="hook-viewer-page">Hook Viewer Page</div>,
}))
vi.mock('@/pages/test-editor', () => ({
  default: () => <div data-testid="test-editor-page">Test Editor Page</div>,
}))
vi.mock('@/pages/test-viewer', () => ({
  default: () => <div data-testid="test-viewer-page">Test Viewer Page</div>,
}))
vi.mock('@/pages/insights', () => ({
  default: () => <div data-testid="insights-page">Insights Page</div>,
}))
vi.mock('@/pages/config', () => ({ default: () => <div data-testid="config-page">Config Page</div> }))
vi.mock('@/pages/suites', () => ({
  default: () => <div data-testid="suites-page">Suites Page</div>,
}))
vi.mock('@/pages/suite-editor', () => ({
  default: () => <div data-testid="suite-editor-page">Suite Editor Page</div>,
}))
vi.mock('@/pages/suite-viewer', () => ({
  default: () => <div data-testid="suite-viewer-page">Suite Viewer Page</div>,
}))

vi.mock('@/components/theme-provider', () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('@/components/ui/sidebar', () => ({
  SidebarProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarInset: ({ children, className }: { children: ReactNode; className?: string }) => (
    <section data-testid="sidebar-inset" className={className}>
      {children}
    </section>
  ),
}))
vi.mock('@/components/app-sidebar', () => ({
  AppSidebar: () => <div data-testid="app-sidebar" />,
}))
vi.mock('@/components/ui/sonner', () => ({
  Toaster: () => <div data-testid="toaster" />,
}))
vi.mock('@/components/command-palette', () => ({
  CommandPalette: () => <div data-testid="command-palette" />,
}))
vi.mock('@/components/product-tour', () => ({
  ProductTourProvider: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  ProductTourOverlay: () => <div data-testid="product-tour-overlay" />,
}))
vi.mock('@/components/error-boundary', () => ({
  RouteErrorBoundary: () => <div data-testid="route-error-boundary" />,
}))
vi.mock('@/components/page-skeleton', () => ({
  TableSkeleton: () => <div data-testid="table-skeleton" />,
  DetailSkeleton: () => <div data-testid="detail-skeleton" />,
  ChartSkeleton: () => <div data-testid="chart-skeleton" />,
  FormSkeleton: () => <div data-testid="form-skeleton" />,
  EditorSkeleton: () => <div data-testid="editor-skeleton" />,
}))

const EXPLORER_PATHS = [
  '/memory',
  '/memories',
  '/Memory',
  '/knowledge',
  '/knowledge/',
  '/knowledges',
  '/knowledge-base',
  '/memory/MEM-1',
  '/knowledge/explorer',
] as const

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  vi.resetModules()
  apiMock.fetchAppMetadata.mockReset()
  apiMock.fetchAppMetadata.mockResolvedValue({ version: '0.1.18' })
})

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount()
    })
  }
  root = null
  container?.remove()
  container = null
})

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function renderAppAt(path: string) {
  window.history.pushState({}, '', path)
  const { default: App } = await import('@/app')

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(<App />)
  })
  await flushAsyncWork()
}

describe('no standalone Memory or Knowledge explorer route (433 D-22, UI-011)', () => {
  it.each(EXPLORER_PATHS)('NO-EXPLORER-ROUTE: %s falls through the catch-all to Runs', async (path) => {
    await renderAppAt(path)

    expect(container?.querySelector('[data-testid="runs-page"]'), `${path} mounted no Runs page`).not.toBeNull()
    expect(window.location.pathname, `${path} did not land on /runs`).toBe('/runs')
  })
})
