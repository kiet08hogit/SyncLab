This **patch release** adjusts the `isPlainObject` util to allow objects created via `Object.create(null)`, and fixes a type issue which accidentally made the store state type non-nullable.

## What's Changed
* fix(isPlainObject):  support check Object.create(null) by @zhe-he in https://github.com/reduxjs/redux/pull/4633
* fix(types/store): Unexpectedly narrowed return type of function `Store['getState']` by @exuanbo in https://github.com/reduxjs/redux/pull/4638

**Full Changelog**: https://github.com/reduxjs/redux/compare/v5.0.0...v5.0.1
