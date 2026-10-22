# agent-qa Notice

agent-qa is provided by Pranshu Chittora.

Copyright 2026 Pranshu Chittora

agent-qa is licensed under the Functional Source License, Version 1.1, ALv2 Future License (FSL-1.1-ALv2). See `LICENSE.md` for the full license terms.

Under the Grant of Future License in `LICENSE.md`, each version of the Software is also granted under the Apache License, Version 2.0 effective on the second anniversary of the date that version was made available.

Third-party dependencies are distributed under their own license terms. This notice covers agent-qa itself and does not replace or modify notices required by third-party dependency owners.

## Bundled model

`assets/potion-retrieval-32m/` ships the embedding model `minishlab/potion-retrieval-32M` by Minish Lab (https://huggingface.co/minishlab/potion-retrieval-32M, revision `6fc8051fab2a1e0ee76689cf08c853792ac285e7`). agent-qa re-quantized its float32 embedding matrix to symmetric per-row int8 (`potion-retrieval-32m.i8bin`) and ships its tokenizer as `tokenizer.json`. The model is licensed under the MIT License, not under the FSL terms above; its licence text is `assets/potion-retrieval-32m/LICENSE`.
