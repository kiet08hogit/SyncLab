## What's Changed
* bump version to 8.17.1 by @jasoniangreen in https://github.com/ajv-validator/ajv/pull/2472


**Full Changelog**: https://github.com/ajv-validator/ajv/compare/v8.17.0...v8.17.1

## Plus everything in 8.17.0 which failed to release

The only functional change is to switch from uri-js (which is no longer supported), to fast-uri. This is the second attempt and the team on fast-uri have been really helpful addressing the issues we found last time.

Revert "Revert fast-uri change (https://github.com/ajv-validator/ajv/pull/2444)" by @gurgunday in https://github.com/ajv-validator/ajv/pull/2448
fix: ignore new eslint error for @typescript-eslint/no-extraneous-class by @jasoniangreen in https://github.com/ajv-validator/ajv/pull/2455
docs: clarify behaviour of addVocabulary by @jasoniangreen in https://github.com/ajv-validator/ajv/pull/2454
docs: refactor to improve legibility by @blottn in https://github.com/ajv-validator/ajv/pull/2432
Fix grammatical typo in managing-schemas.md by @wetneb in https://github.com/ajv-validator/ajv/pull/2305
docs: Fix broken strict-mode link by @alexanderjsx in https://github.com/ajv-validator/ajv/pull/2459
feat: add test for encoded refs and bump fast-uri by @jasoniangreen in https://github.com/ajv-validator/ajv/pull/2449
fix: changes for @typescript-eslint/array-type rule by @jasoniangreen in https://github.com/ajv-validator/ajv/pull/2467
fixes https://github.com/ajv-validator/ajv/issues/2217 - clarify custom keyword naming by @jasoniangreen in https://github.com/ajv-validator/ajv/pull/2457
