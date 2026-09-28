# Repository rules

This is a public repository. Do not add Co-Authored-By or Claude-Session trailers to commits. Disclose AI assistance only in the README colophon. Use Geppetto as the git author; environment variables such as GIT_AUTHOR_NAME override git config, so unset them (the pre-commit hook refuses any other identity). Keep secrets out of the repository; deployment tokens belong in Actions secrets. Run `npm run check-leaks` before committing. Maintain the locale list only in `src/i18n/locales.ts`.
