# Araç Seti Envanteri (TOOLKIT_INVENTORY)

**Kontrol tarihi:** 30.10.2026. **Yöntem:** depoların yalnızca okunarak klonlanması (hiçbir şey çalıştırılmadı), `git ls-remote`, `npm view` / `pip index`. Oturum vekil sunucusu `api.github.com/repos/*` isteklerine 403 döndürdüğü için yıldız sayıları, "arşivlendi" bayrağı ve açık güvenlik bildirimleri **doğrulanamadı**. Son işlem tarihleri klonlanan HEAD'den alındı.

Bu denetimde **hiçbir araç kurulmadı**. Aşağıdaki kurulumlar onayınızı bekleyen önerilerdir.

## 1. Projede zaten olanlar

| Alan | Durum |
|---|---|
| Çalışma ortamı | Node 22.22.0 (CI: Node 22). `package.json` içinde `engines` alanı yok. |
| Playwright | `@playwright/test` 1.56.1 (en güncel 1.64.1), `@axe-core/playwright` 4.13.0. Tarayıcılar `/opt/pw-browsers` altında hazır. |
| Playwright yapılandırmaları | `playwright.config.ts` (tests/e2e, 10 senaryo; chromium + mobil; ayrı `hotelcost_e2e` veritabanı), `playwright.demo.config.ts`, `playwright.setup.config.ts`. Erişilebilirlik (axe) kontrolü `tests/e2e/hardening.spec.ts` içinde. |
| Birim/entegrasyon testleri | vitest 3.2.7, iki proje (`unit`, `integration`), `src/domain` ve `src/server/services` için v8 kapsam ölçümü tanımlı. |
| Kod kalitesi | eslint 9.39.5, typescript-eslint 8.71, TypeScript 5.9.3, Prisma 6.19.3, Next 15.5.27. |
| CI | `.github/workflows/ci.yml`: `npm ci` → prisma generate → VBA eşitlik kontrolü → tip kontrolü → lint → birim → entegrasyon (Postgres 17 servisiyle). **Playwright uçtan uca testleri CI'da çalışmıyor.** |
| Vercel | `vercel.json`: `npm run vercel-build` (ortam kontrolü, prisma generate, VBA üretimi, `migrate deploy`, reçete dondurma, next build), bölge `fra1`, gece işi `/api/cron/nightly` 04:00. |
| Depoda Claude yapılandırması | **Yok.** `.claude/`, `CLAUDE.md` veya `.mcp.json` bulunmuyor. |
| Kullanıcı düzeyinde Claude yapılandırması | `~/.claude/skills/security-audit` ve `~/.claude/skills/session-start-hook`. Projeyle ilgili MCP sunucusu yok. |
| Oturumda hazır olanlar (kurulum gerekmez) | `skill-creator`, `accessibility-review`, `design-critique`, `testing-strategy`, `security-review` becerileri; dosya, git, Bash ve web okuma araçları. |

## 2. Değerlendirme tablosu

| # | Depo | Sahibi / son işlem | Lisans | Sabitlenecek sürüm | Karar |
|---|---|---|---|---|---|
| 1 | bmad-code-org/BMAD-METHOD | BMad Code, LLC / 18.10.2026 | MIT (+ marka metni) | v6.12.4 | **Kurma** |
| 2 | github/spec-kit | GitHub / 30.10.2026 | MIT | v1.2.5 | **Kurma** (istenirse OpenSpec tercih edilmeli) |
| 3 | Fission-AI/OpenSpec | Fission-AI / 24.10.2026 | MIT | 1.15.0 | **İsteğe bağlı** |
| 4a | anthropics/skills → frontend-design | Anthropic / 28.10.2026 | Apache-2.0 | commit `ca45fc4` | **İsteğe bağlı** (yalnızca tanıtım/kayıt ekranı yeniden tasarımında) |
| 4b | anthropics/skills → webapp-testing | Anthropic | Apache-2.0 | commit `ca45fc4` | **Kurma** |
| 4c | anthropics/skills → skill-creator | Anthropic | Apache-2.0 | commit `ca45fc4` | **Kurma** (oturumda zaten var) |
| 5 | modelcontextprotocol/servers | MCP yönetim grubu / 28.10.2026 | MIT→Apache-2.0 geçişi | — | **Hiçbirini kurma** |
| 6 | cloudflare/security-audit-skill | Cloudflare / 14.09.2026 | MIT | commit `c1c8a8c` | **Zaten kurulu, birebir aynı; işlem yok** |
| 7 | microsoft/playwright | Microsoft / 30.10.2026 | Apache-2.0 | proje 1.56.1 | **Öneriliyor** (kurulu sürümle; yeni paket yok) |
| 8 | microsoft/playwright-mcp | Microsoft / 22.10.2026 | Apache-2.0 | 0.0.83 | **Kurma** (#7 aynı işi görüyor) |
| 9 | browser-use/browser-harness | Browser Use / 24.10.2026 | MIT | v0.1.13 | **Kurma** |
| 10 | browser-use/browser-use | Browser Use / 29.10.2026 | MIT | 0.13.14 | **Kurma** |

On deponun hepsi son 7–46 gün içinde güncellenmiş, yani hepsi aktif olarak bakılıyor.

## 3. Depo bazında gerekçeler

**1. BMAD-METHOD: kurma.**
- 32 beceri dosyalı, tam kapsamlı bir çevik süreç çerçevesi.
- `main` dalı v7 ön sürümü ve README "sürümler arası kırılan değişiklikler" uyarısı veriyor. Kararlı sürüm için Node, Python ve `uv` gerekiyor.
- Mevcut, iyi test edilmiş bir kod tabanında küçük bir ekip için gereğinden ağır; OpenSpec ve spec-kit ile örtüşüyor.
- Ücretli servis gerektirmiyor.
- Ücretsiz yerel alternatif: OpenSpec veya kısa bir `CLAUDE.md` kuralı.

**2. spec-kit: kurma.**
- Sağlam ve aktif bir proje, ama Python 3.11 ve `uv` araç zinciri gerektiriyor.
- Aşama kapıları ağır; `.specify/` klasörü ve birçok komut dosyası ekliyor.
- Tek bir planlama çerçevesi seçilmeli. Mevcut kod üzerindeki değişiklikler için OpenSpec'in "değişiklik farkı" modeli daha uygun.

**3. OpenSpec: isteğe bağlı.**
- Mevcut kod tabanları için hafif, spesifikasyon odaklı geliştirme aracı: öneri → spesifikasyon farkı → görevler → arşiv.
- Yalnızca Markdown ve Node; MIT lisanslı.
- Abonelik ve faturalama gibi bir sonraki büyük işleri kod yazılmadan önce yapılandırmaya yarar.
- **Telemetri varsayılan olarak açık.** Kapatmak için `OPENSPEC_TELEMETRY=0`.
- Kurulum: `npx -y @fission-ai/openspec@1.15.0 init`. `curl | sh` yükleyicisi kullanılmamalı.

**4a. frontend-design: isteğe bağlı.**
- 71 satırlık tek bir talimat dosyası; betik yok, anahtar gerektirmiyor.
- "Cesur" görsel tercihleri teşvik ediyor. Bu, tanıtım ve kayıt sayfası için uygun; yoğun Türkçe maliyet ekranlarının tutarlılığına ise ters düşer.

**4b. webapp-testing: kurma.**
- Python Playwright kullanıyor; proje TypeScript Playwright kullandığı için ikinci bir araç zinciri ve tarayıcı indirmesi gerektirir.
- Betikleri `shell=True` ile süreç başlatıyor.

**4c. skill-creator: projeye kurma.** Oturumda zaten mevcut.

**5. MCP referans sunucuları: hiçbiri kurulmamalı.**
- README'nin kendisi bunların "üretime hazır olmayan referans uygulamalar" olduğunu söylüyor.
- Güncel paketler Node 24 istiyor; proje, CI ve bu makine Node 22 kullanıyor.
- Kalan sunucular yerleşik araçlarla aynı işi görüyor.
- Cazip görünebilecek PostgreSQL sunucusu arşivlenmiş ve desteklenmiyor. Bir yapay zekâ ajanına doğrudan veritabanı bağlantısı verilmemeli.

**6. security-audit-skill: işlem gerekmez.**
- Yukarı akıştaki son sürümle (commit `c1c8a8c`) kurulu kopya birebir aynı; önceki güvenlik denetimi bu sürümle yapıldı.
- İsteğe bağlı: aynı sürüm proje içine `.claude/skills/security-audit/` olarak kopyalanabilir.

**7. Playwright: öneriliyor.**
- Kurulu 1.56.1 sürümü `npx playwright init-agents --loop=claude` ile **Playwright Test Agents** (planlayıcı, üretici, onarıcı) kurabiliyor.
- Yerel çalışıyor, anahtar gerektirmiyor ve yeni paket eklemiyor.
- Oluşturduğu dosyalar: `.claude/agents/playwright-test-*.md`, `.mcp.json` (yerel `playwright-test` sunucusu) ve boş bir `tests/e2e/seed.spec.ts`.
- Bu boş tohum dosyası, oturumu bir kez açıp kaydeden bir senaryoyla değiştirilmeli; giriş isteği hız sınırına takılıyor.
- Sürüm yükseltmesi (1.64.1) isteğe bağlı ve ayrı bir PR'da yapılmalı.

**8. playwright-mcp: kurma.**
- Kendi README'si kod ajanları için komut satırı + beceri yolunu öneriyor.
- Başka bir Chromium sürümü indiriyor ve kalıcı tarayıcı profili kullanıyor.
- İzinli kaynak listesi "güvenlik sınırı değil" diye belgelenmiş.

**9. browser-harness: kurma.**
- Kullanıcının oturum açık gerçek Chrome tarayıcısını tüm yetkiyle yönetiyor.
- Alfa aşamasında, telemetri içeriyor ve ücretli bulut seçenekleri var.
- Çok kiracılı bir uygulamanın regresyon testi için uygun değil.

**10. browser-use: kurma.**
- Ücretli bir LLM API anahtarı istiyor, yaklaşık 40 bağımlılığı ve telemetrisi var.
- Sonuçları her çalıştırmada değişebildiği için CI testine uygun değil.

## 4. Araç seti bulguları

| No | Bulgu | Önem | Kanıt | Öneri | Zorluk |
|---|---|---|---|---|---|
| TOOL-01 | Playwright uçtan uca testleri CI'da hiç çalışmıyor | ORTA | `ci.yml` entegrasyon testlerinde bitiyor; `tests/e2e` altında 10 senaryo var | CI'a e2e işi eklenmeli: Postgres, chromium kurulumu, build, `npm run test:e2e`, hata olursa raporun yüklenmesi | Orta |
| TOOL-02 | Depoda proje bağlamı yok | DÜŞÜK | `CLAUDE.md` ve `.claude/` yok | Kısa bir `CLAUDE.md` ve/veya `.claude/skills/hotelcost-dev/SKILL.md` yazılmalı: komutlar, test veritabanları, giriş hız sınırı, Türkçe çeviri kuralları | Küçük |
| TOOL-03 | Playwright 8 alt sürüm geride | DÜŞÜK | 1.56.1 (17.10.2025) ↔ 1.64.1 (14.10.2026) | Ayrı bir PR'da yükseltilmeli, tarayıcı yeniden kurulmalı | Küçük |
| TOOL-04 | MCP referans sunucuları Node 22 ile uyumsuz | BİLGİ | Paketler `node >=24` istiyor | Kullanılmamalı | — |

## 5. Onayınıza sunulan araç seti (hiçbiri çalıştırılmadı)

- **A. Önerilen: Playwright Test Agents.** Ücretsiz, yerel, yeni bağımlılık yok.
  `npx playwright init-agents --loop=claude --project chromium`
  Ardından oluşan boş `tests/e2e/seed.spec.ts`, giriş yapıp oturumu kaydeden bir tohum senaryoyla değiştirilir.
- **B. Önerilen: proje bağlamı.** Kök dizine `CLAUDE.md` ve `.claude/skills/hotelcost-dev/SKILL.md`; `.claude/settings.local.json` da `.gitignore`'a eklenir.
- **C. İsteğe bağlı:** kurulu security-audit becerisinin aynı sürümü (`c1c8a8c`, MIT) proje içine kopyalanır.
- **D. İsteğe bağlı:** frontend-design becerisi (`ca45fc4`, Apache-2.0); yalnızca tanıtım veya kayıt sayfası yeniden tasarlanacaksa.
- **E. İsteğe bağlı:** OpenSpec 1.15.0, telemetri kapalı (`OPENSPEC_TELEMETRY=0`); yalnızca spesifikasyon öncelikli bir çalışma düzeni istenirse.
- **F. İsteğe bağlı, ayrı PR:** `@playwright/test` 1.64.1'e yükseltilir ve A adımı yeniden çalıştırılır.

**Kurulmayacaklar:** BMAD-METHOD, spec-kit, webapp-testing, modelcontextprotocol/servers paketleri, playwright-mcp, browser-harness, browser-use.
