# Pre-420 report fixture

The empty report JSON and Markdown were generated from `buildEvalReport` and
`renderEvalReportMarkdown` at source commit `9afa58c2` (Phase 419). They are frozen
historical-format bytes, not current report fields deleted inside a test. The
empty decision document uses the unchanged `projectDecisionVectorsDocument`
contract from that commit. No operator corpus or provider was used.

The write-once tests copy all three files into a temporary committed root, then
compare their exact bytes and SHA-256 hashes after actual report regeneration,
baseline designation and identical recommit. Current output must conflict with
these historical bytes. Keep these fixtures unchanged when adding report fields.
