#!/bin/sh
# Publishes the app to GitHub Pages (https://salshangiti-sys.github.io/home-kitchen/).
# Builds with the local .env.local (the Supabase URL and publishable key, which are public by
# design and end up in the page anyway) and pushes the build to the gh-pages branch, which Pages
# serves. Run from the repository root, on main, after merging.
set -eu

npm run build -- --mode pages

out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
cp -R dist/. "$out"
touch "$out/.nojekyll" # serve files as they are, without Jekyll

source_commit=$(git rev-parse --short HEAD)
git -C "$out" init -q -b gh-pages
git -C "$out" add -A
git -C "$out" -c user.name="$(git config user.name)" -c user.email="$(git config user.email)" \
  commit -q -m "Publish $source_commit"
git -C "$out" push -q -f "$(git remote get-url origin)" gh-pages
echo "Published $source_commit to gh-pages"
