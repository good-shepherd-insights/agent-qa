# Older report fixture

`report.json` and `report.md` are an empty eval report written before the current
report fields existed, and `decisions.json` is its decision vectors document. No
operator corpus or provider was used.

The write-once tests copy all three files into a temporary committed root, then
compare their exact bytes and SHA-256 hashes after report regeneration, baseline
designation and an identical recommit. The current report must conflict with
`report.json`.
