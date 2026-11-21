# Deck export

`deck.html` is the source of the 6-slide hand-in deck (1280 x 720, white, ink, one idea per slide). It contains no customer documents, file names or addresses.

Export to PDF (PowerShell, from the repo root):

```
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="docs\deck\Launch-Control-deck.pdf" "file:///$((Resolve-Path docs\deck\deck.html).Path -replace '\\','/')"
```

Slide 2 has a commented-out office-hours quote block. Add the quote there only after the interview, verbatim with name and role, then re-export. Do not invent one.
