import type { OwnershipContract } from '@vostride/agent-qa-arch'

export const AGENT_QA_DASHBOARD_UI_PACKAGE_NAME =
  '@vostride/agent-qa-dashboard-ui'
export const AGENT_QA_DASHBOARD_UI_PACKAGE_DIR = 'packages/dashboard-ui'
export const AGENT_QA_DASHBOARD_UI_PACKAGE_CLASSES = ['surface'] as const
export const AGENT_QA_DASHBOARD_UI_ALLOWED_RESPONSIBILITIES = [
  'React dashboard UI: live view, run-detail browser surface',
] as const
export const AGENT_QA_DASHBOARD_UI_FORBIDDEN_RESPONSIBILITIES = [
  'none - surface is unconstrained per spec section 4',
] as const
export const AGENT_QA_DASHBOARD_UI_EXTERNAL_DEPENDENCIES = [
  '@dnd-kit/core',
  '@dnd-kit/sortable',
  '@dnd-kit/utilities',
  '@fontsource-variable/geist',
  '@fontsource-variable/geist-mono',
  '@tanstack/react-table',
  'class-variance-authority',
  'clsx',
  'cmdk',
  'lucide-react',
  'marked',
  'monaco-editor',
  'motion',
  'radix-ui',
  'react',
  'react-dom',
  'react-icons',
  'react-resizable-panels',
  'react-router',
  'recharts',
  'sonner',
  'tailwind-merge',
  'tailwindcss',
  'tw-animate-css',
  'yaml',
] as const
export const AGENT_QA_DASHBOARD_UI_INTERNAL_DEPENDENCIES = [
  '@vostride/agent-qa-ids',
] as const

export const AGENT_QA_DASHBOARD_UI_OWNERSHIP_CONTRACT = {
  packageName: AGENT_QA_DASHBOARD_UI_PACKAGE_NAME,
  packageDir: AGENT_QA_DASHBOARD_UI_PACKAGE_DIR,
  packageClasses: AGENT_QA_DASHBOARD_UI_PACKAGE_CLASSES,
  allowedResponsibilities: AGENT_QA_DASHBOARD_UI_ALLOWED_RESPONSIBILITIES,
  forbiddenResponsibilities: AGENT_QA_DASHBOARD_UI_FORBIDDEN_RESPONSIBILITIES,
  externalDependencies: AGENT_QA_DASHBOARD_UI_EXTERNAL_DEPENDENCIES,
  internalDependencies: AGENT_QA_DASHBOARD_UI_INTERNAL_DEPENDENCIES,
} as const satisfies OwnershipContract
