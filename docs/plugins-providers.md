# Provider Plugins

`plugins.providers` lets a first-party project add an external LLM provider without editing AgentQA core. It mirrors `plugins.auth`: each entry is either a package declaration or a path declaration, resolved relative to the config file.

```yaml
plugins:
  providers:
    - package: '@acme/agent-qa-provider'
    - path: './agent-qa-provider.mjs'
```

## Descriptor Shape

A provider plugin exports a declarative descriptor. The canonical shape is a single default descriptor:

```ts
export default {
  id: 'acme-gateway',
  label: 'Acme Gateway',
  authModes: ['api-key'],
  needsBaseURL: true,
  adapter(transport, modelId) {
    return openaiCompatible(transport, modelId)
  },
}
```

For parity with auth plugins, modules may also export a `providers` array:

```ts
export const providers = [
  {
    id: 'acme-gateway',
    label: 'Acme Gateway',
    authModes: ['api-key'],
    adapter(transport, modelId) {
      return openaiCompatible(transport, modelId)
    },
  },
]
```

The loader returns descriptors to the host. It does not register them from core, because core stays model-neutral; the CLI host bridges returned descriptors into the model provider registry.

## Composition

Provider plugins should compose the built-in adapter bodies from `@vostride/agent-qa-model` instead of reimplementing model streaming or response parsing. A plugin can import an adapter body such as `openaiCompatible`, rewrite the transport, and delegate:

```ts
import { openaiCompatible } from '@vostride/agent-qa-model'

export default {
  id: 'acme-gateway',
  label: 'Acme Gateway',
  authModes: ['api-key'],
  needsBaseURL: true,
  adapter(transport, modelId) {
    return openaiCompatible({
      ...transport,
      baseURL: rewriteBaseURL(transport),
      headers: signHeaders(transport),
    }, modelId)
  },
}
```

Credential resolution stays on the auth path. `authModes` is provider metadata; a novel credential flow is still a `plugins.auth` plugin.

## First-Party Only

Provider plugin modules run in-process with full Node access. They can read local files, environment variables, provider credentials, run artifacts, and screenshots available to the AgentQA process. This hook is a lifecycle extension point, not a security boundary.

Use `plugins.providers` only for first-party code until the container sandbox / execution-safety milestone exists. AgentQA intentionally does not ship an allowlist because the user controls their own config, but it emits a load-time warning whenever `plugins.providers` is non-empty.
