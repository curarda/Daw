# Mini DAW — vokal → armoni

Tarayıcıda çalışan, **tek dosyalık** (`index.html`) mini DAW. Tek sesli vokal kaydını analiz eder, gerekirse perdesini düzeltir ve altına piyano akorları yerleştirir. `index.html`'i tarayıcıda açmanız yeterli (oynatma için Tone.js ve Salamander piyano örnekleri CDN'den yüklenir; internet yoksa sentetik yedek piyano devreye girer).

## Akış (her adımın çıktısı bir sonrakinin girdisi)

| Adım | Ne yapar |
|---|---|
| 1. Proje ayarı | BPM (4/4, 3/4 ve 2/4'te ♩, 6/8'de ♩. sayılır; alanın yanında yazar), ölçü 4/4 · 3/4 · 2/4 · 6/8. **Click deseni** (4/4): 1. vuruş vurgulu ya da yarım zaman — trampet 3. vuruşta, "tık tık tıss tık"; kayıt ve oynatma click'i aynı deseni çalar. Yarım zamanda BPM yine çeyrek notadır, kayıt gecikmesi telafisi (ms). **Kalibre et**: 8 click çalar, her click'te el çırparsınız; click–alkış ofsetlerinin medyanı gecikme olarak kaydedilir |
| 2. Kayıt / yükleme | 1 ölçü count-in + metronom. Click yalnızca çıkışa gider, kayıt zincirine bağlı değildir (kulaklık kullanın). WAV/MP3 yükleme: ilk ses başlangıcı 1. ölçüye ya da en yakın vuruşa hizalanır, ofset elle de ayarlanır. **Öncü (anacrusis):** vokal ölçünün ortasında başlıyorsa (ör. 3. vuruşta) hizalamayı "İlk ses → 1. ölçünün şu vuruşu" yapıp vuruşu seç; ilk ses o vuruşa, ölçü çizgileri (1. vuruşlar) doğru yere oturur (yüklenen dosyada da kayıtta da; kayıtta "Yok" click hizasına döner) |
| 3. Pitch detection | pYIN benzeri: FFT'li YIN + Beta(2,18) eşik dağılımı + Viterbi. Nota olayları: başlangıç, süre, cent hassasiyetinde perde, en yakın nota. En yakın nota **kişisel akort referansına** göre bulunur (aşağıda). Vibrato/kaymalarda çekirdek bölgenin medyanı; sessizlik ve nefes atılır. Piano-roll + ince ham perde eğrisi |
| 3b. Etiket düzeltme | Ses değişmez, yalnızca analizdeki nota değişir. Ton önerisinden **önce** yapılabilir ve histograma girer |
| 4. Bölümler ve ton | Bölüm şeridinde sürükleyerek ölçü aralığı seçilir. Her bölüm için merkez nota + 10 mod. Öneri: süre ve vuruş ağırlıklı histogramdan en olası 3 aday. Histogram etiket düzeltmelerini kullanır, **ses düzeltmelerini (autotune, manuel kaydırma) kullanmaz** — autotune seçili scale'e çektiği için histogram o scale'i kendi kendine doğrulamasın. Aynı notalı modlar ayrı aday, ayırt edici ipucu olarak "son ağırlıklı nota". İki belirsizlik ayrı mesajla gösterilir: **"Ayırt edici nota yok"** (ör. B minör ile B Dorian arasındaki G / G# hiç söylenmemiş) ve **"Aynı nota kümesi, merkez belirsiz"** (ör. E Miksolidya ile A majör; merkez kanıtı zayıf). Önceki bölümün tonu küçük bir itme alır (aynı ton +0.08, aynı nota kümesi +0.04); yalnızca adaylar zaten yakınsa sırayı değiştirir, onaylanmış ton her zaman üstündür. Tam tonunda (±20 cent) söylenmiş scale dışı nota mor kesikli çerçeve ve "?" ile **"mod yanlış olabilir"** diye işaretlenir. Onaylanmamış öneriler geçici olarak kullanılır ve "öneri" diye işaretlenir; son karar kullanıcıda |
| 5. Ses düzeltme | **Elle:** piano-roll'da notayı tut ve sürükle; sürüklerken ne olacağı notanın üstünde yazar. **Notaya tıklayınca duyulur, sürüklerken her yeni yarım seste (ince akortta her ~5 cent'te) o perdede tekrar duyulur**: piyano değil kendi sesin, kaydın o parçası TD-PSOLA ile hızı değişmeden kaydırılarak; etiket sürüklemede ses aynıdır, karşılaştırma için etiket perdesinde kısık bir piyano notası eklenir. Nota panelinde ▶ (şu anki hali) ve ▶ orijinal (ölçek sürüklerken donar: 3 satır = 3 yarım ses). Üç ayrı işlem: **Sürükle / ↑↓ = notayı taşı** (yanlış nota söyledin: ses yeni yarım sese kayar ve kastedilen nota o olur, akorlar onu kullanır) · **Shift+sürükle / Shift+↑↓ = ince akort** (yalnızca cent, en fazla ±49; nota ve akorlar aynı) · **Alt+sürükle = etiketi düzelt** (program yanlış algıladı: ses aynı). Elle düzeltilen notaya autotune dokunmaz. Her değişiklik notaya tıklayınca en üstteki ✕ ile, ya da 5. adımdaki özetten türüne göre topluca geri alınır. **Autotune** (varsayılan kapalı; hedef en yakın yarım ses, notanın kimliği değişmez; "scale'e çek" yalnızca açıkça seçilirse ve uyarıyla): miktar, retune hızı, vibratoyu koru; nota panelinde "Autotune bu notaya dokunmasın". Düzeltilmiş vokal ayrı izde render edilir; A/B düğmesi. Autotune akor önerisini değiştirmez |
| 6. Akor bulma | Varsayılan motor **süreli Viterbi** (aşağıda); eski ölçü ölçü (greedy) motor seçilebilir. Ağırlıklar: 1. vuruş ×3, diğer güçlü vuruş ×2, vuruştan uzun ×2, kısa geçiş ×0.5. Diatonik triad + maj7/m7/sus2/sus4/add9. Yarım ses sürtünmesine büyük ceza, maj7 istisnası, sus2 önerisi, diminished düşük öncelik, Frig'de ev akoru asla majör değil. Değişim politikası: (a) sürtünme, (b) ≥ %X daha iyi, (c) N ölçü aynı akor, (d) **ev akoru en az her M ölçüde bir** (varsayılan 2; M dolunca ev akoru %X şartı olmadan aday olur, sürtünmüyorsa gelir); bölüm sonunda ev akoruna dönüş, bölüm geçişinde ortak nota tercihi. **Renk notası cezası** (7, 9/2, 11/4, 6'ya kök/3/5'e göre eksik puan) ayarlanabilir, varsayılan 0 |
| 7. Akor düzenleme | Akora tıkla → akor hemen duyulur ve sağda en iyi 3 aday + melodi notalarının rolü (kök/3/5/7/9) açılır. Adayların yanındaki ▶ kilitlemeden dinletir. Seç + kilitle ya da elle yaz (`F#m7/A` gibi). Kilidi kaldırmak: kilitli akorun sağ üstündeki kırmızı ✕, akor seçiliyken Delete tuşu, denetçinin üstündeki "Kilidi kaldır" ya da 6–7. adımdaki "Tüm akor kilitlerini kaldır" |
| 7a. Değişim noktaları | Akor satırında yarım ölçüler kesikli çizgiyle, vuruşlar çentikle görünür. Satırın üst kenarındaki noktalara (dolu = ölçü başı, içi boş = ölçü ortası) tıkla: **✂ burada değiş → = burada değişme → işaret yok**. Akora tıklayınca panelde "✂ Tam burada değiştir", "✂ Ölçünün ortasında değiştir", "= Burada değiştirme" da var. Hangi akorun geleceğini motor seçer; ✂ noktasında akorun kökü değişir (D → Dmaj7 değişim sayılmaz), işaret konunca diğer akorlar değişmez. "Akor yalnızca ✂ işaretli noktalarda değişsin" seçeneği, işaret konan bölümlerde başka yerde değişime izin vermez. İşaretler kilitlerle çelişirse uyarı çıkar; süreli Viterbi motorunda uygulanır · **"Akorlar yalnızca ölçü başında (1. vuruşta) değişsin"**: ölçü ortası değişimi kapanır (✂ ile işaretlediğin ölçü ortaları hariç); iki motorda da |
| 7b. Kendi akorların (şablon) | 6–7. adımdaki **📄 Kendi akorlarım — şablon yükle**: akorları yaz ya da .txt yükle; melodinin üzerinde kilitli akor (📄) olarak çalar, diğer akorlar değişmez. Biçim DAW'ın akor şemasıyla aynı (indirip düzenleyip geri yükleyebilirsin): `[Nakarat] B Dorian — ölçü 5–8` bölüm başlığı (ton ve aralık isteğe bağlı; çakışmıyorsa bölüm oluşturur), `| C#m | Dmaj7 | % | D / C#m / |` her hücre 1 ölçü, hücrede 2 akor = yarım ölçü, `%` önceki ölçü, `/ - .` önceki akor sürer, boş hücre = otomatik; çizgisiz `C#m:2 D E:0.5` (ölçü). Tanınmayan akor satır numarasıyla bildirilir ve hiçbir şey uygulanmaz; sığmayan akorlar (ölçüde 2'den fazla) ve N.C. uyarıyla atlanır. "Boş şablon indir", "Şu anki akorları şablon olarak indir", "✕ Şablondan gelen akorları kaldır" |
| 8. Piyano | Tone.js Sampler (Salamander). Hangi piyanonun çaldığı (Salamander / yedek sentez) üst çubukta görünür. Bas kökte başlar, basamaklı hareket için çevrim; pedal bas seçeneği. Akorlar vokal aralığının altında, ortak notalar yerinde kalır. Vokal/piyano için ses seviyesi, mute, solo |
| 8b. Davul (basit loop) | **Ölçü tahmini:** melodinin vurgularından (uzun / yüksek sesli / tepe notalar, arkasından boşluk gelen notalar) ve BPM'den 4/4, 3/4, 2/4, 6/8 (8'likle sayılmışsa BPM'i de) tahmin eder; 8'lik mi üçleme mi olduğunu, vokalin kaçıncı vuruşta başladığını (öncü) ve ölçü çizgilerinin kayık olup olmadığını söyler; güveni ve diğer adayları gösterir. "Uygula" ölçüyü (gerekirse BPM'i) değiştirir ve ölçü çizgilerini hizalar; ölçüyü 1. adımdan her zaman kendin seçebilirsin. Notalar BPM ızgarasına oturmuyorsa "BPM yanlış olabilir" der. **Loop'lar (14):** 4/4 rock 8'lik, four-on-the-floor, yarım zaman (trampet 3'te), 16'lık balad, boom-bap, one-drop, shuffle (üçleme), sade; 3/4 vals, 3/4 balad; 2/4 marş/polka, 2/4 düz; 6/8 balad, 6/8 rock. Seçim: proje ölçüsü + BPM'in loop'un tempo aralığına uyması + melodinin ölçü içi vurgularının kick'le örtüşmesi + his (düz/üçleme); click deseni yarım zamansa yarım zaman öne çıkar. Uygun loop yoksa nedenleriyle "bulamadım" der ve Claude'a gönderilecek tarifi (ölçü, BPM, his, 0–9 vurgu profili) kopyalanabilir verir; en yakını yine çalınabilir ya da elle seçilebilir. Davul mikserde ayrı kanal; mix WAV'a ve MIDI'ye (kanal 10) girer |
| 9. Dışa aktarım | MIDI (tempo, ölçü, bölüm işaretleri, melodi + piyano izi, akor adları), akor şeması (.txt), düzeltilmiş vokal WAV, vokal + piyano mix WAV, proje JSON (ayarlar, bölümler, düzeltmeler, kilitler, istenirse gömülü orijinal ses) |

**Kilit başka akoru değiştirmez:** Bir akoru kilitlediğinde (ya da önericiden şablon yerleştirdiğinde) o anki bütün diğer akorlar çevrimleriyle birlikte sabitlenir (📌). Motor kilitten sonra başka bir şey seçecek olsaydı, bunu uygulamaz: akorun altında turuncu "→ akor" olarak gösterir; akora tıklayınca nedeni yazar (ör. "sonraki akorla birleşip tek akor olur", "melodiyle yarım ses sürtünmesi"), ▶ ile dinletir, "Öneriyi uygula" yalnızca o akoru değiştirir. "Motorun önerilerini uygula" hepsini birden uygular. Kilitli akorun kendisi aynen çalar (çevrim ya da renk zorlanmaz); önemli bir sorun varsa ⚠ (sürtünme), isteğe bağlı fikirler ℹ (maj7 / sus2 rengi, bas hattı için çevrim) olarak yazılır. Otomatik bir akor çevrimle çalıyorsa ya da başka yerde aynı kökte farklı bir akor kilitlediysen, nedeni ve "kök konumda kilitle" / "buradakini de böyle kilitle" düğmeleri çıkar. Bölüm, ton, etiket ya da ayar değişirse sabitler bırakılır ve akorlar yeniden hesaplanır.

**Geri alma kuralı:** Tıklayarak eklenen her şey (bölüm, akor kilidi, nota etiketi, ses düzeltmesi, nota kilidi) tekrar tıklandığında sağdaki denetçinin en üstünde kırmızı çerçeveli bir satırla gelir: ne eklendiği ve "✕ … kaldır" düğmesi. Birden fazla değişiklik varsa "Hepsini kaldır" da çıkar. Bölüm seçiliyken Delete tuşu bölümü siler. Bölüm şeridine tek tık bölüm açmaz; bölüm sürükleyerek açılır.

Orijinal kayıt hiçbir aşamada değiştirilmez: düzeltmeler, etiketler ve kilitler ayrı kayıtlar olarak tutulur, her değişiklikte sonraki adımlar yeniden hesaplanır.

### Kişisel akort referansı

Tonda söyleyen biri A440'a göre sabit bir kayma ile söyleyebilir (ör. herkes +30 cent). Bunu "hep diyez" diye düzeltmek yanlış olur. Bu yüzden notalar A440'a değil kişisel referansa göre yuvarlanır:
- Genel referans: bütün notaların cent sapmasının süre ağırlıklı medyanı (dairesel: +50 ile −50 aynı yerdir).
- Zamanla kayma: her nota için ±8 saniyelik pencerede kayan medyan. Böylece şarkı boyunca yavaşça pesleşen bir ses de doğru okunur.
- Denetçi iki ölçüyü birlikte gösterir: referansa göre cent ve A440'a göre cent. Panelde "A4 ≈ … Hz" yazar.
- Referans "A440" seçilerek kapatılabilir; pencere süresi ayarlanabilir.

### Süreli Viterbi (akor bulma motoru)

Ölçü ölçü karar vermek yerine bölümün tamamı için en olası akor dizisini arar (gizli yarı-Markov model, HSMM). Birim yarım ölçüdür.
- Akor süreleri sabit bir "değişme olasılığı"ndan değil, stil verisindeki **harmonik ritim dağılımından** gelir: λ_ritim·log(P(süre sınıfı)·5). Süre verisi yoksa bu pay 0'dır.
- Akor geçişleri stil modelinin "hangi akora" payından gelir (λ). Melodi puanı ve ağırlıklar greedy motorla aynıdır.
- Kilitler ve yarım ses sürtünmesi **kısıttır**: sürtünen akor seçilmez (yalnızca bir birimde sürtünmesiz aday hiç yoksa gevşer), kilitli akor değişmez.
- %X eşiği değişim başına sabit bir maliyete, N ölçü kuralı aşım cezasına, M kuralı (ev akoru her M ölçüde bir) her aşılan yarım ölçü için cezaya dönüşür. Bölüm sonunda ev akoru bonusu vardır.
- Bölüm başına **en iyi 3 progresyon** gösterilir; her biri diğerlerinden en az 2 ölçüde farklıdır. Seçilen alternatif zaman çizelgesine uygulanır. Sıcaklık > 0 iken alternatifler puanla orantılı örneklenir.
- Nota sürüklenirken hızlı olsun diye geçici olarak greedy motor kullanılır.

### Doğrulama

"Stil verisi ve öneri" görünümündeki **Doğrulama** sekmesi, sistemi gerçek akorları bilinen kayıtlarla ölçer. DAW'daki kaydı gerçek akor şemasıyla eklersiniz (ölçü ölçü, `| C#m | D C#m |`).
- Metrikler: core tam eşleşme oranı, kök derecesi eşleşme oranı, doğru akorun ilk 3 aday içinde olma oranı, değişim noktası eşleşmesi (F1; akorun değiştiği yarım ölçüler).
- Ayar (λ, λ_ritim, %X, M) **şarkı bazlı dışarıda bırakma** ile yapılır: her şarkı için ayar kalan şarkılarda seçilir, başarı o şarkıda ölçülür. Raporlanan "ayarlı" sonuç hep ayarda kullanılmamış şarkıdan gelir. Değerlendirilen şarkı stil veri setinde de varsa, o şarkı modelden çıkarılır.
- Bir sonucu "referans" olarak kaydedip sonraki değişiklikleri onunla karşılaştırabilirsiniz; set JSON olarak dışa/içe aktarılır.

**Sentetik testlerdeki sonuç (gerçek kayıt değil, 6 sentetik şarkı):** greedy referansında sabit ayarla core %71; süreli Viterbi sabit ayarla core %79 (+8), kök +8, ilk 3 +2, değişim F1 −1. Ayarlı (dışarıda bırakılan şarkıda) sonuçta Viterbi core −3, değişim F1 −14 (küçük stil veri setiyle). Hangi motorun sizin sesinizde daha iyi olduğunu kendi kayıtlarınızla Doğrulama sekmesi söyler.

## Stil verisi ve öneri

Üst çubuktaki **Stil verisi ve öneri** görünümü, sevdiğin şarkıların akorlarından derece istatistiği ve bir Markov modeli kurar. Model hem melodiye akor bulurken hem de melodisiz progresyon önerirken kullanılır. Mevcut akor bulucu kuralları (yarım ses cezası, %X eşiği, ev akoru M ölçü, N ölçü, kilitler) aynen geçerlidir.

**İçe aktarma.** Claude chat'e verilecek istem uygulamanın içinde kopyalanabilir. Tek kaynağı `src/import-prompt.txt`; derlemede sayfaya gömülür. Sohbetin ürettiği biçim (`schema_version: 1`):

```json
{
  "schema_version": 1,
  "artist": "Sanatçı",
  "title": "Şarkı",
  "source_notes": { "capo": 2, "tuning": null, "other": null },
  "warnings": [],
  "sections": [
    {
      "label": "Verse 1",
      "type": "verse",
      "chords": ["C#m", "D", "C#m", "D"],
      "bars": [2, 2, 2, 2],
      "key_proposals": [{ "tonic": "C#", "mode": "phrygian", "confidence": 0.8, "reason": "…" }],
      "degrees_preview": [{ "core": "i", "color": null, "bass": null }, { "core": "♭II", "color": null, "bass": null }, "…"]
    }
  ]
}
```

- `label` bölüm adıdır (eski `name` de kabul edilir). `type` (verse, chorus…) saklanır, normalize edilir (Türkçe/İngilizce: "Nakarat", "Refrain" → chorus; "Kıta" → verse; "Köprü", "Middle 8" → bridge…) ve mod × tip istatistiğinde kullanılır. `type` yoksa bölüm adından çıkarılır.
- İstem, sohbetin yalnızca yapıştırılan akor şemasını dönüştürmesini ister: şema yoksa ya da eksikse akor üretmez, hafızadan tamamlamaz, eksiği `warnings`'e yazar; kaynak linki `source_notes.other`'a gider. Uygulama akorlardan kendi ton tahminini yapar; sohbetin önerisiyle uyuşmazsa onay ekranında uyarır.
- `source_notes` (capo, akort, diğer) şarkı kaydında gösterilir. Akorlar dönüştürülmez: dereceler göreli olduğu için kapo istatistiği etkilemez.
- `bars` bir dizi ya da `null` olabilir. `null` olan bölüm süre istatistiğine girmez ama değişim istatistiğine girer.
- `degrees_preview` öğeleri `{core, color, bass}` üç katmanı taşır ve her katman ayrı karşılaştırılır. Eski düz metin biçimi ("IVmaj7") de okunur; o biçimde yalnızca core karşılaştırılır.
- Birden çok şarkı için `{"schema_version": 1, "songs": [ … ]}` de kabul edilir.
- Şema hatası olursa içe aktarım durur ve bozuk alanlar yol ile listelenir (ör. `sections[0].key_proposals[0].mode: tanınmayan mod "phrigian"`).
- Yedek giriş olarak düz metin kabul edilir: `Sanatçı:` / `Şarkı:` satırları ve `[Verse: C# phrygian] C#m D …`. Süre iki yolla verilebilir: `C#m:4 D:2` ya da ölçü çizgileriyle `| C#m | D C#m |` (her hücre 1 ölçü, içindeki akorlara eşit bölünür). DAW'ın dışa aktardığı akor şeması da okunur.
- Aynı sanatçı + şarkı ikinci kez gelirse uyarı çıkar (üzerine yaz / vazgeç). Tanınamayan akor sembolleri listelenir. Kullanıcı düzeltene kadar o bölüm onaylanamaz.

**Onay.** İlk ton önerisi ön-seçili gelir ama onaysızdır. Onaylanmamış bölüm istatistiğe girmez. Uygulama dereceleri seçilen merkez + moda göre kendisi hesaplar ve `degrees_preview` ile katman katman (core / color / bass) karşılaştırır. Uyuşmayan akorlar kırmızı gösterilir ve hangi katmanın tutmadığı yazar. Önizlemenin ait olduğu tondan farklı bir ton seçilirse önizleme geçersiz sayılır ve uyarı çıkmaz.

**Dereceler.** İçeride her derece, merkezden yarım ses uzaklığı + nitelik olarak saklanır (ör. `6M`; tritone = 6). Havuz dahil tüm istatistik ve model bu temsil üzerinden sayılır. Romen rakamı yazımı yalnızca gösterimdedir ve merkezin majör gamına göre, moda göre seçilir: aralık modun gamındaysa o basamağın yazımı kullanılır (Lidya'da ♯IV, Lokriyen'de ♭V), değilse ♭II / ♭III / ♭V / ♭VI / ♭VII.
- Üç katman var: core (triad), color (maj7, add9…) ve bass (slash akorda bas derecesi).
- Power chord ve sus akorlarında nitelik "belirsiz"dir. Core yalnızca kök derecesidir (gösterimde `V?`, akorda `♭VII5`, `Vsus4`). Majör/minör sayımına girmezler; nitelik tablosunda "belirsiz (power)" ve "belirsiz (sus)" olarak ayrı görünürler.
- Moda ait olmayan akorlar "ödünç" diye işaretlenir.

**Geçişler.**
- Arka arkaya aynı akor tek akor sayılır.
- Aynı kökte kalan akorlar (C → Cmaj7, Csus4 → C, C5 → C) Markov geçişi sayılmaz; harmonik ritimde tek akor sayılır ve süreleri birleşir. Belirsiz nitelik komşusunun niteliğini alır. Renk dağılımında hepsi ayrı sayılır.
- Aynı akor içinde bas değişimi (C → C/B) ayrı bir "bas hareketi" istatistiği olarak kaydedilir: bas derecesi → bas derecesi, şarkı başına sayım.
- N.C. geçişi böler.
- Bölüm içi ve bölümler arası geçişler ayrı tutulur. Bölümler arası geçişlerde iki bölümün merkez + modu da kaydedilir.
- Her bölümün açılış ve kapanış akoru ayrıca kaydedilir. Tekrar eden döngüler şarkı kaydında gösterilir.

**Sayma.** Temel birim şarkıdır: her derece, geçiş, açılış ve kapanış bir şarkıda en fazla 1 kez sayılır. Toplam tekrar sayısı yalnızca bilgi olarak gösterilir. İstatistik mod bazında ve tüm modların havuzu olarak ayrı tutulur. 20 şarkıdan az olan modlarda "az veri", 3 şarkıdan az görülen geçişlerde "belirsiz" işareti çıkar. Hücreye tıklayınca verinin hangi şarkılardan geldiği listelenir.

**Harmonik ritim.** Akor süresi, aynı kökte kalma süresidir (yukarıdaki birleşme kuralıyla); N.C. süresi sayılmaz. Süreler 0.5 / 1 / 2 / 4 / 8+ ölçü sınıflarına log ölçekte en yakın sınıfa göre konur (1.5 → 2, 3 → 4, 6 ve üstü → 8+).
- Dağılım mod bazında ve havuz olarak tutulur; şarkı başına sayma kuralı aynen geçerlidir.
- Ayrıca bölüm başına "kaç ölçüde bir akor değişiyor" dağılımı tutulur (bölüm uzunluğu ÷ akor sayısı).
- Panelde süre bilgisi olan şarkı sayısı görünür.

**Model.**
- Birinci derece Markov: P(core | önceki core, mod).
- İkinci derece yalnızca bağlam en az 5 şarkıda görüldüyse kullanılır; görülmediyse birinci dereceye geri dönülür (backoff).
- Kısmi havuzlama: `P = (n_mod·P_mod + k·P_havuz)/(n_mod + k)`, varsayılan k = 10.
- Hiyerarşik havuzlama (mod × bölüm tipi → mod → havuz): `P_tip = (n_tip·P̂_tip + k_tip·P_mod)/(n_tip + k_tip)`, varsayılan k_tip = 5. Tipte veri yoksa P_mod'a eşittir. Geçiş, açılış, kapanış ve süre dağılımlarına uygulanır. Akor bulucu DAW bölümünün adından ("Nakarat" → chorus) tipi alır; istatistik panelinde bölüm tipi filtresi, progresyon önericide tip girdisi var.
- Moda uygun ama hiç görülmemiş her geçişe α = 0.5 şarkı eklenir. Süre dağılımının kendi yumuşatması var: α_ritim = 0.5 (her süre sınıfına).
- Renk ayrı bir dağılım: P(color | core, mod), aynı havuzlama ve yumuşatmayla.
- Süre de ayrı bir dağılım: P(süre sınıfı | mod), aynı havuzlama ve yumuşatmayla. Havuzlamadaki n, o modda süre bilgisi olan şarkı sayısıdır.
- "k ve α öner" düğmesi, bir-şarkı-dışarıda çapraz doğrulamayla log-olabilirliği en yüksek (k, α) çiftini ve ayrıca süreler için α_ritim'i bulur. 20 onaylı şarkıdan az veriyle de çalışır ama "sonuç güvenilir değil" uyarısı verir.

**Geri bildirim.** Beğen / beğenme şarkı verisinden ayrı bir katmanda tutulur. Her beğeni ilgili geçişi ×1.1, her beğenmeme ×0.91 ile çarpar; toplam çarpan 0.5 ile 2 arasında sınırlıdır. Beğenilmeyen progresyon bir daha önerilmez. Katman kapatılabilir ve sıfırlanabilir.

**Autotune ve akorlar:** Akor bulucu duyduğun notayı kullanır. "En yakın yarım ses" autotune notanın yarım sesini değiştirmez (yalnızca cent), yani akorlar autotune'lu ve autotune'suz aynıdır. "Scale'e çek" bir notayı başka yarım sese taşırsa (miktar ≥ %50) akorlar taşınan notaya göre bulunur; piano-roll'da nota yeni yerinde, "C#4→D4" yazısı ve kesikli eski yeriyle görünür. Ton önerisi (4. adım) her zaman söylediğin notalarla hesaplanır, autotune seçili scale'i kendi kendine doğrulamaz.

**Akor bulucu.** Mevcut kurallar (yarım ses cezası, %X eşiği, N ölçü, ev akoru M ölçü, kilitler) aynen geçerlidir. Stil iki ayrı pay olarak girer:
- **Değiş mi kal mı:** melodi puanı + mevcut politika + harmonik ritim. Ağırlığı ayrıdır: **λ_ritim**. Greedy motorda pay λ_ritim·log(h/(1−h)); h, "bu akor n ölçüdür çalıyorken bu modda değişme olasılığı"dır. h, süre dağılımından hesaplanır: sınıflar aralık olarak alınır, içleri düzgün kabul edilir. Süre verisi yoksa stil bu karara katılmaz. Viterbi motorunda bu pay süre sınıfının olasılığıdır (yukarıda).
- **Değişirsem hangi akora:** λ·log(P·K) + λ·log(P_renk·K_renk). K = moddaki diatonik core sayısı (7), sabittir; ödünç akorlar K'yı değiştirmez. Veri yokken P uniform olduğu için bu pay yaklaşık 0'dır.
- λ = 0 ve λ_ritim = 0 saf teoridir; sonuç stil modülü yokkenkiyle birebir aynı çıkar.
- Sıcaklık > 0 olunca en iyi 3 aday arasından puanla orantılı (softmax) örneklenir.
- Aday tablosu puanı melodi payı ve stil payı olarak ayrı gösterir; denetçide ayrıca "değiş mi kal mı" satırı var.

**Progresyon önerici.**
- Girdiler: merkez + mod, bölüm tipi (isteğe bağlı), değişim sayısı (1 = tek akorda kalma / drone), toplam uzunluk (ölçü), döngü, kapanış tipi, sıcaklık, öneri sayısı.
- Model akor değişimlerini üretir (bir core'dan kendisine geçiş yoktur); bir akorda kalmak ayrı modellenen bir süre kararıdır. Bu yüzden "aynı akor art arda gelmesin" diye bir kural yok. Döngüde son akor ilk akorla aynıysa sınırda değişim sayılmaz, süreler birleşir.
- Açılış dağılımından başlar; sıcaklık 0'da ışın araması, üstünde örnekleme yapar.
- Değişimlerin süreleri süre dağılımından seçilir ve toplam, istenen uzunluğa tam oturtulur (yarım ölçü adımlı dinamik programlama). Sınıf olasılığının %90'ı kanonik değere (0.5, 1, 2, 4, 8), %10'u ara değerlere gider; böylece her uzunluk tutturulabilir. Eşit olasılıkta eşit bölüşüm seçilir, yani süre verisi yokken 4 akor / 8 ölçü → 2-2-2-2. Süreler öneride elle değiştirilebilir.
- Değişim sayısı 1 seçilirse ev akorunda kalan drone geçerli bir çıktıdır.
- Gösterim süreleri de yazar, ör. `i (4) → ♭II (2) → i (2)`. Toplam olasılık = değişim olasılığı × süre olasılığı.
- Her önerinin yanında toplam olasılık, en nadir geçiş (sürpriz noktası) ve bu geçişin görüldüğü şarkılar yazar.
- Öneri, süreleriyle birlikte piyanoyla çalınabilir ya da zaman çizelgesine kilitli akor şablonu olarak yerleştirilebilir. Yarım ölçülük süreler yarım ölçü kilidine dönüşür; 3/4'te süreler tam ölçüye yuvarlanır.
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
- Kişisel akort: bütün melodi 30 cent pes ve sonuna doğru 20 cent yükseliyor. A440'a göre pes D (−67 cent) C# sanılır; kişisel referansla D (−40 cent) okunur, diğer notalar ±10 cent içinde tam tonundadır ve akorlar tam tonundaki kayıtla aynı çıkar
- 5. adım: pes nota −40c algılanır, autotune (en yakın yarım ses) +40c kaydırır, render sonrası yeniden analizde ±2c; scale dışı notanın kimliği değişmez
- 6. adım, süreli Viterbi (varsayılan): `| C#m | Dmaj7 | C#m | Dmaj7 C#m |` · `| Bm | Eadd9 | F#m7 | Bm |`, bölüm başına 3 alternatif
- 6. adım, greedy (M = 2, renk cezası 0): `| C#m | Dmaj7 | C#m | Dmaj7 C#m |` · `| Bm | Eadd9 | Bm/D | Bm |`. M = 0 ile verse 3. ölçüde Dmaj7 cezasız devam eder
- 1. adım: kalibrasyon, alkış ofsetlerinin medyanını kaydeder (Node'da sentetik alkışlarla, Chromium'da sahte mikrofona verilen alkış dosyasıyla test edilir)

## Sınırlar

- Tek sesli (monofonik) vokal içindir.
- Kayıt gecikmesini tarayıcı kesin bildirmez; "Tahmin" düğmesi yalnızca çıkış gecikmesini verir. "Kalibre et" gerçek gidiş-dönüş gecikmesini (artı el çırpma zamanlamanızı) ölçer; 8 click'ten en az 4 alkış algılanmazsa değer değiştirilmez.
- Mikrofon, güvenli bağlam ister (`https://`, `localhost` veya Chrome'da `file://`).
