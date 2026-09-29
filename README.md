# Mini DAW — vokal → armoni

Tarayıcıda çalışan, **tek dosyalık** (`index.html`) mini DAW. Tek sesli vokal kaydını analiz eder, gerekirse perdesini düzeltir ve altına piyano akorları yerleştirir. `index.html`'i tarayıcıda açmanız yeterli (oynatma için Tone.js ve Salamander piyano örnekleri CDN'den yüklenir; internet yoksa sentetik yedek piyano devreye girer).

## Akış (her adımın çıktısı bir sonrakinin girdisi)

| Adım | Ne yapar |
|---|---|
| 1. Proje ayarı | BPM (4/4 ve 3/4'te ♩, 6/8'de ♩. sayılır; alanın yanında yazar), ölçü 4/4 · 3/4 · 6/8, kayıt gecikmesi telafisi (ms). **Kalibre et**: 8 click çalar, her click'te el çırparsınız; click–alkış ofsetlerinin medyanı gecikme olarak kaydedilir |
| 2. Kayıt / yükleme | 1 ölçü count-in + metronom. Click yalnızca çıkışa gider, kayıt zincirine bağlı değildir (kulaklık kullanın). WAV/MP3 yükleme: ilk ses başlangıcı 1. ölçüye ya da en yakın vuruşa hizalanır, ofset elle de ayarlanır |
| 3. Pitch detection | pYIN benzeri: FFT'li YIN + Beta(2,18) eşik dağılımı + Viterbi. Nota olayları: başlangıç, süre, cent hassasiyetinde perde, en yakın nota. Vibrato/kaymalarda çekirdek bölgenin medyanı; sessizlik ve nefes atılır. Piano-roll + ince ham perde eğrisi |
| 3b. Etiket düzeltme | Ses değişmez, yalnızca analizdeki nota değişir. Ton önerisinden **önce** yapılabilir ve histograma girer |
| 4. Bölümler ve ton | Bölüm şeridinde sürükleyerek ölçü aralığı seçilir. Her bölüm için merkez nota + 10 mod. Öneri: süre ve vuruş ağırlıklı histogramdan en olası 3 aday. Histogram etiket düzeltmelerini kullanır, **ses düzeltmelerini (autotune, manuel kaydırma) kullanmaz** — autotune seçili scale'e çektiği için histogram o scale'i kendi kendine doğrulamasın. Aynı notalı modlar ayrı aday, ayırt edici ipucu olarak "son ağırlıklı nota". Onaylanmamış öneriler geçici olarak kullanılır ve "öneri" diye işaretlenir; son karar kullanıcıda |
| 5. Ses düzeltme | Autotune (miktar, retune hızı, vibratoyu koru, kromatik geçiş notalarına dokunma) veya notayı sürükleyerek manuel (yarım ses; Shift ile cent). Manuel düzeltilen nota kilitlenir. Düzeltilmiş vokal ayrı izde render edilir; A/B düğmesi |
| 6. Akor bulma | Ağırlıklar: 1. vuruş ×3, diğer güçlü vuruş ×2, vuruştan uzun ×2, kısa geçiş ×0.5. Diatonik triad + maj7/m7/sus2/sus4/add9. Yarım ses sürtünmesine büyük ceza, maj7 istisnası, sus2 önerisi, diminished düşük öncelik, Frig'de ev akoru asla majör değil. Değişim politikası: (a) sürtünme, (b) ≥ %X daha iyi, (c) N ölçü aynı akor, (d) **ev akoru en az her M ölçüde bir** (varsayılan 2; M dolunca ev akoru %X şartı olmadan aday olur, sürtünmüyorsa gelir); bölüm sonunda ev akoruna dönüş, bölüm geçişinde ortak nota tercihi. **Renk notası cezası** (7, 9/2, 11/4, 6'ya kök/3/5'e göre eksik puan) ayarlanabilir, varsayılan 0 |
| 7. Akor düzenleme | Akora tıkla → en iyi 3 aday + melodi notalarının rolü (kök/3/5/7/9); seç + kilitle ya da elle yaz (`F#m7/A` gibi) |
| 8. Piyano | Tone.js Sampler (Salamander). Hangi piyanonun çaldığı (Salamander / yedek sentez) üst çubukta görünür. Bas kökte başlar, basamaklı hareket için çevrim; pedal bas seçeneği. Akorlar vokal aralığının altında, ortak notalar yerinde kalır. Vokal/piyano için ses seviyesi, mute, solo |
| 9. Dışa aktarım | MIDI (tempo, ölçü, bölüm işaretleri, melodi + piyano izi, akor adları), akor şeması (.txt), düzeltilmiş vokal WAV, vokal + piyano mix WAV, proje JSON (ayarlar, bölümler, düzeltmeler, kilitler, istenirse gömülü orijinal ses) |

Orijinal kayıt hiçbir aşamada değiştirilmez: düzeltmeler, etiketler ve kilitler ayrı kayıtlar olarak tutulur, her değişiklikte sonraki adımlar yeniden hesaplanır.

## Stil verisi ve öneri

Üst çubuktaki **Stil verisi ve öneri** görünümü, sevdiğin şarkıların akorlarından derece istatistiği ve bir Markov modeli kurar. Model hem melodiye akor bulurken hem de melodisiz progresyon önerirken kullanılır. Mevcut akor bulucu kuralları (yarım ses cezası, %X eşiği, ev akoru M ölçü, N ölçü, kilitler) aynen geçerlidir.

**İçe aktarma.** Claude chat'e verilecek istem uygulamanın içinde, kopyalanabilir. Şema (`schema_version: 1`):

```json
{
  "schema_version": 1,
  "artist": "Sanatçı",
  "title": "Şarkı",
  "sections": [
    {
      "name": "Verse 1",
      "chords": ["C#m", "D", "C#m", "D"],
      "key_proposals": [{ "tonic": "C#", "mode": "phrygian", "confidence": 0.8, "reason": "…" }],
      "degrees_preview": ["i", "♭II", "i", "♭II"],
      "warnings": []
    }
  ],
  "warnings": []
}
```

- Birden çok şarkı için `{"schema_version": 1, "songs": [ … ]}` de kabul edilir. `key_proposals[].key: "C# phrygian"` biçimi de geçerlidir.
- Şema hatası olursa içe aktarım durur ve bozuk alanlar yol ile listelenir (ör. `sections[0].key_proposals[0].mode: tanınmayan mod "phrigian"`).
- Yedek giriş olarak düz metin kabul edilir: `Sanatçı:` / `Şarkı:` satırları ve `[Verse: C# phrygian] C#m D …`. DAW'ın dışa aktardığı akor şeması da okunur.
- Aynı sanatçı + şarkı ikinci kez gelirse uyarı çıkar (üzerine yaz / vazgeç). Tanınamayan akor sembolleri listelenir. Kullanıcı düzeltene kadar o bölüm onaylanamaz.

**Onay.** İlk ton önerisi ön-seçili gelir ama onaysızdır. Onaylanmamış bölüm istatistiğe girmez. Uygulama dereceleri seçilen merkez + moda göre kendisi hesaplar ve `degrees_preview` ile karşılaştırır; uyuşmayanlar kırmızı gösterilir. Önizlemenin ait olduğu tondan farklı bir ton seçilirse önizleme geçersiz sayılır ve uyarı çıkmaz.

**Dereceler.** Romen rakamları merkezin majör gamına göredir. Üç katman var: core (triad), color (maj7, sus2, add9…) ve bass (slash akorda bas derecesi).
- Power chord'da core kökten verilir (ör. `♭VII5`). Niteliği "belirsiz" sayılır, majör/minör sayımına girmez.
- sus akorlarının core niteliği, moddaki diatonik üçlüden çıkarılır (C majörde Dsus2 → ii + sus2).
- Moda ait olmayan akorlar "ödünç" diye işaretlenir.

**Geçişler.**
- Arka arkaya aynı akor tek akor sayılır.
- Core geçişlerinde aynı core'a geçiş (C → Cmaj7) harmonik değişim sayılmaz. Renk dağılımında ikisi de sayılır.
- N.C. geçişi böler.
- Bölüm içi ve bölümler arası geçişler ayrı tutulur. Bölümler arası geçişlerde iki bölümün merkez + modu da kaydedilir.
- Her bölümün açılış ve kapanış akoru ayrıca kaydedilir. Tekrar eden döngüler şarkı kaydında gösterilir.

**Sayma.** Temel birim şarkıdır: her derece, geçiş, açılış ve kapanış bir şarkıda en fazla 1 kez sayılır. Toplam tekrar sayısı yalnızca bilgi olarak gösterilir. İstatistik mod bazında ve tüm modların havuzu olarak ayrı tutulur. 20 şarkıdan az olan modlarda "az veri", 3 şarkıdan az görülen geçişlerde "belirsiz" işareti çıkar. Hücreye tıklayınca verinin hangi şarkılardan geldiği listelenir.

**Model.**
- Birinci derece Markov: P(core | önceki core, mod).
- İkinci derece yalnızca bağlam en az 5 şarkıda görüldüyse kullanılır; görülmediyse birinci dereceye geri dönülür (backoff).
- Kısmi havuzlama: `P = (n_mod·P_mod + k·P_havuz)/(n_mod + k)`, varsayılan k = 10.
- Moda uygun ama hiç görülmemiş her geçişe α = 0.5 şarkı eklenir.
- Renk ayrı bir dağılım: P(color | core, mod), aynı havuzlama ve yumuşatmayla.
- "k ve α öner" düğmesi, bir-şarkı-dışarıda çapraz doğrulamayla log-olabilirliği en yüksek (k, α) çiftini bulur.

**Geri bildirim.** Beğen / beğenme şarkı verisinden ayrı bir katmanda tutulur. Her tıklama ilgili geçişi ×1.25 ya da ×0.8 ile çarpar; toplam çarpan 0.5 ile 2 arasında sınırlıdır. Beğenilmeyen progresyon bir daha önerilmez. Katman kapatılabilir ve sıfırlanabilir.

**Akor bulucu.** Toplam = melodi puanı + λ·log P(geçiş) + λ·log P(renk).
- Log olasılıklar, o dağılımdaki uniform olasılığa göre normalize edilir: veri yokken stilin etkisi 0, aynı akorda kalmak da 0'dır.
- λ = 0 saf teoridir; sonuç stil modülü yokkenkiyle birebir aynı çıkar.
- Sıcaklık > 0 olunca en iyi 3 aday arasından puanla orantılı (softmax) örneklenir.
- Aday tablosu puanı melodi payı ve stil payı olarak ayrı gösterir.

**Progresyon önerici.**
- Girdiler: merkez + mod, uzunluk 2/4/8, döngü, kapanış tipi, sıcaklık, öneri sayısı.
- Açılış dağılımından başlar; sıcaklık 0'da ışın araması, üstünde örnekleme yapar.
- Her önerinin yanında toplam olasılık, en nadir geçiş (sürpriz noktası) ve bu geçişin görüldüğü şarkılar yazar.
- Öneri piyanoyla çalınabilir ya da zaman çizelgesine kilitli akor şablonu olarak yerleştirilebilir.
- İki bölüm arası geçiş önerisi, modal kayma istatistiğinden gelir.

**Saklama.** Veri seti, model ayarları ve geri bildirim ayrı JSON dosyaları olarak dışa ve içe aktarılır. Ayrıca tarayıcıda (localStorage) otomatik saklanır.

## Perde kaydırma neden TD-PSOLA?

Tone.js `PitchShift` (gecikme hattı tabanlı) vokalde metalik kalıyor. Rubberband-wasm tek HTML dosyasına gömülemeyecek kadar büyük ve AudioWorklet/COOP gerektiriyor. Bunun yerine, zaten elimizde olan pitch track'ten perde işaretleri (pitch marks) çıkarıp **TD-PSOLA** uyguluyoruz. Tanecikler orijinal periyotlarla alındığı için spektral zarf (formantlar) korunur, yani "sincap sesi" oluşmaz. Kaydırma olmayan bölgeler orijinal örneklerle birebir aynı kalır.

## Geliştirme

Tek dosya `src/` altındaki parçalardan üretilir:

```
src/core.js       DOM'suz çekirdek: DSP, ton/akor mantığı, MIDI/WAV, test melodisi
src/styledata.js  DOM'suz stil çekirdeği: akor ayrıştırma, dereceler, istatistik, Markov modeli, önerici
src/app.js        arayüz: zaman çizelgesi, kayıt, Tone.js oynatma, dışa aktarım
src/styleui.js    "Stil verisi ve öneri" görünümü
src/style.css, src/template.html
build.mjs         → index.html
```

```bash
npm install          # yalnızca testler için (playwright, tone)
npm test             # çekirdek + stil çekirdeği (Node): test melodisi ve stil testleri a–e
npm run test:ui      # arayüz + stil görünümü: Chromium'da uçtan uca (sahte mikrofonla kayıt dahil)
```

### Test melodisi

`Test melodisi üret` düğmesi (ve testler) sentetik bir vokal üretir: 4/4, 120 BPM. Verse (4 ölçü) C# Frig'de her ölçüde C#–D gidip gelir; nakarat (4 ölçü) B Dorian'da B'de biter. 2. ölçünün ilk D'si bilerek 40 cent pes. Vibrato, başta kayma (scoop), portamento ve bir nefes sesi içerir. Beklenen ve doğrulanan sonuçlar:

- 3b/4. adım: verse için **C# Frig**, nakarat için **B Dorian** ilk aday (son ağırlıklı notalar C# ve B); bir D'yi E olarak etiketlemek verse histogramını değiştirir, autotune ve manuel ses kaydırma değiştirmez
- 5. adım: pes nota −40c algılanır, autotune +40c kaydırır, render sonrası yeniden analizde ±2c
- 6. adım (M = 2, renk cezası 0): `| C#m | Dmaj7 | C#m | Dmaj7 C#m |` · `| Bm | Eadd9 | Bm/D | Bm |`. M = 0 ile verse 3. ölçüde Dmaj7 cezasız devam eder
- 1. adım: kalibrasyon, alkış ofsetlerinin medyanını kaydeder (Node'da sentetik alkışlarla, Chromium'da sahte mikrofona verilen alkış dosyasıyla test edilir)

## Sınırlar

- Tek sesli (monofonik) vokal içindir.
- Kayıt gecikmesini tarayıcı kesin bildirmez; "Tahmin" düğmesi yalnızca çıkış gecikmesini verir. "Kalibre et" gerçek gidiş-dönüş gecikmesini (artı el çırpma zamanlamanızı) ölçer; 8 click'ten en az 4 alkış algılanmazsa değer değiştirilmez.
- Mikrofon, güvenli bağlam ister (`https://`, `localhost` veya Chrome'da `file://`).
