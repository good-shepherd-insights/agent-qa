import type { Tokenizer } from '@huggingface/tokenizers'
import type { pipeline } from '@huggingface/transformers'

// These erased aliases reconcile the owned dependencies without loading either runtime.
// Executable imports remain inside the lazy acquisition modules introduced by 376 D-09/D-12.
export type FloorEmbeddingTokenizer = Tokenizer
export type NativeEmbeddingPipelineFactory = typeof pipeline
