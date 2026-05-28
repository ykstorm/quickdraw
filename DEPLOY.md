# Publishing Quickdraw

Quickdraw is a CLI + library + nightly dashboard. Three things.

## 1. npm publish

```bash
cd ~/projects/quickdraw
npm run lint && npm test && npm run build
git tag v1.0.0
git push --tags
# CI publish-npm fires
```

Verify:
```bash
npx @ykstorm/quickdraw --version
```

## 2. Nightly benchmark dashboard

Goal: `quickdraw.lakshyaraj.dev` serves fresh numbers every morning.

Setup once:
1. Repo Settings → Pages → Source = `gh-pages` branch
2. Repo Settings → Secrets:
   - `OPENAI_API_KEY_BENCH` — separate from your prod key
   - `ANTHROPIC_API_KEY_BENCH` — separate from your prod key
3. Edit `.github/workflows/nightly-bench.yml` cron:
   ```yaml
   schedule:
     - cron: '0 1 * * *'   # 01:00 UTC daily
   ```
4. Custom domain: Pages settings → Custom domain → `quickdraw.lakshyaraj.dev`
5. Add CNAME `quickdraw` → `ykstorm.github.io` in your DNS

## 3. Cost discipline for nightly

Add a hard daily cap on the OpenAI side **and** the Anthropic side, separate from the in-runner cap:
- OpenAI: Dashboard → Usage → Set a daily limit on the benchmark API key
- Anthropic: Console → Workspaces → Per-key spend limit

This is belt-and-suspenders. Quickdraw enforces $5/run; provider-side enforces $10/day. Belt + suspenders.

## 4. Docker image (optional)

For CI runners that need a pinned env:
```bash
docker run --rm \
  -e OPENAI_API_KEY=$OPENAI_API_KEY \
  -v $PWD/results:/results \
  ghcr.io/ykstorm/quickdraw:latest \
  bench --providers openai --runs 5
```

Image is multi-stage, ~70 MB. Tagged on every release.

## 5. Smoke test after release

```bash
mkdir /tmp/qd && cd /tmp/qd
npm init -y && npm install @ykstorm/quickdraw
DRY_RUN=true npx quickdraw bench --providers openai --runs 1
# Should output a mock TTFT/TPS row and exit 0
```

## 6. Launch

- LinkedIn (linkedin-post.md Variant A)
- X (Variant C)
- Show HN: "Quickdraw — LLM streaming benchmarks with nightly public dashboard"
- r/LocalLLaMA: emphasize the local-vs-hosted comparison (when v1.2 ships)
- dev.to long-form: "TTFT vs total latency — measuring the right thing for LLM UX"
