/**
 * D-02's types-only memidex embedding seam from memory.md §5.2.
 *
 * Phase 376 binds the real implementation without changing rebuild logic. The fake embedder in
 * Phase 375 Plan 06 is the first implementer, keeping this phase free of model runtime code.
 */
export interface EmbedderPort {
  /**
   * Embed a canonical document rendering using the profile's document prefix (D-02, §5.2).
   * Phase 376 supplies the runtime; callers never observe prefix application.
   */
  embedDocument(rendering: string): Promise<Float32Array>

  /**
   * Embed a query rendering using the profile's query prefix (D-02, §5.2).
   * Phase 376 supplies the runtime through the same rebuild-logic-neutral contract.
   */
  embedQuery(rendering: string): Promise<Float32Array>
}
