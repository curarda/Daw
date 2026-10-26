# Mini DAW — vokal → armoni

Tarayıcıda çalışan, **tek dosyalık** (`index.html`) mini DAW. Tek sesli vokal kaydını analiz eder, gerekirse perdesini düzeltir ve altına piyano akorları yerleştirir. `index.html`'i tarayıcıda açmanız yeterli (oynatma için Tone.js ve Salamander piyano örnekleri CDN'den yüklenir; internet yoksa sentetik yedek piyano devreye girer).

## Akış (her adımın çıktısı bir sonrakinin girdisi)

| Adım | Ne yapar |
|---|---|
| 1. Proje ayarı | BPM (4/4, 3/4 ve 2/4'te ♩, 6/8'de ♩. sayılır; alanın yanında yazar), ölçü 4/4 · 3/4 · 2/4 · 6/8. **Click deseni** (4/4): 1. vuruş vurgulu ya da yarım zaman — trampet 3. vuruşta, "tık tık tıss tık"; kayıt ve oynatma click'i aynı deseni çalar. Yarım zamanda BPM yine çeyrek notadır, kayıt gecikmesi telafisi (ms). **Kalibre et**: 8 click çalar, her click'te el çırparsınız; click–alkış ofsetlerinin medyanı gecikme olarak kaydedilir |
| 1b. Alt bölme (swing) | 1. adımda **Alt bölme**: **Düz (%50)** · **Üçleme (%67)** — her vuruş 3'e bölünür, 12/8 hissi · **Swing — özel oran** (%50–75). Oran, zayıf sekizliğin ("ve") vuruş içindeki yeridir; **"Swing'i kayıttan ölç"** melodinin zayıf vuruşlara düşen nota başlangıçlarından oranı ölçer (ör. shuffle kaydı ≈ %70, saf üçleme %67) ve "uygula" der — kendiliğinden uygulamaz. Oran **her katmanda aynı ızgaraya** oturur: davul loop'ları (düz loop'larda zayıf 8'lik / 16'lıklar oranla kayar; üçleme loop'larının "let" yeri %67 yerine senin oranına), **bas notaları**, akor arpejleri ve shuffle desenleri, quantize ızgarası ve sürükleme yapışması (1/8, 1/16 swing'li; 1/8T yalnızca swing ilan edilmişse oranlanır), cetvel çizgileri (üçlemede 3'te bir çizgiler). Böylece gitar shuffle çalarken bas düz kalıp kaymış gibi duyulmaz. 6/8'de vuruş zaten üçe bölündüğü için oran etkisizdir. Demo oranı değiştirmez; farklı bir oran ölçerse not düşer |
| 2. Kayıt / yükleme | 1 ölçü count-in + metronom. Click yalnızca çıkışa gider, kayıt zincirine bağlı değildir (kulaklık kullanın). WAV/MP3 yükleme: ilk ses başlangıcı 1. ölçüye ya da en yakın vuruşa hizalanır, ofset elle de ayarlanır. **Öncü (anacrusis):** vokal ölçünün ortasında başlıyorsa (ör. 3. vuruşta) hizalamayı "İlk ses → 1. ölçünün şu vuruşu" yapıp vuruşu seç; ilk ses o vuruşa, ölçü çizgileri (1. vuruşlar) doğru yere oturur (yüklenen dosyada da kayıtta da; kayıtta "Yok" click hizasına döner) |
| 2c. MIDI aç (.mid → proje) | Proje JSON'u yerine **MIDI** kaydettiysen: üst çubuktaki **MIDI aç** ya da 2. adımdaki **MIDI yükle** ile dosyayı aç; yeni bir proje olarak devam edersin. Bu uygulamanın çıktısı **tam** geri gelir: **melodi** (düzeltilmiş notalar, aynı yerlerde), **bölümler + tonlar** (marker'lardan), **akorlar** (piyano izindeki akor adı metinlerinden, 📄 kilitli; yarım ölçü akorları dahil), **ölçü ve BPM** (6/8'de ♩. cinsinden), **akor sesi** (iz adından), **bas** ve **davul** (loop adı + ilk vuruşun ölçüsü; bulunursa loop ✋ elle seçilmiş sayılır). Başka programların MIDI'si de açılır: melodi izi otomatik seçilir (adı "vokal / melodi / lead" olan, tek sesli, tiz iz; bas / piyano / davul adlıları elenir) ve **"MIDI melodi izi"** listesinden değiştirilebilir; çok sesli iz tek sese indirilir; ilk tempo ve ölçü kullanılır (değişimler, 4/4 · 3/4 · 2/4 · 6/8 dışı ölçüler için uyarı çıkar); akor adı yoksa akorlar melodiden üretilir. **Ses kaydı olmadığı** için melodi **synth** ile çalar (Vokal kanalı), nota sürüklerken de synth duyulur; autotune / ses düzeltme / nota bölme yoktur (notalar zaten ayrı ve tam yarım ses). Notalar çeyrek cinsinden saklanır: **BPM değişince melodi müzikal yerinde kalır**. Proje JSON'una melodi notaları gömülür (ses yerine), geri alma ve kaydet / aç çalışır. Mix WAV'da melodi synth ile yer alır; "Düzeltilmiş vokal WAV" yalnızca ses projelerinde |
| 2b. Şarkıyı kaydır | **+1 / +2 ölçü boşluk** başa boşluk (giriş) bırakır, **−1 / −2 ölçü** boşluğu azaltır; başta o kadar boş ölçü yoksa ses kesileceği için reddedilir. Ses, ölçü çizgileri, bölümler, akor kilitleri / işaretleri, zaman kaydırmaları ve (1. ölçüden başka seçilmişse) akor / davul girişi **birlikte** kayar; orijinal kayıt değişmez. Boşluk saniye değil ölçü olarak saklanır (BPM değişse de 2 ölçü kalır). Boş ölçülere akor / davul istersen bir bölüm ekleyip ton seç ve girişi 🎹/🥁 ile ayarla |
| 3. Pitch detection | pYIN benzeri: FFT'li YIN + Beta(2,18) eşik dağılımı + Viterbi. Nota olayları: başlangıç, süre, cent hassasiyetinde perde, en yakın nota. En yakın nota **kişisel akort referansına** göre bulunur (aşağıda). Vibrato/kaymalarda çekirdek bölgenin medyanı; sessizlik ve nefes atılır. Piano-roll + ince ham perde eğrisi |
| 3b. Etiket düzeltme | Ses değişmez, yalnızca analizdeki nota değişir. Ton önerisinden **önce** yapılabilir ve histograma girer |
| 4. Bölümler ve ton | Bölüm şeridinde sürükleyerek ölçü aralığı seçilir. Her bölüm için merkez nota + 10 mod. Öneri: süre ve vuruş ağırlıklı histogramdan en olası 3 aday. Histogram etiket düzeltmelerini kullanır, **ses düzeltmelerini (autotune, manuel kaydırma) kullanmaz** — autotune seçili scale'e çektiği için histogram o scale'i kendi kendine doğrulamasın. Aynı notalı modlar ayrı aday, ayırt edici ipucu olarak "son ağırlıklı nota". İki belirsizlik ayrı mesajla gösterilir: **"Ayırt edici nota yok"** (ör. B minör ile B Dorian arasındaki G / G# hiç söylenmemiş) ve **"Aynı nota kümesi, merkez belirsiz"** (ör. E Miksolidya ile A majör; merkez kanıtı zayıf). Önceki bölümün tonu küçük bir itme alır (aynı ton +0.08, aynı nota kümesi +0.04); yalnızca adaylar zaten yakınsa sırayı değiştirir, onaylanmış ton her zaman üstündür. Tam tonunda (±20 cent) söylenmiş scale dışı nota mor kesikli çerçeve ve "?" ile **"mod yanlış olabilir"** diye işaretlenir. Onaylanmamış öneriler geçici olarak kullanılır ve "öneri" diye işaretlenir; son karar kullanıcıda |
| 5. Ses düzeltme | **Elle:** piano-roll'da notayı tut ve sürükle; sürüklerken ne olacağı notanın üstünde yazar. **Notaya tıklayınca duyulur, sürüklerken her yeni yarım seste (ince akortta her ~5 cent'te) o perdede tekrar duyulur**: piyano değil kendi sesin, kaydın o parçası TD-PSOLA ile hızı değişmeden kaydırılarak; etiket sürüklemede ses aynıdır, karşılaştırma için etiket perdesinde kısık bir piyano notası eklenir. Nota panelinde ▶ (şu anki hali) ve ▶ orijinal (ölçek sürüklerken donar: 3 satır = 3 yarım ses). Üç ayrı işlem: **Sürükle / ↑↓ = notayı taşı** (yanlış nota söyledin: ses yeni yarım sese kayar ve kastedilen nota o olur, akorlar onu kullanır) · **Shift+sürükle / Shift+↑↓ = ince akort** (yalnızca cent, en fazla ±49; nota ve akorlar aynı) · **Alt+sürükle = etiketi düzelt** (program yanlış algıladı: ses aynı). Elle düzeltilen notaya autotune dokunmaz. Her değişiklik notaya tıklayınca en üstteki ✕ ile, ya da 5. adımdaki özetten türüne göre topluca geri alınır. **Autotune** (varsayılan kapalı; hedef en yakın yarım ses, notanın kimliği değişmez; "scale'e çek" yalnızca açıkça seçilirse ve uyarıyla): miktar, retune hızı, vibratoyu koru; nota panelinde "Autotune bu notaya dokunmasın". Düzeltilmiş vokal ayrı izde render edilir; A/B düğmesi. Autotune akor önerisini değiştirmez |
| 5b. Zamanlama (quantize) | **Quantize:** ızgara (1/4, 1/8, 1/16, 1/8 ve 1/16 üçleme), güç (%0–100; %100 = tam ızgara), kapsam (tüm şarkı / seçili bölüm / seçili nota; bölüm panelinde "Bu bölümü quantize et"). İki nota aynı noktaya düşecekse biri yerinde kalır. **Elle:** notayı sağa/sola sürükle (ızgaraya yapışır, Ctrl/⌘ ile serbest; eksen ilk harekete göre kilitlenir); nota panelinde ◀ ▶ ve "Izgaraya çek". Ses bütün olarak kayar (WSOLA; perde değişmez — testte en fazla ~1 cent), notanın girişi (~80 ms) notayla birlikte kayar, yalnızca notalar arasındaki boşluk esner/sıkışır; notalar sırasını değiştiremez. Kaydedilen yer kesikli çerçeveyle görünür; "✕ Zamanı geri al" / "Zamanlamayı sıfırla". Akorlar, ton tahmini ve davul yeni konumları kullanır |
| 5c. Toplu seçim ve nota bölme | **Boş yerde sürükle** = dikdörtgenle birçok notayı seç (Shift+sürükle ya da Ctrl/⌘+tık seçime ekler/çıkarır, Ctrl+A hepsi, Esc kaldırır). **Seçili notalardan birini sürükle**: hepsi birlikte taşınır; yukarı/aşağı = perde (taşı / Shift ince akort / Alt etiket, tek notadaki gibi), sağa/sola = zaman (ızgaraya yapışır, Ctrl/⌘ serbest; notalar arası mesafe korunur). Klavyede ↑↓ perde, ←→ ızgara adımı kadar zaman. Panelde toplu işlemler: ▼▲ yarım ses / oktav, "Scale dışındakileri scale'e çek", ±5 cent, "Tam yarım sese çek", ◀ ▶ zaman, "Seçilileri quantize et" (5b'deki ızgara ve güç), etiket ±1, "Seçili notaların değişikliklerini kaldır". Tek notanın panelinde de oktav, ±20 cent, "Doğrudan nota seç" listesi ve "Scale'e çek" var. **Çift tık** = notayı tıkladığın yerden ikiye böl (program iki heceyi tek ses sandıysa): tıklanan yerin ±30 ms yakınındaki enerji çukuruna oturur, her parçanın perdesi yeniden hesaplanır, notanın etiketi / ses düzeltmesi / zaman kaydırması iki yarıya geçer; her parça en az 40 ms olmalı. Bölmeler kayıttaki saniye olarak projede saklanır (yeniden analizde de uygulanır); notanın panelinde "Bölmeyi geri al" ile birleşir, 5. adımdaki özetten hepsi geri alınır |
| 6. Akor bulma | Varsayılan motor **süreli Viterbi** (aşağıda); eski ölçü ölçü (greedy) motor seçilebilir. Ağırlıklar: 1. vuruş ×3, diğer güçlü vuruş ×2, vuruştan uzun ×2, kısa geçiş ×0.5. Diatonik triad + maj7/m7/sus2/sus4/add9. Yarım ses sürtünmesine büyük ceza, maj7 istisnası, sus2 önerisi, diminished düşük öncelik, Frig'de ev akoru asla majör değil. Değişim politikası: (a) sürtünme, (b) ≥ %X daha iyi, (c) N ölçü aynı akor, (d) **ev akoru en az her M ölçüde bir** (varsayılan 2; M dolunca ev akoru %X şartı olmadan aday olur, sürtünmüyorsa gelir); bölüm sonunda ev akoruna dönüş, bölüm geçişinde ortak nota tercihi. **Renk notası cezası** (7, 9/2, 11/4, 6'ya kök/3/5'e göre eksik puan) ayarlanabilir, varsayılan 0 |
| 7. Akor düzenleme | Akora tıkla → akor hemen duyulur ve sağda en iyi 3 aday + melodi notalarının rolü (kök/3/5/7/9) açılır. Adayların yanındaki ▶ kilitlemeden dinletir. Seç + kilitle ya da elle yaz (`F#m7/A` gibi). Kilidi kaldırmak: kilitli akorun sağ üstündeki kırmızı ✕, akor seçiliyken Delete tuşu, denetçinin üstündeki "Kilidi kaldır" ya da 6–7. adımdaki "Tüm akor kilitlerini kaldır" |
| 7a. Değişim noktaları | Akor satırında yarım ölçüler kesikli çizgiyle, vuruşlar çentikle görünür. Satırın üst kenarındaki noktalara (dolu = ölçü başı, içi boş = ölçü ortası) tıkla: **✂ burada değiş → = burada değişme → işaret yok**. Akora tıklayınca panelde "✂ Tam burada değiştir", "✂ Ölçünün ortasında değiştir", "= Burada değiştirme" da var. Hangi akorun geleceğini motor seçer; ✂ noktasında akorun kökü değişir (D → Dmaj7 değişim sayılmaz), işaret konunca diğer akorlar değişmez. "Akor yalnızca ✂ işaretli noktalarda değişsin" seçeneği, işaret konan bölümlerde başka yerde değişime izin vermez. İşaretler kilitlerle çelişirse uyarı çıkar; süreli Viterbi motorunda uygulanır · **"Akorlar yalnızca ölçü başında (1. vuruşta) değişsin"**: ölçü ortası değişimi kapanır (✂ ile işaretlediğin ölçü ortaları hariç); iki motorda da |
| 7e. Öncelik ve "sonrasını otomatik uygula" | **Öncelik sırası: 1) ✂ ile seçtiğin değişim noktaları · 2) elle yazdığın / kilitlediğin akorlar · 3) motor.** Bir ölçü başına ✂ koyunca o noktadaki akor motorca hemen yeniden belirlenir (kökü değişir), diğer akorlar yerinde kalır (📌). Elle yaz kutusundaki düğme artık yalnızca **"Uygula"** (yazdığın akor yine senindir: motor ve puanlar değiştirmez). **"↧ Son elle yaptığımdan sonrasını otomatik uygula"**: son ✂ işaretinin ya da elle akorun ölçüsüne kadar her şey aynen kalır; sonrasını motor **bütün olarak**, işaretlerine ve kilitlerine uyarak belirler (ör. 6. ölçüde ✂, 7. ölçüde elle akor → 8. ölçüden sonrası otomatik). Ölçü ölçü motor da artık ölçü başı ✂ / = işaretlerini uygular (ölçü ortası işaretleri süreli Viterbi'de). İşaret ile kilit çelişirse (✂ var ama iki yanı aynı akor kilitli) kilit korunur ve uyarı çıkar — senin yazdığın akoru kendiliğinden değiştirmez |
| 7c. Tap ile değişim noktaları | Oynatırken akorun değişmesini istediğin her anda **T** (ya da "◆ Değişim noktası"). Noktalar cetvelde ◆; sürükleyerek kaydır, Alt+tık ile sil. 3+ noktadan: noktaların ortak periyodu (ölçü ya da yarım ölçü) + melodinin vurguları → **tempo, ölçü ve 1. ölçünün yeri**; "Uygula" BPM'i, ölçüyü ve ölçü çizgilerini ayarlar, noktaları ✂ işaretine çevirir ve "akor yalnızca işaretli noktalarda değişsin"i açar. Tap zamanı, oynatıcının ileri planlama süresi ve çıkış gecikmesi düşülerek duyulan ana göre kaydedilir. **Piyano tuşları:** piano-roll'un solundaki klavyeye tıkla, nota çalar |
| 7d. Akor ve davul girişi | Cetvelde ölçü numarasının yanındaki **🎹** (akor) ve **🥁** (davul) bayraklarını sürükle (ölçüye yapışır), ya da 6–7. adımdaki / 8b'deki sayı kutusuna yaz, ya da oynatma imlecini istediğin ölçüye getirip **İmleçten**. **Akorlar:** seçilen ölçü akor motoru için **1. ölçüdür** (bölüm başı gibi: ev akoru tercihi, ortak nota); öncesinde akor ve piyano yoktur (soluk "akor yok" şeridi), o ölçülerdeki kilitler yok sayılır, bölümler ve ton önerisi değişmez; akor şemasında o ölçüler boş (otomatik) hücredir. **Davul:** seçilen ölçü loop'un 1. ölçüsüdür, öncesinde davul yoktur (çalma, mix WAV ve MIDI'de). Giriş 1. ölçüdeyken şarkıyı kaydırırsan yerinde kalır (boşluğa giriş çalabilirsin); başka bir ölçüyse şarkıyla birlikte kayar |
| 7b. Kendi akorların (şablon) | 6–7. adımdaki **📄 Kendi akorlarım — şablon yükle**: akorları yaz ya da .txt yükle; melodinin üzerinde kilitli akor (📄) olarak çalar, diğer akorlar değişmez. Biçim DAW'ın akor şemasıyla aynı (indirip düzenleyip geri yükleyebilirsin): `[Nakarat] B Dorian — ölçü 5–8` bölüm başlığı (ton ve aralık isteğe bağlı; çakışmıyorsa bölüm oluşturur), `| C#m | Dmaj7 | % | D / C#m / |` her hücre 1 ölçü, hücrede 2 akor = yarım ölçü, `%` önceki ölçü, `/ - .` önceki akor sürer, boş hücre = otomatik; çizgisiz `C#m:2 D E:0.5` (ölçü). Tanınmayan akor satır numarasıyla bildirilir ve hiçbir şey uygulanmaz; sığmayan akorlar (ölçüde 2'den fazla) ve N.C. uyarıyla atlanır. "Boş şablon indir", "Şu anki akorları şablon olarak indir", "✕ Şablondan gelen akorları kaldır" |
| 8. Akor sesi (piyano / synth) | **Akor sesi:** **Piyano / Synth — shuffle (X . t)**: her vuruşta aynı hücre — vuruşta güçlü akor (X), vuruşun 3'te 2'sinde ("let") hafif ghost akor (t); `1 ve-let 2 ve-let …`; ghost swing oranına oturur · Piyano — akor (Tone.js Sampler, Salamander; hangisi çalıyor üst çubukta) · **Piyano — arpej** · **Synth klavye — akor** · **Synth klavye — arpej** (iki fark edilmiş testere + üçgen → alçak geçiren; akorda yavaş atak, arpejde kısa "pluck"; Web Audio, hazır örnek gerekmez). Arpej: bas + akor sesleri aşağıdan yukarı sonra geri; hız 1/4 · 1/8 · 1/16. **Aynı akor üst üste gelince** (varsayılan *bir kez bas*): ilk ölçünün başında akor bir kez basılır ve sonraki ölçüye sürer, her ölçüde yeniden basılmaz — *Her ölçüde yeniden bas* eski davranıştır, *Bir kez bas, sönsün (fade-out)* sürerken yavaşça söndürür (piyanoda tuş erken bırakılır, uzun sönme; synth'te seviye düşer; arpejde desen kesintisiz sürer ve kısılır). *En fazla kaç ölçü sürsün* (varsayılan 2): sonrasında akor yeniden basılır; farklı bölümde ya da farklı seslendirmede her zaman yeniden basılır. Seçim oynatmada, mix WAV'da ve MIDI'de (GM program: piyano 0, synth akor 90, synth arpej 81) aynıdır. Akorlar vokal aralığının altında, ortak notalar yerinde kalır. Vokal / akor (mikserde "Akor") / davul / gitar / bas için ses seviyesi, mute, solo |
| 8b. Davul (loop ve 45 ritim kalıbı) | **Ölçü tahmini:** melodinin vurgularından (uzun / yüksek sesli / tepe notalar, arkasından boşluk gelen notalar) ve BPM'den 4/4, 3/4, 2/4, 6/8 (8'likle sayılmışsa BPM'i de) tahmin eder; 8'lik mi üçleme mi olduğunu, vokalin kaçıncı vuruşta başladığını (öncü) ve ölçü çizgilerinin kayık olup olmadığını söyler; güveni ve diğer adayları gösterir. "Uygula" ölçüyü (gerekirse BPM'i) değiştirir ve ölçü çizgilerini hizalar; ölçüyü 1. adımdan her zaman kendin seçebilirsin. Notalar BPM ızgarasına (8'lik / üçleme / 16'lık) yakın tempolardan (±%5–15) belirgin biçimde daha iyi oturmuyorsa "BPM yanlış olabilir" der; 16'lık senkoplar ve ~40 ms'ye kadar zamanlama sapması doğru tempoda uyarı vermez. **Loop'lar (57):** 45 numaralı ritim kalıbı kategorilere göre gruplu listede (A: 4/4 temel rock — backbeat, motorik, train, Bo Diddley, "When the Levee Breaks"; B: 4/4 post-punk / darkwave / synthwave — tribal tom, punk, senkoplu kick, dub, 16'lık drive, EBM, gated-reverb + tom fill, clap katmanı; C: half-time ailesi; D: 3/4 waltz; E: 6/8) ve ilk 16 loop "Diğer" grubunda. Kalıplar kick / trampet / hi-hat'e ek olarak floor tom, tom, clap, rim click, ride ve hi-hat pedalı kullanır; bazıları her 4. ölçüde fill çalar (ızgara görünümünde ayrı blok) ya da trampeti hafif geriden vurur. Otomatik öneri ilk 16 loop'u tercih eder; kalıplar elle seçilir ya da tempo/his başka hiçbir loop'a uymayınca öne çıkar (ör. 150+ BPM'de hızlı punk). İlk 16: 4/4 rock 8'lik, four-on-the-floor, yarım zaman (trampet 3'te), 16'lık balad, boom-bap, one-drop, shuffle (üçleme), itmeli pop-rock (3+3+2 kick, 4'ün ve'sinde öncel; 128–180 BPM), sade, **shuffle hücresi — X . t** (hi-hat'te her vuruşta aynı hücre: güçlü · boş · ghost; kick 1-3, trampet 2-4; 70–140 BPM; ghost swing oranına oturur); 3/4 vals, 3/4 balad; 2/4 marş/polka, 2/4 düz; 6/8 balad, 6/8 rock. Seçim: proje ölçüsü + BPM'in loop'un tempo aralığına uyması + melodinin ölçü içi vurgularının kick'le örtüşmesi + his (düz/üçleme); click deseni yarım zamansa yarım zaman öne çıkar. Uygun loop yoksa nedenleriyle "bulamadım" der ve Claude'a gönderilecek tarifi (ölçü, BPM, his, 0–9 vurgu profili) kopyalanabilir verir; en yakını yine çalınabilir ya da elle seçilebilir. Davul mikserde ayrı kanal; mix WAV'a ve MIDI'ye (kanal 10) girer. Bölümde **puan sırası** listesi: her loop'un puanı (vurgu, tempo, his) görünür; **▶** loop'u seçmeden 2 ölçü dinletir, **Seç** elle seçer |
| 8c. Gitar (ritim katmanı) | Piyanonun yanında (**Piyano / Gitar / İkisi**) akor zaman çizelgesinden gitar partisi üretir; akor, BPM, ölçü ve bölüm yapısı olduğu gibi okunur. Altı katman ayrı ayrı seçilir ve birleşir, her seçim anında sese yansır: **(1) vuruş modu** strum / arpej (yukarı, aşağı, yukarı-aşağı, Travis; 8'lik, 16'lık, 8'lik üçleme) / boom-chick (bas kök ↔ beşli) · **(2) ritim kalıbı** düz 8'likler, uzun akor, folk/pop, offbeat-skank, 16'lık funk, gallop, noktalı 8'lik vurgu, bossa, vals, 6/8 (+2/4 için iki yalın kalıp); kalıplar proje ölçüsüne ve vuruş moduna göre süzülür; **adım ızgarası**: tıkla es → ↓ → ↑ → ✕ döngüsü, uzun bas vurgu, kendi ızgaranı çiz; Alternate / Hep aşağı; swing · **(3) voicing** konum (otomatik / açık / kapalı), şekil (tam / power / üst 3 tel), renk (sus2 / sus4 / add9), drone (bölüm toniği boş tel olarak; bulunamazsa devre dışı ve nedeni gösterilir) — voicing motoru tel başına MIDI notası döndürür, Viterbi ile el hareketini en aza indirir, tuning ve capo parametrelidir (arayüzde v2), motorun tüm akor türlerini tanır, tanımadığı türde en yakın temel akora düşer ve konsola uyarı yazar · **(4) süsleme** (adım bazlı) slide in/out, hammer/pull, vibrato · **(5) nota süresi** normal / let ring / staccato / palm mute (miktar kaydırıcısı) ve ölü vuruş; genel seçilir, adım bazında ezilir (tek değerli: let ring ile palm mute aynı adımda birlikte olamaz) · **(6) ton / FX** clean / crunch / drive, chorus, tempo senkron delay (8'lik, noktalı 8'lik, 4'lük), reverb, humanize (strum yayılması, vuruş gücü ve zamanlama sapması; tohumlu, aynı ayar aynı sesi verir). Ses Karplus-Strong ile tarayıcıda üretilir (örnek dosyası yok, çevrimdışı çalışır; çalma, ön dinleme ve mix WAV aynı sentezi kullanır). **Ön dinleme** 2 ölçülük döngüde projenin gerçek akorlarını (yoksa Am–F–C–G) çalar. **Bölüme atama:** varsayılan tüm şarkı; her bölüme ayrı parti verilebilir. **Kombinasyonu kaydet:** isimli preset, proje dosyasıyla saklanır. Gitar mikserde ayrı kanal; mix WAV'a ve MIDI'ye (gitar izi) girer, piyano seçiliyken MIDI eskisi gibidir. Kapsam dışı: lead/solo teknikleri, harmonics, slap, jazz voicing'leri, double stop (tremolo, capo ve akort seçenekleri v2) |
| 8d. Bas | Akor izi ve bölüm tonlarından **bas hattı üretir** (ses analizi yok, hiçbir nota elle yazılmaz). Akorlar ve bölümler okunur; ölçü başına ritim şablonu (bas gitar için 10, synth için ek 6 şablon; 3/4 ve 6/8 sürümleri), enerji eğrisi (bölüm başı → sonu), 4 ölçülük motifler (A, A, A', B), bölüm sonu dolguları ve akor geçişlerine yaklaşma notaları. Kurallar: akor değişen ölçünün ilk notası kök, aralık içinde kalır, art arda üç aynı ölçü olmaz. **Kontrol:** Generate / yeni tohum (🎲) / ölçü kilidi (L) / tek ölçü zarı (R) / yoğun-seyrek / ileri kopyala / akor değişince "yeniden uydur" / elle nota (çift tık, sürükle, Delete) / geri al (50 adım) / pedal notası (derece ya da sabit perde) / döngü (birebir ya da akora uy) / MIDI dışa aktarma. **Tap ile ritim:** ölçü seç → Kaydet → bir ölçü sayım + metronom → **B** tuşuyla (ya da ped) vur; vuruşlar 8'lik/16'lık ızgaraya yuvarlanır, perdeler akor izinden gelir; gecikme ayarı ve 8 tıklık kalibrasyon; "çaldığım gibi" ya da "bir kalıbı döngüle"; kayıtlı ritim özel şablon olarak saklanır. **Stil profilleri:** üç yerleşik (Post-punk drive, Darkwave pulse, Synthwave roll), iki profil karışımı (kaydırıcı) ve **referans şarkıdan öğrenme**: bas izi olan MIDI içe aktar (ölçü kökü = 1. vuruşun en alçak notası, önizleme tablosunda düzeltilir) ya da 16'lık adım başına derece yaz (hızlı giriş); istatistikler düşük / orta / yüksek enerji için ayrı çıkar (adım başına vuruş sıklığı, rol dağılımı, yaklaşma karışımı, sıçrama ve legato, sık desenlerden yeni şablonlar); profil projede ve tarayıcıda saklanır. **Ses:** Web Audio sentezi (9 preset, katman, 31 altı notaları oktav ikileme, synth modunda süzgeç otomasyonu / pompa / hipnotik bölüm / vurgu-bağ-glide) ya da **kendi örneklerin** (adında perde olan dosyalar, dönüşümlü varyantlar, bırakma örneği; örnekler projeyle kaydedilmez). Mikserde ayrı kanal; mix WAV'a ve MIDI'ye (Bas izi) girer. Kapsam dışı: ses kaydından nota çıkarma, MIDI klavyeden giriş |
| Bölüm düzenlemesi, davul fill'i, döngü, "⟳ Başka dene" | **Bölüm düzenlemesi:** bölüme tıkla → denetçide "Bu bölümün düzenlemesi": davul (genel ayar / yok / loop), akor sesi (genel / altı seçenek); bölüm başına bas ve gitar 8c / 8d panellerindedir. Ör. verse'te sade davul, nakaratta genel ayar. Genel ayar kapalı olsa bile bir bölüme loop verirsen o bölümde çalar. **Davul fill'i** (8b'de açılır, varsayılan açık): bir bölümün son vuruşunda trampet 16'lıkları (6/8'de 3 vuruş) giderek güçlenir, sonraki bölüm hemen başlıyorsa. **🔁 Döngü** (üst çubuk): seçili bölümü (ya da imlecin olduğu bölümü, o da yoksa imleçten 4 ölçüyü) tekrar tekrar çalar; cetvelde yeşil bant; başka bir bölüme tıklarsan döngü onu izler; turlar baştan zamanlanır, aralarda duyulur boşluk olmaz. **⟳ Başka** düğmeleri (davul loop'u, akor sesi; ayrıca bölüm düzenlemesinde bölüm için): sıradaki seçeneği (davul için puan sırasıyla) uygular ve **hemen çalar**; çalıyorsa baştan, döngüdeyse bölgenin başından. Bölümü seçip 🔁 ve ⟳ ile teori bilmeden dinleyerek seçersin |
| ✨ Demo yap | Üst çubuktaki düğme, ses analiz edildikten sonra tek tıkla: (1) ölçü ve tempoyu melodinin vurgularından tahmin edip uygular (tık ile kaydedilmiş ya da test melodisinde hizası bilindiği için atlanır; güven < %55 ise dokunmaz), (2) bölüm yoksa tek bölüm açar ve onaylanmamış ton önerilerini onaylar, (3) davul (otomatik loop, fill'li) açar ve bas katmanını (8d) açıp akorlardan üretir (elle düzenlenmiş / kilitli bas ölçüleri korunur), vokal temizliğini açar ve seviyeleri dengeler (elle ayarlamadıysan), (4) nakarat varsa verse / girişi daha sade yapar (sade davul), (5) başa sarıp çalar. Ne yaptığı durum çubuğunda yazar; her şey **tek Ctrl+Z** ile geri alınır |
| ✅ Progresyonu bitirdim | 6–7. adımdaki düğme: bitirdiğin progresyondan **öğrenir**. (1) Ton onaylı bütün bölümler ağırlıklı (5×) bir şarkı olarak stil verisine girer: geçişler, **üçlü bağlam** (önceki → akor → sonraki), açılış / kapanış, akor süreleri, renkler ve bölümler arası geçişler. (2) Senin **seçtiğin** (kilitlediğin / elle yazdığın) her akor için öncesiyle ve sonrasıyla ilişkisi beğeni sayılır: önceki → akor, akor → sonraki ve üç akorluk bağlamlar; yalnızca seçilen akor değil komşuları da öğrenmeye girer. Motorun bulduğu akorlar bu işlemle değişmez (📌 sabitlenir). Yeniden basınca "güncelle" olur (aynı projeden çoğalmaz), "↶ Öğrendiklerimi sil" geri alır. Sonraki akor önerileri bu veriyi kullanır (stil modeli, λ). Akor inspektöründeki 👍 / 👎 de artık hem öncesini hem sonrasını ve üçlü bağlamı işler |
| 👍 / 👎 tercih öğrenme | 8 ve 8b'de ⟳ yanındaki 👍 / 👎: çalan davul loop'unu / akor sesini oyla. Tercihler tarayıcıda saklanır (bütün projelerde geçerli) ve yalnızca **otomatik** sıralamayı etkiler: davul puanına loop başına ±0,08, aynı aile (A–E) için ±0,03 eklenir (en çok ±0,3); ⟳ sırasında beğendiklerin önde, beğenmediklerin sonda. 👎 en iyi sıradakini hemen dener. Puanlı listede 👍n / 👎n görünür; "tercihleri sıfırla" hepsini siler. Elle seçtiğin hiçbir zaman değişmez |
| 🎙 Vokal temizliği ve 🎚 otomatik miks | 8e içinde. **Vokal temizliği** (kayıtlı vokal için; orijinal değişmez, oynatma / vokal WAV / mix aynı işlenmiş sesi kullanır): 80 Hz yüksek geçiren → **gürültü azaltma** (sessiz karelerden profil çıkarılan STFT güç çıkarma; sessizde ≥ 10 dB, şarkı söylenirken ≤ 1,5 dB etki) → **sıkıştırıcı** → **seviye eşitleme** (konuşulan kısımların RMS'i −18 dBFS) → **reverb** (Freeverb, ıslak seviye kuruya göre ≤ −9 dB) → −1 dBFS tepe sınırlayıcı. Hepsi çevrimdışı ve gecikmesizdir; aynı giriş + ayar = aynı çıkış. **🎚 Seviyeleri otomatik ayarla:** izler fader'sız render edilip kapılı RMS'e göre vokala oranlanır (akor −7, gitar −6, bas −5, davul −6 dB; vokal 0). Ana çıkışta Limiter (−1 dB) ve mix WAV'da aynı sınırlayıcı vardır. **Demo** vokal temizliğini açar ve fader'a hiç dokunmadıysan seviyeleri dengeler; elle ayarladığına dokunmaz |
| ⏺ Punch-in ve canlı perde göstergesi | 2. adımda **⏺ Punch-in**: yeniden söylemek istediğin ölçüleri seç (ölçü aralığı, **Seçili bölüm**, **Döngü bölgesi** ya da **İmleçten**; zaman çizelgesinde cetvelde kırmızı bant görünür). Başlayınca seçtiğin kadar **ön çalma** (0–2 ölçü: fon müziği + metronom + eski vokal) çalar, bölge başında mikrofon girer ve eski vokal susar, bölge bitince kendiliğinden biter (**■ Bitir** erken keser). Fon müziği, click ve yakalama **aynı AudioContext**'te çalınır: örnek hassasiyetinde hizalıdır; kayıt gecikmesi (1. adımdaki ayar) telafi edilir. Yeni take eski kaydın yalnızca o aralığına 10 ms kenar geçişiyle yerleşir (bölge dışı birebir aynı kalır) ve perde yeniden analiz edilir. **Take'ler** saklanır (Orijinal, Take 2, …; en çok 6): aralarında tek tıkla geçilir, **sabitle** diğerlerini siler. Aynı ölçü aralığı yeniden çekilince aynı listeye eklenir; farklı ama çakışan aralık önceki take'leri kapatır. Take'ler oturum boyunca durur; proje dosyasına yalnızca çalan hali gömülür. **Kulaklık kullan.** Kayıt ve punch-in sırasında **canlı perde göstergesi**: söylediğin notanın adı ve sent sapması (yeşil ±20, sarı ±40, kırmızı fazlası). Yeniden çekilen bölgedeki elle nota düzeltmelerini kontrol et |
| Geri al / yinele | Üst çubukta **↶ ↷** ve **Ctrl+Z**, **Ctrl+Shift+Z** (ya da Ctrl+Y): proje durumunun (notalar ve düzenlemeleri, bölmeler, bölümler, kilitler, işaretler, akor / davul / gitar / bas ayarları, kaydırma, giriş ölçüleri) anlık görüntüleri; en fazla 100 adım. **Bas şeridi** kendi geçmişini de tutar: bas şeridinde yaptığın son işlem Ctrl+Z ile önce kendi geçmişinden geri alınır, o bitince (ya da başka bir yerde işlem yapınca) genel geri alma devralır. Bir sürükleme tek adımdır; 0,5 sn içindeki art arda değişiklikler (kaydırıcılar) tek adımda birleşir; ✨ Demo tek adımdır. Pitch analizi ayarı ya da bölme geri alınınca notalar yeniden hesaplanır. **Dahil değil:** mikser seviyeleri / mute / solo ve A/B; kayıt / ses yükleme geri alınamaz, yeni ses geçmişi sıfırlar (Yeni / Proje aç da) |
| Sol panel düzeni | Adımlar **kapalı** başlar (yalnızca 1 Proje ayarı ve 2 Kayıt açık); başlığa tıklayınca açılır, başlığın sağındaki **rozet** o bölümün durumunu açmadan gösterir (ör. "4/4 · 120 BPM", "Rock / pop — 8'lik", "bas gitar · Post-punk drive", "kapalı"). Akor sesi (8), Davul (8b), Gitar (8c), Bas (8d) ve Mikser (8e) ayrı bölümlerdir; akor motoru ayarları (X, N, M, renk, stil modeli) 6–7 içinde "⚙ Akor motoru ayarları" altında, ✂ işaretleri / tap ayrı bir açılır kutudadır. Açık/kapalı durumu tarayıcıda hatırlanır; "Hepsini aç / kapat" düğmeleri var |
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


### Elle seçimlerin önceliği

Otomatik hiçbir mekanizma senin açıkça verdiğin kararı değiştirmez; puanlar yalnızca otomatik kalan yerleri doldurur:
- **Ölçü ve BPM** senindir: ✨ Demo ve ölçü tahmini bunları değiştirmez (tahmin farklıysa yalnızca bilgi olarak yazılır; değiştirmek için 8b'deki "Uygula"yı sen basarsın).
- **Akor:** kilitlenen / elle yazılan akor, ✂ işaretleri, şablondaki akorlar motorun kısıtıdır; onaylanan ton hep önerinin üstündedir; notaya verilen etiket ve elle taşıma akorlara girdi olur.
- **Davul loop'u, bölüm düzenlemesi, bas ölçüleri (kilitli / elle):** elle seçilen (✋) puana bakılmadan çalar; Demo yalnızca "Otomatik" olanı ve kendi ürettiği (`auto`) bölüm düzenlemesini yeniler.

### Akor motoru parametreleri (kısa)

- **Değişim eşiği X:** mevcut akor, yenisi onu en az %X geçmedikçe değişmez (10 puan, X = %25 → yeni ≥ 12,5). Yüksek X = az değişim.
- **Geçiş ağırlığı λ:** "değişeceksem hangi akora" için veri setinin geçiş alışkanlıkları; puana λ·ln(P·7) eklenir (rastgeleye göre 2× olası akor +0,69·λ, 10× seyrek −2,3·λ). λ = 0: yalnızca melodi ve teori.
- **Ritim ağırlığı λ_ritim:** "değiş mi kal mı"; akor veride n ölçü sürüyorsa değişme olasılığı h için λ_ritim·ln(h/(1−h)) (h = %70 → +0,85, h = %20 → −1,39).
- **Sıcaklık:** 0 = hep en iyi; > 0 = en iyi 3 aday arasından puanla orantılı seçim (puanlar 10/9/8: T = 1 → %66/%24/%9; T = 3 → %45/%32/%23).
- **Veri yeterliliği:** uygulamada hazır veri seti yoktur; model yalnızca senin eklediğin şarkılardan kurulur (testlerdeki 6 sentetik şarkı gerçek değil). Bir modda 20'den az şarkı = "az veri" uyarısı. Parametreleri veriye bakıp ayarlamak için kabaca modda 20+, toplamda 30+ gerçek akor şemalı şarkı gerekir; öncesinde varsayılanlar (λ = 1, λ_ritim = 1, T = 0).

## Bölüm × katman

**4b → Otomatik aranje** varsayılan olarak kapalıdır; açmak mevcut elle seçimleri korur. Bölümler satır, Akor / Gitar / Bas / Davul sütundur; bölüm yoksa **Tümü** görünür. Kesik kenar otomatik, düz kenar elle seçimdir. İlk tık otomatiğin tersini, sonraki tık otomatiği seçer. Satırdaki **Otomatiğe dön** veya **Hepsini otomatiğe döndür** elle seçimleri temizler. Her işlem ayrı Ctrl+Z / Ctrl+Shift+Z adımıdır; proje dosyasında saklanır. Genel olarak kapalı katman açılamaz.

| Bölüm türü | Akor | Gitar | Bas | Davul |
|---|---|---|---|---|
| Intro | Açık | Açık | Kapalı | Kapalı |
| Verse | Açık | Açık | Açık | Kapalı |
| Pre-nakarat | Açık | Açık | Açık | Açık |
| Nakarat | Açık | Açık | Açık | Açık |
| Köprü | Açık | Açık | Kapalı | Kapalı |
| Outro | Açık | Açık | Kapalı | Kapalı |
| Diğer / Tümü | Açık | Açık | Açık | Açık |

Çalma, mix WAV ve MIDI aynı matrisi izler. Kapalı bölüm sınırında uzayan notalar kesilir; doğal ses bırakma ve efekt kuyrukları duyulabilir. Bölümler arasındaki boşluklar genel düzeni izler. Matris kapalıyken mevcut düzen değişmez.

## Tür paketleri

**4a → Tür paketi**, davul loop'unu, bas sesini ve üretilen hattı, akor sesini, gitar partisini, çalgı seçimini ve bölüm dinamiklerini birlikte kurar. Tempo ve ölçü değişmez; matris açılır. Paketler BPM aralığına uzaklığa göre sıralanır; **Tempoya uygun** en iyi üç seçeneği gösterir. **Uygula** seçileni uygular; **⟳ Başka paket** sıralamadaki sonraki pakete geçer ve başa döner. Yalnızca zaten çalıyorsa çalma yeniden zamanlanır.

| Paket | Karakter |
|---|---|
| Dream pop | Geniş synth akorları, uzun çınlayan arpej ve sıcak drone bas; kıtada davul yok. |
| Indie pop | Piyano arpeji, temiz folk gitar ve yürüyen bas. |
| Electro-pop | Synth akorları, clap davul ve pompalı synth bas; giriş yalnız akor. |
| Alt rock | Drive gallop gitar, fuzz bas ve senkoplu davul. |
| Indie rock | Crunch sekizlik gitar, yürüyen bas ve train davul. |
| Post-punk | Delay'li temiz skank gitar, sürükleyici bas ve motorik davul. |
| Synthwave | Synth arpeji, Moroder bas ve gated davul. |
| Darkwave | Seyrek giriş, sub bas ve elektronik davul. |
| Alternative pop | Piyano akorları, sıcak drone bas ve half-time davul. |
| Pop rock | Piyano akorları, crunch gitar ve pedal bas. |
| Akustik | Temiz folk gitar, piyano arpeji ve seyrek bas. |
| Balad (4/4) | Uzayan piyano akorları, çınlayan gitar ve sakin drone bas. |
| Synthpop | Synth arpeji, nabızlı synth bas ve dört vuruş kick. |
| Dans / Elektronik | Acid bas ve elektronik dans davulu. |
| Vals | 3/4 piyano arpeji, vals gitar ve drone bas. |
| 6/8 Balad | 6/8 piyano arpeji, çınlayan gitar ve noktalı çeyrek bas nabzı. |

İlk 14 paket 4/4 içindir; Vals 3/4, 6/8 Balad ise 6/8 içindir (BPM noktalı çeyrek sayılır). 2/4 için paket yoktur. **Kilitle: Akor / Gitar / Bas / Davul**, başka paket uygulanırken o katmanın ayarlarını ve matris sütunundaki duyulan seçimleri korur. Mevcut bölüm gitar partileri ve kilitli bas içeriği korunur; uyarılar ve korunan katmanlar panelin altında ve durum çubuğunda gösterilir. En az bir akor çalgısı açık kalır.

Son nakarat, bölümde elle davul seçimi yoksa paketin alternatif davul loop'unu kullanır; elle kapatılmış hücreler dışında genel olarak açık tüm katmanları çalar. **Otomatik aranje** kapatılınca paket şablonu ve son nakarat ekstrası devreden çıkar; paketin genel sesleri ve ayarları kalır. Paket uygulama ve her kilit düğmesi, bas ayarları ve notaları dahil ayrı birer Ctrl+Z / Ctrl+Shift+Z adımıdır. Paket ve kilitler proje dosyasında saklanır.
