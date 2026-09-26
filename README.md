# Mini DAW — vokal → armoni

Tarayıcıda çalışan, **tek dosyalık** (`index.html`) mini DAW. Tek sesli vokal kaydını analiz eder, gerekirse perdesini düzeltir ve altına piyano akorları yerleştirir. `index.html`'i tarayıcıda açmanız yeterli (oynatma için Tone.js ve Salamander piyano örnekleri CDN'den yüklenir; internet yoksa sentetik yedek piyano devreye girer).

## Akış (her adımın çıktısı bir sonrakinin girdisi)

| Adım | Ne yapar |
|---|---|
| 1. Proje ayarı | BPM (vuruş temposu; 6/8'de noktalı çeyrek), ölçü 4/4 · 3/4 · 6/8, kayıt gecikmesi telafisi (ms) |
| 2. Kayıt / yükleme | 1 ölçü count-in + metronom. Click yalnızca çıkışa gider, kayıt zincirine bağlı değildir (kulaklık kullanın). WAV/MP3 yükleme: ilk ses başlangıcı 1. ölçüye ya da en yakın vuruşa hizalanır, ofset elle de ayarlanır |
| 3. Pitch detection | pYIN benzeri: FFT'li YIN + Beta(2,18) eşik dağılımı + Viterbi. Nota olayları: başlangıç, süre, cent hassasiyetinde perde, en yakın nota. Vibrato/kaymalarda çekirdek bölgenin medyanı; sessizlik ve nefes atılır. Piano-roll + ince ham perde eğrisi |
| 4. Bölümler ve ton | Bölüm şeridinde sürükleyerek ölçü aralığı seçilir. Her bölüm için merkez nota + 10 mod. Öneri: süre ve vuruş ağırlıklı histogramdan en olası 3 aday; aynı notalı modlar ayrı aday, ayırt edici ipucu olarak "son ağırlıklı nota". Onaylanmamış öneriler geçici olarak kullanılır ve "öneri" diye işaretlenir; son karar kullanıcıda |
| 5a. Etiket düzeltme | Ses değişmez, yalnızca analizdeki nota değişir |
| 5b. Ses düzeltme | Autotune (miktar, retune hızı, vibratoyu koru, kromatik geçiş notalarına dokunma) veya notayı sürükleyerek manuel (yarım ses; Shift ile cent). Manuel düzeltilen nota kilitlenir. Düzeltilmiş vokal ayrı izde render edilir; A/B düğmesi |
| 6. Akor bulma | Ağırlıklar: 1. vuruş ×3, diğer güçlü vuruş ×2, vuruştan uzun ×2, kısa geçiş ×0.5. Diatonik triad + maj7/m7/sus2/sus4/add9. Yarım ses sürtünmesine büyük ceza, maj7 istisnası, sus2 önerisi, diminished düşük öncelik, Frig'de ev akoru asla majör değil. Değişim politikası: (a) sürtünme, (b) ≥ %X daha iyi, (c) N ölçü aynı akor; bölüm sonunda ev akoruna dönüş, bölüm geçişinde ortak nota tercihi |
| 7. Akor düzenleme | Akora tıkla → en iyi 3 aday + melodi notalarının rolü (kök/3/5/7/9); seç + kilitle ya da elle yaz (`F#m7/A` gibi) |
| 8. Piyano | Tone.js Sampler (Salamander). Bas kökte başlar, basamaklı hareket için çevrim; pedal bas seçeneği. Akorlar vokal aralığının altında, ortak notalar yerinde kalır. Vokal/piyano için ses seviyesi, mute, solo |
| 9. Dışa aktarım | MIDI (tempo, ölçü, bölüm işaretleri, melodi + piyano izi, akor adları), akor şeması (.txt), düzeltilmiş vokal WAV, vokal + piyano mix WAV, proje JSON (ayarlar, bölümler, düzeltmeler, kilitler, istenirse gömülü orijinal ses) |

Orijinal kayıt hiçbir aşamada değiştirilmez: düzeltmeler, etiketler ve kilitler ayrı kayıtlar olarak tutulur, her değişiklikte sonraki adımlar yeniden hesaplanır.

## Perde kaydırma neden TD-PSOLA?

Tone.js `PitchShift` (gecikme hattı tabanlı) vokalde metalik kalıyor. Rubberband-wasm tek HTML dosyasına gömülemeyecek kadar büyük ve AudioWorklet/COOP gerektiriyor. Bunun yerine, zaten elimizde olan pitch track'ten perde işaretleri (pitch marks) çıkarıp **TD-PSOLA** uyguluyoruz. Tanecikler orijinal periyotlarla alındığı için spektral zarf (formantlar) korunur, yani "sincap sesi" oluşmaz. Kaydırma olmayan bölgeler orijinal örneklerle birebir aynı kalır.

## Geliştirme

Tek dosya `src/` altındaki parçalardan üretilir:

```
src/core.js       DOM'suz çekirdek: DSP, ton/akor mantığı, MIDI/WAV, test melodisi
src/app.js        arayüz: zaman çizelgesi, kayıt, Tone.js oynatma, dışa aktarım
src/style.css, src/template.html
build.mjs         → index.html
```

```bash
npm install          # yalnızca testler için (playwright, tone)
npm test             # çekirdek: test melodisiyle her adımı doğrular (Node)
npm run test:ui      # arayüz: Chromium'da uçtan uca (sahte mikrofonla kayıt dahil)
```

### Test melodisi

`Test melodisi üret` düğmesi (ve testler) sentetik bir vokal üretir: 4/4, 120 BPM. Verse (4 ölçü) C# Frig'de her ölçüde C#–D gidip gelir; nakarat (4 ölçü) B Dorian'da B'de biter. 2. ölçünün ilk D'si bilerek 40 cent pes. Vibrato, başta kayma (scoop), portamento ve bir nefes sesi içerir. Beklenen ve doğrulanan sonuçlar:

- 4. adım: verse için **C# Frig**, nakarat için **B Dorian** ilk aday (son ağırlıklı notalar C# ve B)
- 5. adım: pes nota −40c algılanır, autotune +40c kaydırır, render sonrası yeniden analizde ±2c
- 6. adım: `| C#m | Dmaj7 | C#m | Dmaj7 C#m |` · `| Bm | Eadd9 | F#m7 | Bm |`

## Sınırlar

- Tek sesli (monofonik) vokal içindir.
- Kayıt gecikmesini tarayıcı kesin bildirmez; "Tahmin et" düğmesi çıkış gecikmesini verir. En doğru yol, click'e karşı el çırpıp ofseti ölçmektir.
- Mikrofon, güvenli bağlam ister (`https://`, `localhost` veya Chrome'da `file://`).
