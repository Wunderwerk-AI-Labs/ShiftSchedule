# Qwen-Tests auf der Luxemburg-Konfiguration

Stand: 6. September 2026. Sechs echte Läufe mit **Qwen 3.8 Flash W4A16** am selbst gehosteten Endpunkt, dazu eine lokale Reproduktion eines dabei gefundenen Werkzeugfehlers.

**Ergebnis:** Ein konkretes Beispiel für gebündelte Werkzeugaufrufe hilft dem Modell, den vorgesehenen Ablauf einzuhalten. Ein allgemeines Qualitätsplus der gesamten Prompt-Variante ist nicht belegt. Die wichtigste leicht umsetzbare Korrektur betrifft widersprüchliche Kandidatenmeldungen; sie ist auf dem Testzweig vorbereitet.

**Versuchsaufbau**

Gespeicherte Praxisvorlage: 24 Personen, 35 Bereiche, 163 wöchentliche Vorlagenfelder und die Standorte Kirchberg, Zitha, Cloche d’Or sowie Gardes&Astreintes. Die Anzeigenamen sind in der Testvorlage durch Wissenschaftlernamen ersetzt. Feiertage und Standort-/Bereichsbezeichnungen stammen aus der Luxemburg-Konfiguration.

- Normalfall: 2. Februar 2026, ein Tag, 30 erforderliche Besetzungen, zwei Personen im Urlaub.
- Engpass: 16. Februar 2026, ein Tag, neun Personen im Urlaub und zwei zusätzliche Ausfälle. Sieben vorhandene Einträge bleiben fest; die übrige Woche zählt für die Stundenbegrenzung mit. Zu Beginn sind 24 erforderliche Besetzungen offen.
- Alle Modellläufe verwenden den produktiven Stand **v1.53**, Strategie `day_by_day`, dasselbe Modell `VnimanieAI/Qwen3.8-Flash-Next-W4A16`, unverändertes Standard-Reasoning und jeweils 1.200 Sekunden Zeitbudget. Sie laufen nacheinander.
- Die Variante überspringt die doppelte Prioritätenabfrage, ergänzt ein konkretes Zwei-Werkzeug-Beispiel und erläutert die Qualitätsreihenfolge samt Vorabprüfung optionaler Tauschaktionen. Nur die Prompts im isolierten Testprozess ändern sich. Die Tests speichern keine Änderungen im Kalender oder in den Einstellungen.
- Für fünf Läufe wurden die Werkzeugaufrufe vollständig aufgezeichnet. Prüfsummen bestätigen identische Vorlage, Planungssteuerung und Werkzeuge sowie identische Prompts innerhalb jeder Variante. Der erste Referenzlauf verwendet den vorhandenen Arena-Bericht.

**Messwerte**

| Fall | Prompt | Zeit | Runden | Offen | Kurze Tage | Lange Tage | Verworfene Zuweisungen |
|---|---|---:|---:|---:|---:|---:|---:|
| [Normal](https://github.com/Wunderwerk-Official/ShiftSchedule/actions/runs/34051398510) | Bisher | 6:40 | 53 | 0 | 2 | 5 | 0 |
| [Normal](https://github.com/Wunderwerk-Official/ShiftSchedule/actions/runs/34051786634) | Variante | 4:45 | 32 | 0 | 1 | 6 | 0 |
| [Normal, Wiederholung](https://github.com/Wunderwerk-Official/ShiftSchedule/actions/runs/34052384519) | Bisher | 7:38 | 54 | 0 | 1 | 5 | 2 |
| [Normal, Wiederholung](https://github.com/Wunderwerk-Official/ShiftSchedule/actions/runs/34052550336) | Variante | 6:18 | 35 | 0 | 1 | 5 | 1 |
| [Engpass](https://github.com/Wunderwerk-Official/ShiftSchedule/actions/runs/34051836086) | Bisher | 3:37 | 26 | 14 | 1 | 5 | 8 |
| [Engpass](https://github.com/Wunderwerk-Official/ShiftSchedule/actions/runs/34052100055) | Variante | 4:30 | 20 | 14 | 1 | 5 | 7 |

Zeiten in Minuten:Sekunden. „Kurz“ und „lang“ beziehen sich auf die hinterlegten gewünschten Tageslängen. Verworfene Zuweisungen sind einzelne Änderungen innerhalb zurückgerollter Pakete, keine übernommenen Regelverstöße. Alle sechs Ergebnispläne enthalten **keine neu eingeführten oder verschärften harten Verstöße**. Alte, unveränderliche Verstöße in der Vorlage werden getrennt gemeldet.

Im Normalfall beträgt die mittlere Laufzeit der zwei Referenzen 7:09, die der zwei Varianten 5:32. Das sind beobachtete Werte aus jeweils zwei Versuchen, keine statistisch abgesicherte Beschleunigung. Im Engpassfall ist die Variante mit 4:30 langsamer als die Referenz mit 3:37, bei exakt gleicher Qualitätsbewertung. Die gemessene Servergeschwindigkeit schwankt deutlich; Runden und Tokenmengen sind deshalb zusätzlich relevant.

**Was sich daraus ableiten lässt**

1. **Das Zwei-Werkzeug-Beispiel ist sinnvoll.** In der aufgezeichneten normalen Referenz benötigt die Tagesplanung 47 Modellrunden; die Varianten benötigen 27 und 30. Die Variante führt tatsächlich `apply_moves` und `suggest_day_blocks` in derselben Antwort aus. Schon im ersten Vergleich sinkt die Zahl aller Modellrunden von 53 auf 32 und die Eingabetokenmenge um 44 %. Das spricht für das konkrete Beispiel und das Weglassen der doppelten Orientierung. Die Einzelbeiträge dieser beiden Änderungen wurden nicht getrennt gemessen.

2. **Zuerst die Kandidatenmeldungen korrigieren.** Im Engpass nennt `list_candidates_for_slot` unter anderem Isaac Newton als geeignet, obwohl feste Einträge seine Wochenstunden bereits überschreiten. `apply_moves` lehnt die Zuweisung anschließend korrekt ab. Eine zusätzliche Prüfung ignoriert vorhandene Verstoß-Kennungen zu früh und übersieht dadurch deren Verschärfung. Die Tagesvorschläge prüfen bereits strenger. Im Referenzlauf führt das zu einem zurückgerollten Paket aus acht Zuweisungen; auch die Prompt-Variante gerät in diesen Widerspruch. Ein Prompt, der den Werkzeugen vertrauen soll, braucht übereinstimmende Werkzeugantworten.

   Mit der kleinen Korrektur verwendet die Kandidatenliste dieselbe Prüfung wie die Übernahme. Der neue Regressionstest schlägt vorher fehl und besteht nachher. Die **491 regulären Backendtests** bestehen, einschließlich der 61 Werkzeugtests; die separate langsame Solver-Benchmark-Suite wurde ausgenommen. Zusätzlich wurden 21 konkret falsch positive Kombinationen aus dem echten Engpassprotokoll nachgeprüft: vorher 21 falsch als geeignet gemeldet, nachher 0; alle 21 stimmen danach mit der Übernahmeprüfung überein. Diese Korrektur wurde lokal getestet und vorbereitet; die sechs Modellmessungen verwenden weiterhin die unveränderten produktiven Werkzeuge.

3. **Die Abschlussprüfung sollte vorhandene Prüfergebnisse weiterverwenden.** In den aufgezeichneten Läufen beansprucht allein die Modellerzeugung für die abschließende Bereichsprüfung zwischen 86 und 191 Sekunden. Sie verbessert diese Pläne nicht weiter. Der Übergabetext enthält bisher nur „gefüllt/offen“, nicht die konkreten bereits geprüften und verworfenen Reparaturen. Eine kleine strukturierte Übergabe dieser Ergebnisse würde dem Prompt eine belastbare Grundlage geben, Wiederholungen zu überspringen. Bei mehreren Tagen muss die Prüfung über Tagesgrenzen hinweg erhalten bleiben. Diese Änderung ist eine begründete Empfehlung, noch kein gemessener Geschwindigkeitsgewinn.

4. **Schlussberichte knapp und belegbar halten.** Der Agent erklärt teilweise „keine weitere legale Lösung existiert“, obwohl nur eine begrenzte Auswahl von Tauschmöglichkeiten untersucht wurde. Er erfindet vereinzelt auch Begründungen, etwa bereits fest besetzte Dienste im Normalfall, obwohl dort keine festen Tageszuweisungen vorliegen. Sinnvoll sind höchstens fünf kurze Punkte: bestätigte Besetzung, verbleibende Lücken, belegte Blockierungsgründe und offene weiche Wünsche. „Keine Reparatur gefunden“ darf nicht zu „unmöglich“ werden; fehlende Suchabdeckung muss benannt werden.

5. **Die zusätzlichen Qualitätsanweisungen gezielt einsetzen.** Zulässige Änderungen verbessern nicht automatisch den gespeicherten Plan. Diese Unterscheidung im Prompt ist richtig, aber in den gemessenen Läufen treten keine tatsächlichen Rückschritte der Arbeitskopie auf. Ein Nutzen verpflichtender Vorabprüfungen für alle Balance-Angebote ist daher nicht belegt. Die Befolgung ist zudem uneinheitlich: Im ersten normalen Variantenlauf werden zwei solche Prüfungen ausgeführt, im zweiten trotz mehrerer Balance-Tauschaktionen keine. Eigene, aus mehreren Einzelvorschlägen zusammengesetzte Pakete sollten dagegen als Ganzes vorab geprüft werden; einzeln geeignete Kandidaten garantieren keine zusammen zulässige Kombination. Auch fehlgeschlagene Vorabprüfungen sollten bei späteren Benchmarks als erfolglose Versuche zählen.

**Qualität und Grenzen**

Die Kennzahlen sind nicht durchgehend besser. Beispielsweise sinkt im ersten Normalvergleich die Zahl kurzer Tage von zwei auf einen, während lange Tage von fünf auf sechs steigen und sich die Sollstundenabweichung von 3.571 auf 4.055 Minuten verschlechtert. Die gespeicherte Qualitätsreihenfolge bevorzugt weniger kurze Tage vor der Stundenabweichung. Die Anzahl zu langer Tage ist darin kein eigener Bewertungsrang. Ein längerer Prompt allein kann diese Priorität nicht ändern.

Die Versuche decken einzelne normale und stark belastete Tage ab. Sie belegen weder die optimale Besetzung der Engpassvorlage noch eine Verbesserung bei kompletten Wochen, Bereitschaftsketten oder monatsweiter Fairness. Für eine generelle Umstellung sollte nach der Werkzeugkorrektur ein Vergleich über mehrere Tage folgen.

**Auswahl für v1.54**

Aus den Ergebnissen werden drei begrenzte Änderungen übernommen: die einheitliche Kandidatenprüfung, das konkrete Zwei-Werkzeug-Beispiel ohne doppelte Prioritätenabfrage und kurze, belegbare Schlussberichte. Die Prüfung über Tagesgrenzen hinweg bleibt erhalten. Eine strukturierte Übergabe früherer Reparaturversuche und zusätzliche verpflichtende Vorabprüfungen werden vorerst nicht übernommen; deren Nutzen ist noch nicht gemessen. Die endgültige Kombination wurde nicht erneut mit dem Modell verglichen, deshalb sind die oben gemessenen Zeiten keine zugesicherte Beschleunigung von v1.54.

Die historische Testvariante ist im [Versuchsstand 3d9fa0c](https://github.com/Wunderwerk-Official/ShiftSchedule/blob/3d9fa0c/backend/arena/prompt_eval.py) festgehalten. Die Kandidatenkorrektur ist als eigener Commit `9d511d5` getrennt vom Testaufbau vorbereitet. Der Evaluator bleibt auch mit dem neuen Produktivprompt verwendbar: Ab v1.54 vergleicht `focused` die zusätzlichen Qualitätsanweisungen mit dem dann aktuellen Standard; er fügt das bereits übernommene Werkzeugbeispiel nicht doppelt hinzu. Die Quelltext-Prüfsummen in den Protokollen kennzeichnen diesen Unterschied.

Die sechs Modelltests selbst haben weder `main` noch gespeicherte Produktivprompts oder Kalender verändert. Die ausgewählten Änderungen werden anschließend als v1.54 ausgeliefert. Nach den abschließenden Prompt-Änderungen bestehen alle 121 gezielt geprüften Tests für Werkzeuge, Planungssteuerung, sichere Übernahme und den Evaluator.
