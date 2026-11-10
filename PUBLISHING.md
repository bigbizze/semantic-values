# Publishing 0.2.0

The package is `semantic-values@0.2.0`: ESM-only, Node 24 or newer, Zod `^4.6.7` as a required peer, MIT licensed. `publishConfig` selects public access on the npm registry.

## Validate

```sh
npm ci --ignore-scripts
npm run check
npm pack --dry-run
```

Checks cover packed-package exports, declarations, runtime guarantees and independent reconstruction. `prepack` rebuilds JavaScript and declarations; `prepublishOnly` runs the full checks before a normal directory publication. Do not bypass these scripts for a release.

The archive contains the manifest, README, MIT license, API reference and built JavaScript/declarations. The package-inventory check rejects unexpected files without fixing internal module names. Source, tests, local configuration, logs and review artifacts are excluded.

## Publish a release

1. Authenticate with npm's supported login flow and the required two-factor authentication. Keep credentials outside this repository.
2. Confirm the account with `npm whoami --registry=https://registry.npmjs.org/` and verify publishing permission for `semantic-values`. A package lookup returning 404 does not reserve the name or prove permission.
3. Run the checks above from the clean release commit. Inspect the actual archive produced by `npm pack` as well as its file list.
4. After approval to publish, run `npm publish`. The configured registry and access are explicit; no additional package metadata changes are needed.
5. Confirm `npm view semantic-values@0.2.0 version dist.integrity --registry=https://registry.npmjs.org/`, verify public access and test a fresh consumer installation.

The repository contains no publication credentials or automatic publishing workflow. Packing and dry-run commands do not create an npm package. Making the GitHub repository public is separate from publishing to npm.
